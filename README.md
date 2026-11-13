# dsh-icc-tools

DSH 插件：把本地 ICC 投研工作台接进 DeepSeek Harness。提供左侧「ICC 投研」仪表盘、一个投研咨询模式，以及新闻情感、辩论、留痕回看、代码安装、按需补数据、新闻时效检查六个模型工具。

## 安装

从 GitHub 安装：

```bash
dsh plugin --profile desktop add https://github.com/waterplanets/dsh-icc-plugin.git
```

本地开发时也可以直接装目录：

```bash
dsh plugin --profile desktop add <本目录绝对路径>
```

装完重启 DSH，在侧栏「插件」→「ICC 投研」的「工作空间」里填一个目录即可。

> 工作空间在**本页底部**的「工作空间」配置区修改，保存后立即生效。

## 目录结构

```
dsh-icc-plugin/
├── package.json          # 插件元数据：main / dsh.client / 资源导出
├── cordis.patch.yml      # 宿主组合补丁：加载插件 + 声明「ICC 投研顾问」模式
├── icon.svg              # 侧边栏图标（<256 KiB）
├── locale/
│   ├── zh.json           # 插件市场展示文案（中文）
│   └── en.json           # 插件市场展示文案（英文）
├── lib/
│   └── index.js          # 宿主端：工具、HTTP 路由、定时任务轮询、路径解析
├── client/
│   └── client.js         # 浏览器端：侧边栏入口 + 仪表盘（概览/账户/AI 操盘/辩论/定时/报告）
└── test/
    └── run.mjs           # 最小冒烟测试（node test/run.mjs）
```

业务逻辑不在插件里，而在同工作区的 `icc-app/`：

```
icc-app/
├── dashboard_api.py      # 仪表盘 JSON 接口（state/账户/操盘/报告/定时任务/辩论）
├── run_debate.py         # 单标的辩论 CLI，供 stock_debate 工具调用
├── debate.py             # 多智能体辩论流水线（stages 留痕）
├── broker.py / db.py     # 虚拟盘撮合与账户/行情存储
├── council.py            # 八人格规则投委会
├── newsfeed.py / feed.py # 新闻与行情
└── app.py                # 原有 Flask 工作台（保留，与插件并行）
```

## 路径约定：只配一个目录

在侧栏「插件」→「ICC 投研」页的「工作空间」卡片里只需要填 `workspace`，其余路径全部由它推导：

| 内容 | 位置 |
| --- | --- |
| 代码 | `<workspace>` 或 `<workspace>/icc-app` |
| 报告 | `<workspace>/.icc/reports` |
| 数据库 | 跟随代码布局：`<home>/icc-app/data` 或 `<home>/data` |
| Python | PATH 里的 `python` |

`repoUrl` 是第二个字段，只在工作空间里找不到代码时使用，默认 `https://github.com/waterplanets/icc-app.git`。

## 与 icc-app 分离

插件包只包含桥接代码，不携带 ICC 业务代码。工作空间里检测不到 `dashboard_api.py` 时不会静默下载，而是给出安装提示：

- 仪表盘：显示「工作空间还没有 ICC 代码」卡片，点「立即下载」执行安装；
- 对话模式：工具返回 `code=NEED_INSTALL`，AI 先说明下载地址与目标目录并征求同意，同意后调用 `icc_install`。

安装动作等价于：

```bash
git clone --depth 1 <repoUrl> <workspace>/icc-app
```

默认分支缺少 `dashboard_api.py` 时会自动再尝试 `main` 分支。下载失败会原样返回 git 的错误信息；如果目标目录已存在且非空，会提示先清空。

代码布局两种都支持：

- 嵌套：`<home>/icc-app/dashboard_api.py` + `<home>/ml/cli.py`
- 扁平：`<home>/dashboard_api.py`（仓库 main 分支就是这种，但没有 `ml/`，此时 `news_sentiment` 会提示该版本不含本地模型）

## 按需补数据

`stock_debate` 需要至少 30 条日线。数据不足时它会返回 `NEED_DATA`，并提示可以调用 `icc_sync`：

- `icc_sync` 先把标的加入自选，再拉 3 年日线、实时快照，默认同时抓 8 条新闻并用本地 SVM 打分；
- 仪表盘「概览 → 自选行情」也有搜索框：输入代码或名称（如 `600360`、`华微电子`），点“搜索 / 添加”即可；右侧按钮可打开完整工作台；
- 只在用户明确同意联网同步后调用，补完再重试 `stock_debate`；
- 工作空间里的 ICC 代码需要包含 `icc-app/sync_symbol.py`，否则会提示先更新代码。

换工作空间时只改 config 里的 `workspace`，报告就会写到那个目录的 `.icc/reports` 下，不再污染课程报告的 `reports/`。宿主把这些值作为命令行参数传给 Python，子进程之间不共享全局状态。

## HTTP 接口

宿主把这些路由挂在 DSH 的 web server 上，浏览器端同源调用：

```
GET  /icc-tools/api/state
POST /icc-tools/api/install
GET  /icc-tools/api/search?q=华微
POST /icc-tools/api/watch/add
GET  /icc-tools/api/news/status?symbol=600360.SH
GET  /icc-tools/api/debate/latest?symbol=
POST /icc-tools/api/accounts/create
POST /icc-tools/api/accounts/reset
POST /icc-tools/api/accounts/asof
POST /icc-tools/api/auto-trade
POST /icc-tools/api/report
GET  /icc-tools/api/schedules
POST /icc-tools/api/schedules/add
POST /icc-tools/api/schedules/toggle
POST /icc-tools/api/schedules/delete
```

## 定时任务

宿主进程每分钟执行一次 `dashboard_api.py scheduler-tick`。任务保存在 `<data>/schedules.json`，到点后按任务类型调用本地 Python；DSH 未运行时不会触发。

## 开发

- 从 GitHub 安装：`dsh plugin --profile desktop add https://github.com/waterplanets/dsh-icc-plugin.git`
- 本地目录安装：`dsh plugin --profile desktop add <本目录绝对路径>`
- 语法检查：`node --check lib/index.js`、`node --check client/client.js`
- 冒烟测试：`node test/run.mjs`
- 改动宿主端或补丁后需要重启 DSH；浏览器端刷新页面即可。
