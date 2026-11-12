/**
 * 浏览器端：ICC 投研仪表盘。
 *
 * 两处注册：
 *   sidebar.panellist —— 左侧导航里的「ICC 投研」入口；
 *   main (key=icc-dashboard) —— 点击入口后占据主区域的独立页面。
 *
 * 另在输入框上方保留一条轻量提示条，方便在对话里直接咨询。
 * 所有数据来自宿主路由 /icc-tools/api/*，组件本身不读写业务数据。
 */
window.__ModuleLoader__.load({
  id: 'dsh-icc-tools',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const useState = React.useState;
    const useEffect = React.useEffect;
    const useCallback = React.useCallback;
    const useMemo = React.useMemo;

    // 设置卡片依赖宿主的共享表单原语；没有时只隐藏设置卡片，仪表盘照常工作。
    let primitives = null;
    try {
      primitives = require('@deepseek-ai/dsh-client-ui-primitives');
    } catch (error) {
      primitives = null;
    }

    const PANEL_ID = 'icc-dashboard';
    const API = '/icc-tools/api';
    const ACCOUNT_KEY = 'icc-dashboard-account';

    // ------------------------------------------------------------------ //
    // 请求
    // ------------------------------------------------------------------ //
    async function api(path, options) {
      const res = await fetch(API + path, {
        headers: { 'content-type': 'application/json' },
        ...options
      });
      let data = null;
      try {
        data = await res.json();
      } catch (error) {
        throw new Error(`返回不是 JSON（HTTP ${res.status}）`);
      }
      if (!res.ok || data?.ok === false) {
        const err = new Error(data?.error || `请求失败（HTTP ${res.status}）`);
        err.data = data;
        throw err;
      }
      return data;
    }

    const num = (v, digits = 2) => (v === null || v === undefined || Number.isNaN(Number(v)))
      ? '—'
      : Number(v).toLocaleString('zh-CN', { minimumFractionDigits: digits, maximumFractionDigits: digits });
    const pct = (v) => (v === null || v === undefined) ? '—' : `${Number(v) >= 0 ? '+' : ''}${Number(v).toFixed(2)}%`;
    const signClass = (v) => (v > 0 ? 'up' : (v < 0 ? 'down' : 'flat'));
    const money = (v) => (v === null || v === undefined) ? '—' : `¥${num(v)}`;

    // ------------------------------------------------------------------ //
    // 样式
    // ------------------------------------------------------------------ //
    const CSS = `
.icc-page { height: 100%; overflow: auto; padding: 22px 28px 80px; color: var(--dsw-alias-label-primary, inherit); background: var(--dsw-alias-bg-base, transparent); font-size: var(--dsh-content-font-size, 14px); }
.icc-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; flex-wrap: wrap; margin-bottom: 14px; }
.icc-title { font-size: 20px; font-weight: 650; letter-spacing: .2px; }
.icc-sub { color: var(--dsw-alias-label-tertiary, rgba(127,127,127,.9)); font-size: 12px; margin-top: 4px; }
.icc-tabs { display: flex; gap: 4px; border-bottom: 1px solid var(--dsw-alias-border-l2, rgba(127,127,127,.25)); margin: 14px 0 18px; }
.icc-tab { border: 0; background: transparent; color: var(--dsw-alias-label-secondary, inherit); padding: 8px 12px; border-radius: 8px 8px 0 0; cursor: pointer; font: inherit; font-size: 13px; }
.icc-tab[data-active="true"] { color: var(--dsw-alias-label-primary, inherit); background: var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,.12)); box-shadow: inset 0 -2px 0 var(--dsw-alias-brand-primary, #4d6bfe); }
.icc-card { border: 1px solid var(--dsw-alias-border-l2, rgba(127,127,127,.22)); background: var(--dsw-alias-bg-layer-1, rgba(127,127,127,.05)); border-radius: 12px; padding: 16px 18px; }
.icc-grid { display: grid; gap: 12px; }
.icc-kpis { grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); }
.icc-kpi-label { font-size: 12px; color: var(--dsw-alias-label-tertiary, rgba(127,127,127,.9)); }
.icc-kpi-value { font-size: 21px; font-weight: 640; margin-top: 6px; font-variant-numeric: tabular-nums; }
.icc-kpi-note { font-size: 12px; margin-top: 4px; color: var(--dsw-alias-label-tertiary, rgba(127,127,127,.9)); }
.icc-row { display: grid; grid-template-columns: 1.15fr .85fr; gap: 14px; }
.icc-row3 { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
@media (max-width: 980px) { .icc-row, .icc-row3 { grid-template-columns: 1fr; } }
.icc-section-title { display: flex; align-items: center; justify-content: space-between; gap: 10px; font-size: 13px; font-weight: 600; margin-bottom: 10px; }
.icc-hint { font-size: 12px; color: var(--dsw-alias-label-tertiary, rgba(127,127,127,.9)); font-weight: 400; }
table.icc-table { width: 100%; border-collapse: collapse; font-size: 12.5px; font-variant-numeric: tabular-nums; }
table.icc-table th { text-align: right; font-weight: 500; color: var(--dsw-alias-label-tertiary, rgba(127,127,127,.9)); padding: 6px 8px; border-bottom: 1px solid var(--dsw-alias-border-l2, rgba(127,127,127,.22)); white-space: nowrap; }
table.icc-table th:first-child, table.icc-table td:first-child { text-align: left; }
table.icc-table td { text-align: right; padding: 7px 8px; border-bottom: 1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.13)); white-space: nowrap; }
table.icc-table tr:last-child td { border-bottom: 0; }
.icc-sym { font-variant-numeric: tabular-nums; font-size: 12px; color: var(--dsw-alias-label-secondary, inherit); }
.icc-name { margin-left: 6px; }
.icc-up { color: var(--dsw-alias-state-error-primary, #e5484d); }
.icc-down { color: var(--dsw-alias-state-success-primary, #2f9e6f); }
.icc-flat { color: var(--dsw-alias-label-tertiary, rgba(127,127,127,.9)); }
.icc-btn { border: 1px solid var(--dsw-alias-border-l3, rgba(127,127,127,.35)); background: var(--dsw-alias-bg-layer-2, rgba(127,127,127,.08)); color: var(--dsw-alias-label-primary, inherit); font: inherit; font-size: 12.5px; padding: 7px 13px; border-radius: 8px; cursor: pointer; }
.icc-btn:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,.16)); }
.icc-btn[disabled] { opacity: .5; cursor: not-allowed; }
.icc-btn-primary { background: var(--dsw-alias-button-primary-fill, #4d6bfe); border-color: transparent; color: var(--dsw-alias-label-primary-foreground, #fff); }
.icc-btn-primary:hover { background: var(--dsw-alias-button-primary-hover, #3f5ae0); }
.icc-btn-danger { color: var(--dsw-alias-state-error-primary, #e5484d); }
.icc-btn-sm { padding: 4px 9px; font-size: 12px; border-radius: 6px; }
.icc-input, .icc-select { background: var(--dsw-alias-bg-layer-1, rgba(127,127,127,.06)); border: 1px solid var(--dsw-alias-border-l3, rgba(127,127,127,.3)); color: var(--dsw-alias-label-primary, inherit); border-radius: 8px; padding: 7px 10px; font: inherit; font-size: 12.5px; outline: none; }
.icc-input:focus, .icc-select:focus { border-color: var(--dsw-alias-brand-primary, #4d6bfe); }
.icc-form { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
.icc-chip { display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; border-radius: 999px; border: 1px solid var(--dsw-alias-border-l3, rgba(127,127,127,.35)); font-size: 12px; cursor: pointer; user-select: none; }
.icc-chip[data-on="true"] { border-color: var(--dsw-alias-brand-primary, #4d6bfe); background: var(--dsw-alias-interactive-bg-active, rgba(77,107,254,.14)); }
.icc-banner { border-radius: 10px; padding: 10px 14px; font-size: 12.5px; margin-bottom: 14px; border: 1px solid var(--dsw-alias-border-l2, rgba(127,127,127,.25)); }
.icc-banner-error { color: var(--dsw-alias-state-error-primary, #e5484d); border-color: var(--dsw-alias-state-error-primary, #e5484d); }
.icc-banner-info { color: var(--dsw-alias-label-secondary, inherit); }
.icc-install { display: flex; flex-direction: column; gap: 8px; border-color: var(--dsw-alias-state-warning-primary, #d48a00); }
.icc-install-title { font-size: 14px; font-weight: 600; }
.icc-install-actions { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.icc-mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; word-break: break-all; opacity: .8; }
.icc-hint { font-size: 12px; color: var(--dsw-alias-label-tertiary, rgba(127,127,127,.9)); }
.icc-install-detail { font-size: 12px; color: var(--dsw-alias-state-error-primary, #e5484d); white-space: pre-wrap; }
.icc-busy { display: inline-block; width: 12px; height: 12px; border: 2px solid var(--dsw-alias-border-l3, rgba(127,127,127,.4)); border-top-color: var(--dsw-alias-brand-primary, #4d6bfe); border-radius: 50%; animation: icc-spin .8s linear infinite; vertical-align: -2px; margin-right: 7px; }
@keyframes icc-spin { to { transform: rotate(360deg); } }
.icc-pre { white-space: pre-wrap; word-break: break-word; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px; line-height: 1.65; margin: 0; max-height: 460px; overflow: auto; }
.icc-empty { padding: 26px 10px; text-align: center; color: var(--dsw-alias-label-tertiary, rgba(127,127,127,.9)); font-size: 12.5px; }
.icc-list { display: flex; flex-direction: column; gap: 8px; }
.icc-item { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 12px; border: 1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.16)); border-radius: 10px; }
.icc-item-main { min-width: 0; }
.icc-item-title { font-size: 13px; font-weight: 550; }
.icc-item-sub { font-size: 11.5px; color: var(--dsw-alias-label-tertiary, rgba(127,127,127,.9)); margin-top: 3px; }
.icc-actions { display: flex; gap: 8px; flex-wrap: wrap; }
.icc-day { display: inline-flex; gap: 4px; }
.icc-day button { width: 28px; height: 26px; border-radius: 6px; border: 1px solid var(--dsw-alias-border-l3, rgba(127,127,127,.3)); background: transparent; color: inherit; font-size: 11.5px; cursor: pointer; }
.icc-day button[data-on="true"] { background: var(--dsw-alias-interactive-bg-active, rgba(77,107,254,.14)); border-color: var(--dsw-alias-brand-primary, #4d6bfe); }
.icc-decision { border-left: 3px solid var(--dsw-alias-border-l3, rgba(127,127,127,.35)); padding: 8px 0 8px 12px; margin-bottom: 10px; }
.icc-decision:last-child { margin-bottom: 0; }
.icc-tag { display: inline-block; padding: 1px 7px; border-radius: 5px; font-size: 11.5px; background: var(--dsw-alias-bg-layer-3, rgba(127,127,127,.16)); margin-left: 6px; }
`;

    // ------------------------------------------------------------------ //
    // 小组件
    // ------------------------------------------------------------------ //
    function Kpi(props) {
      return h('div', { className: 'icc-card' },
        h('div', { className: 'icc-kpi-label' }, props.label),
        h('div', { className: 'icc-kpi-value ' + (props.tone ? 'icc-' + props.tone : '') }, props.value),
        props.note ? h('div', { className: 'icc-kpi-note' }, props.note) : null
      );
    }

    function EquitySpark(props) {
      const points = props.points || [];
      if (points.length < 2) return h('div', { className: 'icc-empty' }, '暂无净值曲线，执行一次交易或刷新快照后生成');
      const values = points.map((p) => Number(p.equity) || 0);
      const min = Math.min(...values);
      const max = Math.max(...values);
      const span = max - min || 1;
      const w = 640;
      const hgt = 150;
      const step = w / Math.max(1, values.length - 1);
      const d = values.map((v, i) => `${i === 0 ? 'M' : 'L'}${(i * step).toFixed(1)},${(hgt - ((v - min) / span) * (hgt - 18) - 9).toFixed(1)}`).join(' ');
      const rise = values[values.length - 1] >= values[0];
      const color = rise ? 'var(--dsw-alias-state-error-primary, #e5484d)' : 'var(--dsw-alias-state-success-primary, #2f9e6f)';
      return h('svg', { viewBox: `0 0 ${w} ${hgt}`, width: '100%', height: hgt, role: 'img', 'aria-label': '净值曲线' },
        h('path', { d, fill: 'none', stroke: color, strokeWidth: 2 }),
        h('path', {
          d: `${d} L${w},${hgt} L0,${hgt} Z`,
          fill: color, opacity: 0.08, stroke: 'none'
        })
      );
    }

    function PositionsTable(props) {
      const rows = props.rows || [];
      if (!rows.length) return h('div', { className: 'icc-empty' }, '暂无持仓');
      return h('table', { className: 'icc-table' },
        h('thead', null, h('tr', null,
          ['标的', '数量', '成本', '现价', '市值', '盈亏', '权重'].map((t) => h('th', { key: t }, t))
        )),
        h('tbody', null, rows.map((p) => h('tr', { key: p.symbol },
          h('td', null, h('span', { className: 'icc-sym' }, p.symbol), h('span', { className: 'icc-name' }, p.name)),
          h('td', null, num(p.qty, 0)),
          h('td', null, num(p.avg_cost, 3)),
          h('td', null, num(p.price, 3)),
          h('td', null, num(p.value)),
          h('td', { className: 'icc-' + signClass(p.pnl) }, num(p.pnl)),
          h('td', null, pct(p.weight))
        )))
      );
    }

    function WatchTable(props) {
      const rows = (props.rows || []).slice(0, 14);
      if (!rows.length) return h('div', { className: 'icc-empty' }, '自选股为空');
      return h('table', { className: 'icc-table' },
        h('thead', null, h('tr', null, ['标的', '分组', '最新', '涨跌'].map((t) => h('th', { key: t }, t)))),
        h('tbody', null, rows.map((r) => h('tr', { key: r.symbol },
          h('td', null, h('span', { className: 'icc-sym' }, r.symbol), h('span', { className: 'icc-name' }, r.iname || r.qname || '')),
          h('td', null, r.group_name || '—'),
          h('td', null, num(r.price, 2)),
          h('td', { className: 'icc-' + signClass(r.pct) }, pct(r.pct))
        )))
      );
    }

    function TradesTable(props) {
      const rows = props.rows || [];
      if (!rows.length) return h('div', { className: 'icc-empty' }, '暂无成交');
      return h('table', { className: 'icc-table' },
        h('thead', null, h('tr', null, ['日期', '标的', '方向', '数量', '价格', '金额'].map((t) => h('th', { key: t }, t)))),
        h('tbody', null, rows.slice(0, 12).map((t, i) => h('tr', { key: `${t.trade_date}-${i}` },
          h('td', null, t.trade_date),
          h('td', null, h('span', { className: 'icc-sym' }, t.symbol), h('span', { className: 'icc-name' }, t.name || '')),
          h('td', { className: t.side === 'buy' ? 'icc-up' : 'icc-down' }, t.side === 'buy' ? '买入' : '卖出'),
          h('td', null, num(t.qty, 0)),
          h('td', null, num(t.price, 3)),
          h('td', null, num(t.amount))
        )))
      );
    }

    // ------------------------------------------------------------------ //
    // 仪表盘
    // ------------------------------------------------------------------ //
    function Dashboard() {
      const [data, setData] = useState(null);
      const [account, setAccount] = useState(() => {
        const raw = localStorage.getItem(ACCOUNT_KEY);
        return raw ? Number(raw) : null;
      });
      const [tab, setTab] = useState('overview');
      const [error, setError] = useState('');
      const [busy, setBusy] = useState('');
      const [toast, setToast] = useState('');
      const [installInfo, setInstallInfo] = useState(null);
      const [installing, setInstalling] = useState(false);

      const load = useCallback(async (aid, silent) => {
        if (!silent) setBusy((b) => b || '正在加载…');
        try {
          const query = aid ? `?account=${aid}&limit=20` : '?limit=20';
          const res = await api(`/state${query}`);
          setData(res);
          setError('');
          setInstallInfo(null);
          if (res.account && res.account.id !== aid) {
            setAccount(res.account.id);
            localStorage.setItem(ACCOUNT_KEY, String(res.account.id));
          }
        } catch (err) {
          if (err.data?.code === 'NEED_INSTALL') {
            setInstallInfo(err.data);
            setError('');
          } else {
            const detail = err.data?.detail ? `\n${err.data.detail}` : '';
            setError(`${err.message || err}${detail}`);
          }
        } finally {
          if (!silent) setBusy((b) => (b === '正在加载…' ? '' : b));
        }
      }, []);

      useEffect(() => { load(account); }, [account, load]);

      const flash = (msg) => {
        setToast(msg);
        setTimeout(() => setToast(''), 3200);
      };

      const install = async () => {
        setInstalling(true);
        setError('');
        try {
          const res = await api('/install', { method: 'POST', body: '{}' });
          setInstallInfo(null);
          await load(account, true);
          flash(`ICC 代码已下载到 ${res.home}`);
        } catch (err) {
          if (err.data?.code === 'NEED_INSTALL') setInstallInfo(err.data);
          setError(`${err.message || err}${err.data?.detail ? `\n${err.data.detail}` : ''}`);
        } finally {
          setInstalling(false);
        }
      };

      const installCard = () => h('div', { className: 'icc-card icc-install' },
        h('div', { className: 'icc-install-title' }, '工作空间还没有 ICC 代码'),
        h('div', { className: 'icc-hint' },
          `将下载到 ${installInfo?.target || '<工作空间>/icc-app'}：`),
        h('div', { className: 'icc-mono' }, installInfo?.repoUrl || ''),
        h('div', { className: 'icc-install-actions' },
          h('button', {
            className: 'icc-btn icc-btn-primary', disabled: installing, onClick: install
          }, installing ? '正在下载…' : '立即下载'),
          h('span', { className: 'icc-hint' }, '也可以在对话里说「帮我安装 ICC」，由 AI 完成')
        ),
        error ? h('div', { className: 'icc-install-detail' }, error) : null
      );

      const switchAccount = (id) => {
        setAccount(id);
        localStorage.setItem(ACCOUNT_KEY, String(id));
      };

      if (!data && installInfo) {
        return h('div', { className: 'icc-page' },
          h('style', null, CSS),
          h('div', { className: 'icc-head' },
            h('div', null,
              h('div', { className: 'icc-title' }, 'ICC 投研仪表盘'),
              h('div', { className: 'icc-sub' }, '工作空间尚未初始化')
            ),
            h('div', { className: 'icc-actions' },
              h('button', {
                className: 'icc-btn', disabled: installing, onClick: () => load(account)
              }, '重新检测')
            )
          ),
          installCard()
        );
      }

      if (!data && !error) {
        return h('div', { className: 'icc-page' },
          h('style', null, CSS),
          h('div', { className: 'icc-banner icc-banner-info' }, h('span', { className: 'icc-busy' }), busy || '正在加载 ICC 仪表盘…')
        );
      }

      const pf = data?.portfolio || {};
      const acc = data?.account || {};
      const schedules = data?.schedules || [];
      const watchlist = data?.watchlist || [];

      return h('div', { className: 'icc-page' },
        h('style', null, CSS),

        h('div', { className: 'icc-head' },
          h('div', null,
            h('div', { className: 'icc-title' }, 'ICC 投研仪表盘'),
            h('div', { className: 'icc-sub' },
              `虚拟仓 ${acc.name || '—'} · ${acc.asof || '—'}${acc.live ? '（实时）' : '（回放）'} · 行情 ${data?.last_sync || '未同步'}`)
          ),
          h('div', { className: 'icc-actions' },
            h('select', {
              className: 'icc-select', value: acc.id || '', onChange: (e) => switchAccount(Number(e.target.value))
            }, (data?.accounts || []).map((a) => h('option', { key: a.id, value: a.id }, `${a.name}（#${a.id}）`))),
            h('button', { className: 'icc-btn', onClick: () => load(account), disabled: !!busy }, '刷新')
          )
        ),

        installInfo ? installCard() : null,
        error && !installInfo ? h('div', { className: 'icc-banner icc-banner-error' }, error) : null,
        toast ? h('div', { className: 'icc-banner icc-banner-info' }, toast) : null,
        busy && busy !== '正在加载…' ? h('div', { className: 'icc-banner icc-banner-info' },
          h('span', { className: 'icc-busy' }), busy) : null,

        h('div', { className: 'icc-grid icc-kpis' },
          h(Kpi, { label: '总资产', value: money(pf.equity), note: `初始 ${money(pf.initial_cash)}` }),
          h(Kpi, { label: '累计盈亏', value: money(pf.total_pnl), tone: signClass(pf.total_pnl), note: `收益率 ${pct(pf.total_pnl_pct)}` }),
          h(Kpi, { label: '现金', value: money(pf.cash), note: `现金占比 ${pct(pf.cash_ratio)}` }),
          h(Kpi, { label: '持仓市值', value: money(pf.market_value), note: `${(pf.positions || []).length} 个持仓` }),
          h(Kpi, {
            label: '最近决议',
            value: data?.latest_debate ? data.latest_debate.verdict : '暂无',
            note: data?.latest_debate
              ? `${data.latest_debate.name || data.latest_debate.symbol} · ${data.latest_debate.rating} · 仓位 ${data.latest_debate.position_pct}%`
              : '去「AI 操盘」跑一次辩论'
          })
        ),

        h('div', { className: 'icc-tabs' },
          [['overview', '概览'], ['accounts', '账户'], ['trade', 'AI 操盘'], ['debate', '辩论过程'], ['schedules', '定时任务'], ['report', '报告']]
            .map(([id, label]) => h('button', {
              key: id, className: 'icc-tab', 'data-active': tab === id ? 'true' : 'false',
              onClick: () => setTab(id)
            }, label))
        ),

        tab === 'overview' ? h(Overview, { data, acc, pf, watchlist }) : null,
        tab === 'accounts' ? h(Accounts, { data, acc, load, flash, setBusy, busy }) : null,
        tab === 'trade' ? h(AutoTrade, { acc, watchlist, load, setBusy, busy }) : null,
        tab === 'debate' ? h(Debate, { watchlist, flash }) : null,
        tab === 'schedules' ? h(Schedules, { schedules, account: acc.id, taskTypes: data?.task_types || [], refresh: () => load(account, true), flash }) : null,
        tab === 'report' ? h(Report, { account: acc.id, flash, paths: data?.paths }) : null
      );
    }

    function Overview(props) {
      const { data, pf, watchlist } = props;
      return h('div', { className: 'icc-grid', style: { gap: 14 } },
        h('div', { className: 'icc-row' },
          h('div', { className: 'icc-card' },
            h('div', { className: 'icc-section-title' }, '净值曲线', h('span', { className: 'icc-hint' }, `${(data?.equity || []).length} 个交易日`)),
            h(EquitySpark, { points: data?.equity || [] })
          ),
          h('div', { className: 'icc-card' },
            h('div', { className: 'icc-section-title' }, '指数'),
            h('table', { className: 'icc-table' },
              h('tbody', null, (data?.indices || []).map((i) => h('tr', { key: i.key },
                h('td', null, i.name),
                h('td', null, num(i.close, 2)),
                h('td', { className: 'icc-' + signClass(i.pct) }, pct(i.pct))
              )))
            )
          )
        ),
        h('div', { className: 'icc-row' },
          h('div', { className: 'icc-card' },
            h('div', { className: 'icc-section-title' }, '持仓明细', h('span', { className: 'icc-hint' }, `仓位 ${pct(100 - (pf.cash_ratio || 0))}`)),
            h(PositionsTable, { rows: pf.positions || [] })
          ),
          h('div', { className: 'icc-card' },
            h('div', { className: 'icc-section-title' }, '自选行情', h('span', { className: 'icc-hint' }, `共 ${watchlist.length} 只`)),
            h(WatchTable, { rows: watchlist })
          )
        ),
        h('div', { className: 'icc-card' },
          h('div', { className: 'icc-section-title' }, '最近成交'),
          h(TradesTable, { rows: data?.trades || [] })
        )
      );
    }

    function Accounts(props) {
      const { data, acc, load, flash, setBusy, busy } = props;
      const [name, setName] = useState('');
      const [cash, setCash] = useState('1000000');
      const [resetCash, setResetCash] = useState('1000000');

      const create = async () => {
        if (!name.trim()) return flash('请先填账户名');
        setBusy('正在创建账户…');
        try {
          const res = await api('/accounts/create', { method: 'POST', body: JSON.stringify({ name: name.trim(), cash }) });
          setName('');
          localStorage.setItem(ACCOUNT_KEY, String(res.account_id));
          await load(res.account_id, true);
          flash('账户已创建');
        } catch (err) {
          flash(`创建失败：${err.message}`);
        } finally {
          setBusy('');
        }
      };

      const reset = async () => {
        if (!window.confirm(`确定清空「${acc.name}」的持仓、成交和净值，并把现金重置为 ${resetCash}？`)) return;
        setBusy('正在重置账户…');
        try {
          await api('/accounts/reset', { method: 'POST', body: JSON.stringify({ account: acc.id, cash: resetCash }) });
          await load(acc.id, true);
          flash('账户已重置');
        } catch (err) {
          flash(`重置失败：${err.message}`);
        } finally {
          setBusy('');
        }
      };

      const move = async (action) => {
        setBusy('正在调整虚拟日期…');
        try {
          await api('/accounts/asof', { method: 'POST', body: JSON.stringify({ account: acc.id, action }) });
          await load(acc.id, true);
          flash('虚拟日期已更新');
        } catch (err) {
          flash(`调整失败：${err.message}`);
        } finally {
          setBusy('');
        }
      };

      return h('div', { className: 'icc-grid', style: { gap: 14 } },
        h('div', { className: 'icc-card' },
          h('div', { className: 'icc-section-title' }, '虚拟仓账户', h('span', { className: 'icc-hint' }, `当前 #${acc.id} · ${acc.asof}`)),
          h('div', { className: 'icc-list' }, (data?.accounts || []).map((a) => h('div', { key: a.id, className: 'icc-item' },
            h('div', { className: 'icc-item-main' },
              h('div', { className: 'icc-item-title' }, `${a.name}${a.id === acc.id ? '（当前）' : ''}`),
              h('div', { className: 'icc-item-sub' }, `#${a.id} · 现金 ${money(a.cash)} · 初始 ${money(a.initial_cash)} · 虚拟日期 ${a.asof}`)
            ),
            h('button', {
              className: 'icc-btn icc-btn-sm', disabled: a.id === acc.id,
              onClick: () => { localStorage.setItem(ACCOUNT_KEY, String(a.id)); load(a.id); }
            }, a.id === acc.id ? '使用中' : '切换')
          )))
        ),
        h('div', { className: 'icc-row3' },
          h('div', { className: 'icc-card' },
            h('div', { className: 'icc-section-title' }, '新建账户'),
            h('div', { className: 'icc-form' },
              h('input', { className: 'icc-input', placeholder: '账户名', value: name, onChange: (e) => setName(e.target.value) }),
              h('input', { className: 'icc-input', style: { width: 130 }, placeholder: '初始资金', value: cash, onChange: (e) => setCash(e.target.value) }),
              h('button', { className: 'icc-btn icc-btn-primary', onClick: create, disabled: !!busy }, '创建')
            ),
            h('div', { className: 'icc-hint', style: { marginTop: 8 } }, '新账户从当天开始，独立的现金、持仓与净值。')
          ),
          h('div', { className: 'icc-card' },
            h('div', { className: 'icc-section-title' }, '重置与时间指针'),
            h('div', { className: 'icc-form' },
              h('input', { className: 'icc-input', style: { width: 130 }, value: resetCash, onChange: (e) => setResetCash(e.target.value) }),
              h('button', { className: 'icc-btn icc-btn-danger', onClick: reset, disabled: !!busy }, '清空并重置'),
              h('button', { className: 'icc-btn', onClick: () => move('next'), disabled: !!busy }, '下一交易日'),
              h('button', { className: 'icc-btn', onClick: () => move('today'), disabled: !!busy }, '回到今天')
            ),
            h('div', { className: 'icc-hint', style: { marginTop: 8 } }, '回放模式下成交都记在虚拟日期当天，不会用到未来行情。')
          )
        )
      );
    }

    function AutoTrade(props) {
      const { acc, watchlist, load, setBusy, busy } = props;
      const [selected, setSelected] = useState([]);
      const [result, setResult] = useState(null);
      const [withCouncil, setWithCouncil] = useState(false);

      const toggle = (symbol) => {
        setSelected((prev) => prev.includes(symbol) ? prev.filter((s) => s !== symbol) : [...prev, symbol]);
      };

      const run = async () => {
        const ok = window.confirm(
          `将让 AI 对${selected.length ? `选中的 ${selected.length} 个标的` : '自选股前 3 只'}跑完整辩论并自动调仓。\n`
          + '每个标的约 30–60 秒（含 LLM 调用），期间请勿关闭页面。继续？');
        if (!ok) return;
        setResult(null);
        setBusy('AI 正在辩论并操盘：分析师 → 多空 → 研究主管 → 交易员 → 三风控 → 组合经理…');
        try {
          const res = await api('/auto-trade', {
            method: 'POST',
            body: JSON.stringify({
              account: acc.id,
              symbols: selected.join(','),
              limit: selected.length || 3,
              noCouncil: !withCouncil
            })
          });
          setResult(res);
          await load(acc.id, true);
        } catch (err) {
          setResult({ ok: false, error: err.message });
        } finally {
          setBusy('');
        }
      };

      return h('div', { className: 'icc-grid', style: { gap: 14 } },
        h('div', { className: 'icc-card' },
          h('div', { className: 'icc-section-title' },
            '一键让 AI 操盘',
            h('span', { className: 'icc-hint' }, '按多智能体辩论的五档评级与仓位上限自动调仓')
          ),
          h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12, maxHeight: 190, overflow: 'auto' } },
            watchlist.map((w) => h('button', {
              key: w.symbol, className: 'icc-chip',
              'data-on': selected.includes(w.symbol) ? 'true' : 'false',
              onClick: () => toggle(w.symbol)
            }, `${w.iname || w.symbol}`))
          ),
          h('div', { className: 'icc-form' },
            h('label', { className: 'icc-chip', 'data-on': withCouncil ? 'true' : 'false', onClick: () => setWithCouncil((v) => !v) },
              '同时运行规则投委会（更慢但证据更全）'),
            h('button', { className: 'icc-btn icc-btn-primary', onClick: run, disabled: !!busy }, '开始 AI 操盘'),
            h('span', { className: 'icc-hint' }, selected.length ? `已选 ${selected.length} 个` : '未选则默认前 3 只')
          )
        ),
        result && result.ok === false
          ? h('div', { className: 'icc-banner icc-banner-error' }, result.error)
          : null,
        result && result.ok ? h('div', { className: 'icc-card' },
          h('div', { className: 'icc-section-title' }, '本次操盘结果', h('span', { className: 'icc-hint' }, `${result.started} → ${result.finished}`)),
          h('div', null, (result.decisions || []).map((d) => {
            const act = d.action || {};
            const res = act.result || {};
            const detail = act.reason || res.reason
              || (res.side ? `${res.side === 'buy' ? '买入' : '卖出'} ${res.qty} 股 @ ${res.price}` : '未执行');
            return h('div', { key: d.symbol, className: 'icc-decision' },
              h('div', { className: 'icc-item-title' },
                `${d.symbol} ${d.name || ''}`,
                h('span', { className: 'icc-tag' }, d.status === 'ok' ? `${d.rating} / ${d.verdict}` : '失败')
              ),
              h('div', { className: 'icc-item-sub' },
                d.status === 'ok'
                  ? `信心 ${d.confidence} · 目标仓位 ${d.position_pct}% · ${detail}`
                  : (d.error || '辩论失败')),
              d.summary ? h('div', { className: 'icc-item-sub' }, `结论：${String(d.summary).slice(0, 160)}`) : null
            );
          })),
          result.report_path ? h('div', { className: 'icc-hint', style: { marginTop: 10 } }, `报告已保存：${result.report_path}`) : null
        ) : null
      );
    }

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

    function Debate(props) {
      const [data, setData] = useState(null);
      const [symbol, setSymbol] = useState('');
      const [busy, setBusy] = useState(false);
      const [error, setError] = useState('');

      const load = async (sym) => {
        setBusy(true);
        setError('');
        try {
          const query = sym ? `?symbol=${encodeURIComponent(sym)}` : '';
          const res = await api(`/debate/latest${query}`);
          setData(res.debate);
        } catch (err) {
          setError(String(err.message || err));
        } finally {
          setBusy(false);
        }
      };

      useEffect(() => { load(''); }, []);

      const debate = data || {};
      const stages = debate.stages || [];

      return h('div', { className: 'icc-grid', style: { gap: 14 } },
        h('div', { className: 'icc-card' },
          h('div', { className: 'icc-section-title' },
            '最近一次完整辩论',
            h('div', { className: 'icc-actions' },
              h('select', {
                className: 'icc-select',
                value: symbol,
                onChange: (e) => { setSymbol(e.target.value); load(e.target.value); }
              },
                h('option', { value: '' }, '最新一条'),
                (props.watchlist || []).map((w) => h('option', { key: w.symbol, value: w.symbol }, `${w.iname || w.symbol}（${w.symbol}）`))
              ),
              h('button', { className: 'icc-btn', onClick: () => load(symbol), disabled: busy }, busy ? '加载中…' : '刷新')
            )
          ),
          error ? h('div', { className: 'icc-banner icc-banner-error' }, error) : null,
          !error && !data ? h('div', { className: 'icc-empty' }, '还没有辩论记录，先在「AI 操盘」或对话里跑一次') : null,
          data ? h('div', null,
            h('div', { className: 'icc-item-title', style: { marginBottom: 6 } },
              `${debate.name || ''}（${debate.symbol}）`,
              h('span', { className: 'icc-tag' }, `${debate.rating} / ${debate.verdict}`),
              h('span', { className: 'icc-tag' }, `信心 ${debate.confidence}`),
              h('span', { className: 'icc-tag' }, `仓位 ${debate.position_pct}%`),
              debate.run_id ? h('span', { className: 'icc-tag' }, `记录 #${debate.run_id}`) : null
            ),
            h('div', { className: 'icc-hint' },
              `虚拟日期 ${debate.asof} · 模型 ${debate.model} · 生成 ${debate.generated_at} · ${stages.length} 条留痕`)
          ) : null
        ),
        data ? h('div', { className: 'icc-row' },
          h('div', { className: 'icc-card' },
            h('div', { className: 'icc-section-title' }, '辩论时间线',
              h('span', { className: 'icc-hint' }, '按实际发言顺序保留，含多轮交锋')),
            stages.length ? h('div', null, stages.map((s, i) => h('div', { key: i, className: 'icc-decision' },
              h('div', { className: 'icc-item-title' },
                `${s.step}${s.round > 1 ? ` · 第 ${s.round} 轮` : ''}`,
                h('span', { className: 'icc-tag' }, ROLE_LABELS[s.role] || s.role)
              ),
              h('pre', { className: 'icc-pre', style: { maxHeight: 260, marginTop: 6, fontSize: 11.5 } },
                String(s.content || '').trim())
            ))) : h('div', { className: 'icc-empty' }, '这条记录没有留痕')
          ),
          h('div', { className: 'icc-grid', style: { gap: 14, alignContent: 'start' } },
            h('div', { className: 'icc-card' },
              h('div', { className: 'icc-section-title' }, '证据快照'),
              h('pre', { className: 'icc-pre', style: { maxHeight: 240, fontSize: 11.5 } }, debate.evidence || '（无）')
            ),
            h('div', { className: 'icc-card' },
              h('div', { className: 'icc-section-title' }, '组合经理裁决'),
              h('pre', { className: 'icc-pre', style: { maxHeight: 240, fontSize: 11.5 } },
                JSON.stringify(debate.judge || {}, null, 2))
            )
          )
        ) : null
      );
    }

    const DAY_LABELS = ['一', '二', '三', '四', '五', '六', '日'];

    function Schedules(props) {
      const { schedules, account, taskTypes, refresh, flash } = props;
      const [type, setType] = useState('auto_trade');
      const [time, setTime] = useState('14:50');
      const [days, setDays] = useState([1, 2, 3, 4, 5]);
      const [symbols, setSymbols] = useState('');
      const [busy, setBusy] = useState(false);

      const toggleDay = (d) => setDays((prev) => prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort());

      const add = async () => {
        if (!days.length) return flash('至少选择一个星期');
        setBusy(true);
        try {
          await api('/schedules/add', {
            method: 'POST',
            body: JSON.stringify({ type, time, days, account, symbols })
          });
          await refresh();
          flash('定时任务已添加');
        } catch (err) {
          flash(`添加失败：${err.message}`);
        } finally {
          setBusy(false);
        }
      };

      const toggle = async (item) => {
        try {
          await api('/schedules/toggle', { method: 'POST', body: JSON.stringify({ id: item.id, enabled: !item.enabled }) });
          await refresh();
        } catch (err) {
          flash(`操作失败：${err.message}`);
        }
      };

      const remove = async (item) => {
        try {
          await api('/schedules/delete', { method: 'POST', body: JSON.stringify({ id: item.id }) });
          await refresh();
          flash('任务已删除');
        } catch (err) {
          flash(`删除失败：${err.message}`);
        }
      };

      return h('div', { className: 'icc-grid', style: { gap: 14 } },
        h('div', { className: 'icc-card' },
          h('div', { className: 'icc-section-title' }, '新建定时任务', h('span', { className: 'icc-hint' }, '由 DSH 宿主每分钟检查一次')),
          h('div', { className: 'icc-form', style: { marginBottom: 10 } },
            h('select', { className: 'icc-select', value: type, onChange: (e) => setType(e.target.value) },
              taskTypes.map((t) => h('option', { key: t.id, value: t.id }, t.label))),
            h('input', { className: 'icc-input', style: { width: 90 }, value: time, onChange: (e) => setTime(e.target.value), placeholder: 'HH:MM' }),
            h('div', { className: 'icc-day' }, DAY_LABELS.map((label, i) => h('button', {
              key: label, type: 'button', 'data-on': days.includes(i + 1) ? 'true' : 'false',
              onClick: () => toggleDay(i + 1)
            }, label))),
            type === 'auto_trade'
              ? h('input', { className: 'icc-input', style: { width: 180 }, value: symbols, onChange: (e) => setSymbols(e.target.value), placeholder: '标的，如 600519.SH,000333.SZ' })
              : null,
            h('button', { className: 'icc-btn icc-btn-primary', onClick: add, disabled: busy }, '添加')
          ),
          h('div', { className: 'icc-hint' }, '到点后由宿主调用本地 Python 执行；DSH 未运行时不会触发。')
        ),
        h('div', { className: 'icc-card' },
          h('div', { className: 'icc-section-title' }, '任务列表', h('span', { className: 'icc-hint' }, `${schedules.length} 项`)),
          schedules.length ? h('div', { className: 'icc-list' }, schedules.map((item) => h('div', { key: item.id, className: 'icc-item' },
            h('div', { className: 'icc-item-main' },
              h('div', { className: 'icc-item-title' },
                `${item.label || item.type} · ${item.time}`,
                h('span', { className: 'icc-tag' }, item.enabled ? '启用' : '停用')
              ),
              h('div', { className: 'icc-item-sub' },
                `每周${(item.days || []).map((d) => DAY_LABELS[d - 1]).join('、')}`
                + (item.last_run ? ` · 上次 ${item.last_run}` : ' · 尚未运行')
                + (item.last_result?.detail ? ` · ${item.last_result.detail}` : '')
              )
            ),
            h('div', { className: 'icc-actions' },
              h('button', { className: 'icc-btn icc-btn-sm', onClick: () => toggle(item) }, item.enabled ? '停用' : '启用'),
              h('button', { className: 'icc-btn icc-btn-sm icc-btn-danger', onClick: () => remove(item) }, '删除')
            )
          ))) : h('div', { className: 'icc-empty' }, '还没有定时任务')
        )
      );
    }

    function Report(props) {
      const [text, setText] = useState('');
      const [path, setPath] = useState('');
      const [busy, setBusy] = useState(false);

      const generate = async () => {
        setBusy(true);
        try {
          const res = await api('/report', { method: 'POST', body: JSON.stringify({ account: props.account }) });
          setText(res.markdown || '');
          setPath(res.path || '');
          props.flash('报告已生成');
        } catch (err) {
          props.flash(`生成失败：${err.message}`);
        } finally {
          setBusy(false);
        }
      };

      return h('div', { className: 'icc-card' },
        h('div', { className: 'icc-section-title' },
          '持仓与决议报告',
          h('div', { className: 'icc-actions' },
            text ? h('button', {
              className: 'icc-btn icc-btn-sm',
              onClick: () => {
                if (navigator.clipboard && navigator.clipboard.writeText) {
                  navigator.clipboard.writeText(text).then(() => props.flash('报告已复制'), () => {});
                }
              }
            }, '复制') : null,
            h('button', { className: 'icc-btn icc-btn-primary', onClick: generate, disabled: busy }, busy ? '生成中…' : '生成报告')
          )
        ),
        h('div', { className: 'icc-hint', style: { marginBottom: 8 } },
          props.paths?.reports ? `输出目录：${props.paths.reports}` : '输出目录：<工作空间>/.icc/reports'),
        path ? h('div', { className: 'icc-hint', style: { marginBottom: 8 } }, `已保存：${path}`) : null,
        text ? h('pre', { className: 'icc-pre' }, text) : h('div', { className: 'icc-empty' }, '点击「生成报告」，汇总当前组合、持仓、成交与最近一次 AI 决议')
      );
    }

    // ------------------------------------------------------------------ //
    // 图标与轻量提示条
    // ------------------------------------------------------------------ //
    function IccIcon({ size }) {
      const s = size || 18;
      return h('svg', { width: s, height: s, viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': 'true' },
        h('path', { d: 'M3 20h18', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round' }),
        h('path', { d: 'M5 16l4.2-4.4 3.1 2.6L18 7', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round' }),
        h('circle', { cx: 18, cy: 7, r: 1.9, stroke: 'currentColor', strokeWidth: 1.6 })
      );
    }

    const PROMPTS = {
      consult: '请以 ICC 投研顾问的身份，先调用 news_sentiment 给这几条新闻打分，再结合我的虚拟仓持仓给出操作建议：\n1. 央行宣布降准 0.5 个百分点，释放长期资金约 1 万亿元。\n2. 某公司因信息披露违规被立案调查，股价跌停。',
      debate: () => `用 stock_debate 对 600519.SH 跑一次辩论，asof 用 ${new Date().toISOString().slice(0, 10)}，然后告诉我五档评级、建议仓位，以及风控三方各自的立场。`
    };

    function ComposerBar() {
      const [copied, setCopied] = useState('');
      const copy = (text, key) => {
        navigator.clipboard?.writeText(text).then(() => {
          setCopied(key);
          setTimeout(() => setCopied(''), 1600);
        });
      };
      const chip = {
        display: 'inline-flex', alignItems: 'center', gap: 6,
        padding: '3px 10px', borderRadius: 999,
        border: '1px solid currentColor', background: 'transparent',
        color: 'inherit', font: 'inherit', fontSize: 12, cursor: 'pointer', opacity: 0.86
      };
      return h('div', { style: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, padding: '6px 2px 2px', fontSize: 12, color: 'inherit' } },
        h('span', { style: { opacity: 0.65 } }, 'ICC 投研'),
        h('button', { type: 'button', style: chip, onClick: () => copy(PROMPTS.consult, 'c') }, copied === 'c' ? '已复制 ✓' : '咨询建议'),
        h('button', { type: 'button', style: chip, onClick: () => copy(PROMPTS.debate(), 'd') }, copied === 'd' ? '已复制 ✓' : '个股辩论'),
        h('span', { style: { opacity: 0.5 } }, '或从左侧打开「ICC 投研」仪表盘')
      );
    }

    // ------------------------------------------------------------------ //
    // 插件页的「工作目录」设置卡片
    // 读取插件自身的 volatile 配置，保存后写回 profile patch。
    // ------------------------------------------------------------------ //
    const CONFIG_FIELDS = [
      ['workspace', '工作空间', '唯一需要配置的目录：代码、报告、数据库都放在它下面'],
      ['repoUrl', '代码下载地址', '工作空间里找不到 ICC 代码时，用 git clone 到 <工作空间>/icc-app']
    ];

    function IccSettingsCard(props) {
      const state = props.useIccSettings((snapshot) => snapshot);
      if (props.view === 'summary') return '只填一个工作空间目录，代码、报告和数据库都放在它下面。';
      if (!primitives) return null;
      const P = primitives;
      const disabled = !state.writable;
      const form = h(P.SettingsForm, {
        labels: {
          unavailable: '该插件当前未加载，暂时无法配置。',
          readOnly: '本部署的设置为只读。',
          saveFailed: '本部署没有接受这些值，已保留供你修改。',
          save: '保存',
          saving: '保存中…'
        },
        state,
        onSave: props.save,
        onDiscard: props.discard
      }, CONFIG_FIELDS.map(([key, label, hint]) => h(P.SettingsValueField, {
        key,
        id: `icc-config-${key}`,
        label,
        hint,
        overriddenLabel: '已覆盖',
        resetLabel: '恢复默认',
        disabled,
        ...state[key],
        onEdit: (text) => props.edit(key, text),
        onReset: () => props.resetField(key)
      })));
      return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
        h('div', { style: { fontSize: 13, fontWeight: 600 } }, '工作空间'),
        h('div', { style: { fontSize: 12, opacity: 0.65 } },
          '代码放在 <工作空间> 或 <工作空间>/icc-app；报告在 <工作空间>/.icc/reports。'),
        form
      );
    }

    function createSettingsCard(ctx) {
      const P = primitives;
      const form = new P.SettingsFormModel(
        ctx.configForms.get('dsh-icc-tools'),
        CONFIG_FIELDS.map(([key]) => P.settingsTextField(key))
      );
      const store = form.bind(() => {
        const state = { ...form.shell() };
        for (const [key] of CONFIG_FIELDS) state[key] = form.field(key);
        return state;
      });
      return {
        inject: () => ({ hooks: { iccSettings: store }, ...form.actions() }),
        dispose: () => form.dispose()
      };
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist',
          id: PANEL_ID,
          order: 6,
          label: 'ICC 投研'
        }, IccIcon));

        ctx.slots.inject('main', () => ctx.slots.register({
          name: 'main',
          key: PANEL_ID
        }, Dashboard));

        ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({
          name: 'conversation.composer.dock',
          id: 'dsh-icc-tools-bar',
          order: 6
        }, ComposerBar));

        // 配置页挂在插件详情页（plugins.bundle.config），key 用包名，
        // 与 dsh-context 等第三方插件的做法一致。
        if (primitives && typeof ctx.inject === 'function') {
          ctx.inject(['configForms'], (scope) => {
            const configForms = scope.configForms;
            if (!configForms?.get || !configForms?.whileServed) {
              console.warn('[icc-tools] configForms 不可用，跳过设置页');
              return;
            }
            try {
              const card = createSettingsCard(scope);
              scope.effect(() => () => card.dispose(), 'dsh-icc-tools: settings form');
              scope.effect(() => configForms.whileServed(['dsh-icc-tools'], () => scope.slots.inject(
                'plugins.bundle.config',
                () => scope.slots.register({
                  name: 'plugins.bundle.config',
                  key: 'dsh-icc-tools',
                  inject: () => card.inject()
                }, IccSettingsCard)
              )), 'dsh-icc-tools: bundle config page');
              console.info('[icc-tools] 设置页已注册到插件详情页');
            } catch (error) {
              console.warn('[icc-tools] 设置页注册失败', error);
            }
          });
        } else if (!primitives) {
          console.warn('[icc-tools] 缺少设置表单原语，跳过设置页');
        }
      }
    };
  }
});
