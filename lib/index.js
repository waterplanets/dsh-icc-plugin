/**
 * DSH 插件：ICC 投研工具 + 仪表盘。
 *
 * 三个部分：
 * 1. 模型工具：news_sentiment / stock_debate，沿用原来的子进程调用；
 * 2. 宿主 HTTP 路由：挂在 DSH web server 的 /icc-tools/api/* 下，给浏览器端仪表盘用；
 * 3. 定时任务轮询：每分钟调用一次 dashboard_api.py scheduler-tick。
 *
 * 所有业务逻辑都在 icc-app/dashboard_api.py，这里只做转发，不碰数据库。
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_REPO_URL = 'https://github.com/waterplanets/icc-app.git';

/**
 * 插件配置 schema：字段声明为 volatile 后，会出现在插件页的配置卡片里，
 * 修改即时生效，无需重启。目录类默认值留空，避免把本机绝对路径写进默认配置；
 * 下载地址给出公开的默认值，允许用户改成自己的 fork。
 * 动态导入，宿主没有提供 schemastery 时（例如纯 Node 测试）退化为无表单，插件仍可运行。
 */
let Config;
try {
  const { default: z } = await import('@deepseek-ai/schemastery');
  Config = z.object({
    workspace: z.string().default('').volatile(),
    repoUrl: z.string().default(DEFAULT_REPO_URL).volatile()
  });
} catch {
  Config = undefined;
}

/** 读取配置字段：volatile 字段是带 get() 的包装器，普通对象直接返回值。 */
function readConfig(field, fallback = '') {
  const value = field && typeof field === 'object' && typeof field.get === 'function'
    ? field.get()
    : field;
  return value == null ? fallback : value;
}

/** 识别 ICC 代码布局：兼容仓库的嵌套布局（icc-app/）与扁平布局（根目录直接放脚本）。 */
function layoutOf(home) {
  if (!home) return null;
  if (existsSync(path.join(home, 'icc-app', 'dashboard_api.py'))) {
    const sentiment = path.join(home, 'ml', 'cli.py');
    return {
      api: path.join('icc-app', 'dashboard_api.py'),
      debate: path.join('icc-app', 'run_debate.py'),
      sync: existsSync(path.join(home, 'icc-app', 'sync_symbol.py'))
        ? path.join('icc-app', 'sync_symbol.py') : '',
      dataDir: path.join(home, 'icc-app', 'data'),
      sentiment: existsSync(sentiment) ? path.join('ml', 'cli.py') : ''
    };
  }
  if (existsSync(path.join(home, 'dashboard_api.py'))) {
    const sentiment = path.join(home, 'ml', 'cli.py');
    return {
      api: 'dashboard_api.py',
      debate: 'run_debate.py',
      sync: existsSync(path.join(home, 'sync_symbol.py')) ? 'sync_symbol.py' : '',
      dataDir: path.join(home, 'data'),
      sentiment: existsSync(sentiment) ? path.join('ml', 'cli.py') : ''
    };
  }
  return null;
}

/** 判定一个目录是不是 ICC 代码根目录（有后端脚本即可）。 */
function isCodeHome(dir) {
  return Boolean(layoutOf(dir));
}

/** 在工作空间里找 ICC 代码根目录：优先 workspace 本身，其次 <workspace>/icc-app。 */
function findRepoRoot(workspace) {
  const candidates = [workspace, path.join(workspace, 'icc-app')];
  for (const dir of candidates) {
    if (isCodeHome(dir)) return dir;
  }
  return '';
}

/**
 * 只认一个目录：workspace。其余路径全部由它推导，不读写任何模块级状态。
 *   home      —— 代码根目录：<workspace> 或 <workspace>/icc-app；找不到时留空，首次调用自动 clone
 *   cloneDir  —— 下载目标 <workspace>/icc-app
 *   reports   —— <workspace>/.icc/reports
 *   data      —— 随代码布局：<home>/icc-app/data 或 <home>/data
 */
function resolvePaths(config = {}) {
  let workspace = config.workspace ? path.resolve(config.workspace) : '';
  let home = workspace ? findRepoRoot(workspace) : '';
  if (!workspace) {
    // 兼容旧用法：没有配置 workspace 时，只在插件附近探测，不主动下载。
    home = findCodeHomeLegacy();
    workspace = home || path.resolve('.');
  }
  const cloneDir = path.join(workspace, 'icc-app');
  return {
    home,
    layout: home ? layoutOf(home) : null,
    workspace,
    workspaceExplicit: Boolean(config.workspace),
    cloneDir,
    repoUrl: config.repoUrl || DEFAULT_REPO_URL,
    reports: path.join(workspace, '.icc', 'reports'),
    data: '',
    python: 'python'
  };
}

/** 代码下载完成后，按实际布局补齐脚本路径与数据目录。 */
function withHome(paths, home) {
  const layout = layoutOf(home);
  if (!layout) return null;
  return { ...paths, home, layout, data: layout.dataDir };
}

/** 旧用法兜底：从插件位置、当前目录向上找，不用于新工作空间模式。 */
function findCodeHomeLegacy() {
  let real = '';
  try {
    real = realpathSync(HERE);
  } catch {
    real = HERE;
  }
  const seeds = [
    path.resolve(HERE, '..', '..', '..'),
    path.resolve(real, '..', '..', '..'),
    process.cwd()
  ];
  for (const seed of seeds) {
    if (!seed) continue;
    let dir = path.resolve(seed);
    for (let i = 0; i < 5; i += 1) {
      if (isCodeHome(dir)) return dir;
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  return '';
}

/**
 * 确保 ICC 代码可用：工作空间里找不到时，用 git 从 repoUrl 克隆到 <workspace>/icc-app。
 * 同一目录的并发调用共用一次 clone。
 */
const installing = new Map();

async function ensureCode(paths) {
  if (paths.home && isCodeHome(paths.home)) return paths.home;
  if (!paths.workspaceExplicit) {
    throw new Error('未找到 ICC 代码。请先在插件设置里填写「工作空间」，首次调用会自动下载。');
  }
  if (installing.has(paths.cloneDir)) return installing.get(paths.cloneDir);
  const task = cloneRepo(paths.repoUrl, paths.cloneDir, paths.workspace)
    .finally(() => installing.delete(paths.cloneDir));
  installing.set(paths.cloneDir, task);
  return task;
}

function gitRun(args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, {
      cwd,
      windowsHide: true,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }
    });
    let output = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`git 执行超时（300 秒）：git ${args.join(' ')}`));
    }, 300000);
    child.stdout.on('data', (chunk) => { output += String(chunk); });
    child.stderr.on('data', (chunk) => { output += String(chunk); });
    child.on('error', (error) => {
      clearTimeout(timer);
      if (error.code === 'ENOENT') {
        reject(new Error('未找到 git，请先安装 Git 并确保 git 在 PATH 中'));
      } else {
        reject(error);
      }
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, output });
    });
  });
}

function gitClone(repoUrl, target, workspace) {
  return gitRun(['clone', '--depth', '1', repoUrl, target], workspace);
}

async function cloneRepo(repoUrl, target, workspace) {
  if (!repoUrl) throw new Error('未配置下载地址 repoUrl，无法自动下载 ICC 代码');
  if (existsSync(target) && readdirSync(target).length > 0) {
    throw new Error(
      `下载目录已存在且非空：${target}\n请清空该目录，或换一个工作空间。`
    );
  }
  mkdirSync(workspace, { recursive: true });

  // 先克隆仓库默认分支；有些仓库默认分支仍是旧版，再切到 main。
  const first = await gitClone(repoUrl, target, workspace);
  let home = first.code === 0 ? findRepoRoot(workspace) : '';
  if (!home) {
    const hint = first.code !== 0
      ? first.output.slice(-500)
      : '默认分支缺少 dashboard_api.py';
    const fetched = await gitRun(
      ['-C', target, 'fetch', '--depth', '1', 'origin', 'main'], workspace
    );
    if (fetched.code === 0) {
      const switched = await gitRun(
        ['-C', target, 'checkout', '-q', '-B', 'main', 'FETCH_HEAD'], workspace
      );
      if (switched.code === 0) home = findRepoRoot(workspace);
    }
    if (!home) {
      const detail = fetched.code !== 0
        ? fetched.output.slice(-500)
        : 'main 分支也没有 dashboard_api.py';
      throw new Error(
        `下载 ICC 代码失败。\n默认分支：${hint}\nmain 分支：${detail}\n`
        + `目标目录：${target}`
      );
    }
  }
  return home;
}

function runPython(paths, args, input) {
  return new Promise((resolve, reject) => {
    if (!paths.home) {
      reject(new Error('ICC 代码尚未就绪，请先完成下载'));
      return;
    }
    // Windows 下 Python 默认按 cp936 写管道，这里强制 UTF-8，否则中文全是乱码。
    const child = spawn(paths.python, ['-X', 'utf8', ...args], {
      cwd: paths.home,
      windowsHide: true,
      env: {
        ...process.env,
        PYTHONUTF8: '1',
        PYTHONIOENCODING: 'utf-8',
        PYTHONLEGACYWINDOWSSTDIO: '0'
      }
    });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => { out += d.toString('utf8'); });
    child.stderr.on('data', (d) => { err += d.toString('utf8'); });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`python 退出码 ${code}: ${err.split('\n').slice(-4).join(' ')}`));
        return;
      }
      resolve(out);
    });
    if (input) child.stdin.end(input);
    else child.stdin.end();
  });
}

/** 代码缺失时的结构化错误：调用方据此提示用户确认安装，而不是默默下载。 */
function needInstall(paths) {
  const error = new Error(
    '工作空间里还没有 ICC 代码，需要先下载：请先征得用户同意，再调用 icc_install 安装，然后重试。'
  );
  error.code = 'NEED_INSTALL';
  error.detail = '';
  error.data = { repoUrl: paths.repoUrl, target: paths.cloneDir };
  return error;
}

async function runApi(paths, args) {
  // 不在业务调用里静默 clone：先让用户看到安装提示并确认，再由 /install 或 icc_install 执行。
  const p = withHome(paths, paths.home);
  if (!p) throw needInstall(paths);
  // 目录设置走命令行参数，不用环境变量，避免和宿主或其他插件共享全局状态。
  const out = await runPython(p, [
    p.layout.api,
    '--workspace', p.workspace,
    '--reports-dir', p.reports,
    '--data-dir', p.data,
    ...args
  ]);
  const line = out.trim().split('\n').filter(Boolean).pop() || '{}';
  return JSON.parse(line);
}

const textOut = (title, value) => [{ type: 'text', text: `${title}\n${JSON.stringify(value, null, 2)}` }];

const ROLE_LABELS = {
  news_analyst: '新闻分析师',
  tech_analyst: '技术分析师',
  bull: '多头研究员',
  bear: '空头研究员',
  research_manager: '研究主管',
  trader: '交易员',
  risk_aggressive: '激进风控',
  risk_neutral: '中性风控',
  risk_conservative: '保守风控',
  portfolio_manager: '组合经理'
};

/** 把辩论留痕压成可读的时间线，模型和用户看到的是同一份上下文。 */
function formatTranscript(stages = []) {
  if (!Array.isArray(stages) || stages.length === 0) return '（没有辩论留痕）';
  return stages.map((s) => {
    const who = ROLE_LABELS[s.role] || s.role;
    const round = s.round > 1 ? ` 第${s.round}轮` : '';
    return `【${s.step}${round} · ${who}】\n${String(s.content || '').trim()}`;
  }).join('\n\n');
}

function createTools(currentPaths) {
  return [
  {
    name: 'news_sentiment',
    description: '给中文财经新闻打三分类情感标签（正面/中性/负面）与 -1..1 的期望分。本地 SVM，不调用大模型。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        texts: {
          type: 'array',
          description: '待打分的新闻，每条为「标题。正文」，至少一条',
          items: { type: 'string' }
        }
      },
      required: ['texts']
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: true,
        properties: {
          items: { type: 'array', items: { type: 'object', additionalProperties: true } }
        },
        required: ['items']
      },
      render: (_args, value) => textOut('情感打分', value)
    },
    async execute({ texts }) {
      const paths = currentPaths();
      if (!Array.isArray(texts) || texts.length === 0) throw new Error('texts 不能为空');
      const input = texts.map((t) => {
        const [head, ...rest] = String(t).split('。');
        return JSON.stringify({ title: head, content: rest.join('。') });
      }).join('\n');
      const p = withHome(paths, await ensureCode(paths));
      if (!p?.layout.sentiment) {
        throw new Error('当前 ICC 代码版本没有包含 ml/cli.py，无法本地打分；请更新代码目录');
      }
      const out = await runPython(
        p, [p.layout.sentiment, 'predict'], input + '\n'
      );
      return { items: out.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) };
    }
  },
  {
    name: 'stock_debate',
    description: '对一只 A 股跑一次完整 LLM 辩论流水线：分析师 → 多空辩论 → 研究主管 → 交易员 → 三路风控 → 组合经理，返回五档评级、建议仓位，以及全程辩论上下文（stages / evidence / 各角色原始发言）。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        symbol: { type: 'string', description: '如 600519.SH' },
        asof: { type: 'string', description: '虚拟当前日期 YYYY-MM-DD，缺省为今天' }
      },
      required: ['symbol']
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: true,
        properties: {
          rating: { type: 'string' },
          verdict: { type: 'string' },
          confidence: { type: 'number' },
          position_pct: { type: 'number' },
          stages: {
            type: 'array',
            description: '按发言顺序保留的辩论上下文',
            items: {
              type: 'object',
              additionalProperties: true,
              properties: {
                step: { type: 'string' },
                role: { type: 'string' },
                round: { type: 'number' },
                content: { type: 'string' }
              },
              required: ['step', 'role', 'content']
            }
          },
          evidence: { type: 'string' }
        },
        required: ['rating', 'verdict', 'confidence', 'position_pct', 'stages']
      },
      render: (_args, value) => {
        const summary = [
          `${value.symbol || ''} ${value.name || ''}：${value.rating} · ${value.verdict} · `
            + `信心 ${value.confidence} · 仓位 ${value.position_pct}%`,
          '',
          '【组合经理结论】',
          String(value.judge?.executive_summary || '').trim(),
          value.judge?.investment_thesis ? `\n【投资论点】\n${value.judge.investment_thesis}` : '',
          '',
          '【证据快照】',
          String(value.evidence || '').trim(),
          '',
          '【辩论全过程】',
          formatTranscript(value.stages)
        ].join('\n');
        return [{ type: 'text', text: summary }];
      }
    },
    timeoutMs: 300000,
    async execute({ symbol, asof }) {
      const paths = currentPaths();
      if (!/^\d{6}\.(SH|SZ)$/.test(symbol || '')) throw new Error('symbol 需形如 600519.SH');
      const p = withHome(paths, await ensureCode(paths));
      if (!p) throw new Error('ICC 代码目录不可用：缺少 run_debate.py');
      const args = [p.layout.debate, '--symbol', symbol, '--data-dir', p.data];
      if (asof) args.push('--asof', asof);
      const out = await runPython(p, args);
      const result = JSON.parse(out);
      // Python 侧用 {ok:false, code, error} 表示数据/密钥/LLM 失败；
      // 直接返回会让 DSH 按成功结果的 schema 校验，报“缺少 rating/stages”。
      if (result && result.ok === false) {
        const hint = result.code === 'NEED_DATA'
          ? `\n可以调用 icc_sync 补 ${symbol} 的日线、快照与新闻；调用前先征得用户同意。`
          : '';
        const error = new Error((result.error || result.code || '辩论失败') + hint);
        error.code = result.code;
        error.data = result;
        throw error;
      }
      return result;
    }
  },
  {
    name: 'news_status',
    description: '检查本地新闻库的时效，不联网：返回最新新闻日期、距 asof 天数、是否偏旧、条数。依赖本地新闻前先调用；stale=true 或 count=0 时先询问用户是否用 icc_sync 更新。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        symbol: { type: 'string', description: '标的，如 600360.SH' },
        asof: { type: 'string', description: '虚拟当前日期 YYYY-MM-DD，默认今天' },
        max_age_days: { type: 'number', description: '超过多少天算偏旧，默认 3' }
      },
      required: ['symbol']
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: true,
        properties: {
          ok: { type: 'boolean' },
          symbol: { type: 'string' },
          count: { type: 'number' },
          latest: { type: ['string', 'null'] },
          age_days: { type: ['number', 'null'] },
          stale: { type: 'boolean' }
        },
        required: ['ok', 'symbol', 'count', 'stale']
      },
      render: (_args, v) => [{
        type: 'text',
        text: v.count
          ? `本地新闻：${v.count} 条，最新 ${v.latest}，距 ${v.asof || '当前'} ${v.age_days} 天，${v.stale ? '已偏旧' : '仍新鲜'}`
          : `本地没有已打分新闻（${v.symbol}）`
      }]
    },
    async execute({ symbol, asof = '', max_age_days = 3 }) {
      return runApi(currentPaths(), [
        'news-status', '--symbol', symbol, '--asof', asof,
        '--max-age-days', String(max_age_days)
      ]);
    }
  },
  {
    name: 'icc_sync',
    description: '按需把标的加入自选并补齐数据：3 年日线、实时快照、可选新闻抓取与情感打分。只在用户明确同意联网同步后调用；补完再重试 stock_debate。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        symbols: {
          type: 'array',
          description: '要补数据的标的，如 ["600360.SH"]',
          items: { type: 'string' }
        },
        with_news: { type: 'boolean', description: '是否同时抓取并打分新闻，默认 true' },
        years: { type: 'number', description: '回看年数，默认 3' }
      },
      required: ['symbols']
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: true,
        properties: {
          ok: { type: 'boolean' },
          results: { type: 'array', items: { type: 'object', additionalProperties: true } }
        },
        required: ['ok', 'results']
      },
      render: (_args, value) => [{
        type: 'text',
        text: ['数据补充完成', ...(value.results || []).map((r) => (
          r.ok
            ? `${r.symbol} ${r.name || ''}：新增日线 ${r.bars ?? 0}，快照 ${r.quotes ?? 0}，新闻 ${r.news?.kept ?? 0}`
            : `${r.symbol}：失败 ${r.error || ''}`
        ))].join('\n')
      }]
    },
    timeoutMs: 300000,
    async execute({ symbols, with_news = true, years = 3 }) {
      const list = [...new Set((symbols || []).map((s) => String(s).trim().toUpperCase()))];
      if (list.length === 0) throw new Error('symbols 至少给一个');
      for (const s of list) {
        if (!/^\d{6}\.(SH|SZ)$/.test(s)) throw new Error(`symbol 需形如 600519.SH：${s}`);
      }
      const paths = currentPaths();
      const p = withHome(paths, await ensureCode(paths));
      if (!p.layout.sync) {
        throw new Error('当前 ICC 代码版本没有 sync_symbol.py，请先更新工作空间里的 ICC 代码');
      }
      const results = [];
      for (const symbol of list) {
        const args = [
          p.layout.sync,
          '--symbol', symbol,
          '--data-dir', p.data,
          '--years', String(years)
        ];
        if (with_news !== false) args.push('--with-news');
        results.push(JSON.parse(await runPython(p, args)));
      }
      if (!results.some((r) => r.ok)) {
        throw new Error(results[0]?.error || '数据同步失败');
      }
      return { ok: true, results };
    }
  },
  {
    name: 'debate_record',
    description: '读取已保存的完整辩论记录：按 run_id 精确取回，或按 symbol 取最近一次。包含 stages 全过程、证据快照、各角色发言与最终裁决，和仪表盘「辩论过程」页签是同一份数据。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        run_id: { type: 'number', description: 'stock_debate 返回的 run_id；优先使用' },
        symbol: { type: 'string', description: '如 600519.SH；没有 run_id 时取该标的最近一次' }
      }
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: true,
        properties: {
          ok: { type: 'boolean' },
          debate: {
            type: 'object',
            additionalProperties: true,
            properties: {
              run_id: { type: 'number' },
              symbol: { type: 'string' },
              stages: { type: 'array', items: { type: 'object', additionalProperties: true } },
              evidence: { type: 'string' }
            },
            required: ['symbol', 'stages']
          }
        },
        required: ['debate']
      },
      render: (_args, value) => {
        const d = value.debate || {};
        const meta = `${d.name || ''}（${d.symbol}）· ${d.rating} / ${d.verdict} · `
          + `信心 ${d.confidence} · 仓位 ${d.position_pct}% · 记录 #${d.run_id || value.run_id || '—'}`;
        return [{
          type: 'text',
          text: [meta, '', '【证据快照】', String(d.evidence || '').trim(), '',
            '【辩论全过程】', formatTranscript(d.stages)].join('\n')
        }];
      }
    },
    timeoutMs: 30000,
    async execute(args) {
      const paths = currentPaths();
      const cli = ['debate-latest'];
      if (args.run_id) cli.push('--run-id', String(args.run_id));
      else if (args.symbol) cli.push('--symbol', args.symbol);
      else throw new Error('run_id 和 symbol 至少给一个');
      const res = await runApi(paths, cli);
      if (!res.ok) throw new Error(res.error || '读取失败');
      return res;
    }
  },
  {
    name: 'icc_install',
    description: '把 ICC 代码下载到当前工作空间（git clone）。仅在工作空间缺少代码、且用户明确同意后调用；已有代码时直接返回现有路径。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {}
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: true,
        properties: {
          ok: { type: 'boolean' },
          home: { type: 'string' },
          workspace: { type: 'string' },
          reports: { type: 'string' },
          data: { type: 'string' }
        },
        required: ['ok', 'home']
      },
      render: (_args, value) => [{
        type: 'text',
        text: `ICC 代码已就绪\n代码：${value.home}\n报告：${value.reports}\n数据库：${value.data}`
      }]
    },
    timeoutMs: 360000,
    async execute() {
      const paths = currentPaths();
      const p = withHome(paths, await ensureCode(paths));
      if (!p) throw new Error('下载完成但没有找到 dashboard_api.py');
      return {
        ok: true,
        home: p.home,
        workspace: p.workspace,
        reports: p.reports,
        data: p.data
      };
    }
  }
  ];
}

// --------------------------------------------------------------------------- //
// 宿主 HTTP 路由
// --------------------------------------------------------------------------- //
function sendJson(response, status, value) {
  response.writeHead(status, {
    'cache-control': 'no-store',
    'content-type': 'application/json; charset=utf-8'
  });
  response.end(JSON.stringify(value));
}

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buf.length;
    if (size > 64 * 1024) throw new Error('请求体过大');
    chunks.push(buf);
  }
  const text = Buffer.concat(chunks).toString('utf8').trim();
  return text ? JSON.parse(text) : {};
}

function buildArgs(command, params) {
  const args = [command];
  const push = (flag, value) => {
    if (value !== undefined && value !== null && value !== '') args.push(flag, String(value));
  };
  if (command === 'state') {
    push('--account', params.account);
    push('--limit', params.limit);
  } else if (command === 'create-account') {
    push('--name', params.name);
    push('--cash', params.cash);
  } else if (command === 'reset-account') {
    push('--account', params.account);
    push('--cash', params.cash);
  } else if (command === 'set-asof') {
    push('--account', params.account);
    push('--action', params.action);
    push('--date', params.date);
  } else if (command === 'auto-trade') {
    push('--account', params.account);
    push('--symbols', params.symbols);
    push('--limit', params.limit);
    if (params.noCouncil) args.push('--no-council');
  } else if (command === 'report') {
    push('--account', params.account);
  } else if (command === 'news-status') {
    push('--symbol', params.symbol);
    push('--asof', params.asof);
    push('--max-age-days', params.max_age_days);
  } else if (command === 'search') {
    push('--keyword', params.q || params.keyword);
    push('--limit', params.limit);
  } else if (command === 'watch-add') {
    push('--symbol', params.symbol);
    push('--name', params.name);
    push('--years', params.years);
    if (params.withNews !== false) args.push('--with-news');
  } else if (command === 'debate-latest') {
    push('--symbol', params.symbol);
  } else if (command === 'schedules-add') {
    push('--type', params.type);
    push('--time', params.time);
    push('--days', Array.isArray(params.days) ? params.days.join(',') : params.days);
    push('--account', params.account);
    push('--symbols', params.symbols);
  } else if (command === 'schedules-toggle') {
    push('--id', params.id);
    push('--enabled', params.enabled ? 1 : 0);
  } else if (command === 'schedules-delete') {
    push('--id', params.id);
  }
  return args;
}

/** 统一错误结构：代码未安装时返回可操作的 NEED_INSTALL，而不是裸的 fs/git 错误。 */
function failurePayload(paths, error) {
  const message = String(error?.message ?? error);
  if (error?.code === 'NEED_INSTALL' || !paths.home) {
    return {
      ok: false,
      code: 'NEED_INSTALL',
      error: '工作空间里还没有 ICC 代码，需要先下载。',
      detail: error?.detail !== undefined ? error.detail : message,
      repoUrl: error?.data?.repoUrl || paths.repoUrl,
      target: error?.data?.target || paths.cloneDir
    };
  }
  return { ok: false, error: message };
}

function registerRoutes(webServer, currentPaths) {
  const routes = [
    { path: '/icc-tools/api/install', method: 'POST', install: true },
    { path: '/icc-tools/api/state', method: 'GET', command: 'state' },
    { path: '/icc-tools/api/watch/add', method: 'POST', command: 'watch-add' },
    { path: '/icc-tools/api/search', method: 'GET', command: 'search' },
    { path: '/icc-tools/api/news/status', method: 'GET', command: 'news-status' },
    { path: '/icc-tools/api/accounts/create', method: 'POST', command: 'create-account' },
    { path: '/icc-tools/api/accounts/reset', method: 'POST', command: 'reset-account' },
    { path: '/icc-tools/api/accounts/asof', method: 'POST', command: 'set-asof' },
    { path: '/icc-tools/api/auto-trade', method: 'POST', command: 'auto-trade' },
    { path: '/icc-tools/api/report', method: 'POST', command: 'report' },
    { path: '/icc-tools/api/debate/latest', method: 'GET', command: 'debate-latest' },
    { path: '/icc-tools/api/schedules', method: 'GET', command: 'schedules-list' },
    { path: '/icc-tools/api/schedules/add', method: 'POST', command: 'schedules-add' },
    { path: '/icc-tools/api/schedules/toggle', method: 'POST', command: 'schedules-toggle' },
    { path: '/icc-tools/api/schedules/delete', method: 'POST', command: 'schedules-delete' }
  ];
  const disposers = routes.map((route) => webServer.register({
    kind: 'exact',
    path: route.path,
    handler: async (request, response) => {
      if (request.method !== route.method) {
        sendJson(response, 405, { ok: false, error: `只支持 ${route.method}` });
        return;
      }
      const paths = currentPaths();
      try {
        if (route.install) {
          const p = withHome(paths, await ensureCode(paths));
          if (!p) throw new Error('下载完成但没有找到 dashboard_api.py');
          sendJson(response, 200, {
            ok: true,
            home: p.home,
            workspace: p.workspace,
            reports: p.reports,
            data: p.data
          });
          return;
        }
        let params = {};
        if (route.method === 'GET') {
          const url = new URL(request.url ?? '/', 'http://localhost');
          params = Object.fromEntries(url.searchParams.entries());
        } else {
          params = await readJson(request);
        }
        const result = await runApi(paths, buildArgs(route.command, params));
        sendJson(response, 200, result);
      } catch (error) {
        sendJson(response, 200, failurePayload(paths, error));
      }
    }
  }));
  return () => { for (const dispose of disposers) dispose(); };
}

const TICK_MS = 60 * 1000;

function startScheduler(ctx, currentPaths) {
  let running = false;
  const tick = () => {
    if (running) return;
    // 还没安装代码时不轮询，避免每分钟刷一条失败日志。
    if (!currentPaths().home) return;
    running = true;
    runApi(currentPaths(), ['scheduler-tick'])
      .then((res) => {
        if (res?.executed?.length) {
          ctx.logger?.info?.(`[icc-tools] 定时任务执行 ${res.executed.length} 项`);
        }
      })
      .catch((error) => ctx.logger?.warn?.(`[icc-tools] 定时任务失败：${error.message}`))
      .finally(() => { running = false; });
  };
  const timer = setInterval(tick, TICK_MS);
  timer.unref?.();
  tick();
  return () => clearInterval(timer);
}

export const name = 'dsh-icc-tools';
export const inject = ['tools'];

export function apply(ctx, config = {}) {
  // 每次调用都重新读取 config，插件页改完设置后无需重启即可生效。
  const currentPaths = () => resolvePaths({
    workspace: readConfig(config.workspace),
    repoUrl: readConfig(config.repoUrl)
  });
  const paths = currentPaths();
  const tools = createTools(currentPaths);
  for (const t of tools) ctx.tools.register(t);
  ctx.logger?.info?.(
    `[icc-tools] 已注册 ${tools.length} 个工具；代码 ${paths.home || '未找到'}；`
    + `工作空间 ${paths.workspace}；报告 ${paths.reports}`
  );

  if (typeof ctx.inject === 'function') {
    ctx.inject(['webServer'], (host) => {
      host.effect(
        () => registerRoutes(host.webServer, currentPaths),
        'dsh-icc-tools: http routes'
      );
    });
  }
  ctx.effect?.(() => startScheduler(ctx, currentPaths), 'dsh-icc-tools: scheduler');
}

export { Config, resolvePaths, createTools };
