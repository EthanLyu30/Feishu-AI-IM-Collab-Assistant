# Feishu AI IM Collab Assistant

Agent-Pilot 是一个面向飞书比赛题目“基于 IM 的办公协同智能助手”的工程骨架。

当前框架已经包含：

- `apps/api`：Agent 后端、豆包 Ark Provider、任务编排、实时 WebSocket、Office Adapter。
- `apps/web`：可点击的多端协同仪表盘，用于演示移动端 IM 入口和桌面端 Agent 进度。
- `packages/shared`：任务、步骤、事件、产物等共享类型。
- `MockOfficeToolAdapter`：在飞书 API 未完全接入前模拟 IM、文档、PPT 和交付。
- `LarkCliAdapter`：为后续通过官方 `larksuite/cli` 接入飞书能力预留边界。
- `TaskStore`：任务、事件和产物可持久化到 `.data/tasks.json`，支持重启后恢复。
- `ArtifactVerifier`：对 Docs、Slides、交付摘要做轻量质量校验，并把建议写入实时事件。
- Cloudflare Pages：当前稳定仪表盘入口，支持 Pages 边缘代理和 Named Tunnel 稳定 API 路线。

## 快速开始

```powershell
npm install
npm run dev
```

默认启动：

- API: `http://localhost:8787`
- Web: `http://localhost:5173`

## 接入豆包 2.0 Pro

不要把真实 key 写入 Git。复制 `.env.example` 的字段到本地 `.env`，并填入真实值：

```env
AGENT_LLM_MODE=doubao
ARK_BASE_URL=https://ark.cn-beijing.volces.com/api/v3
ARK_ENDPOINT_ID=你的 EP ID
ARK_API_KEY=你的 Ark API Key
```

如果不配置，系统会使用 `mock` 模式，便于离线演示和开发。

## 后续接入飞书

第一阶段可以保持 `OFFICE_ADAPTER=mock`，用于离线演示。

当飞书 API、MCP 或 `larksuite/cli` 权限完成后，可以切换：

```env
OFFICE_ADAPTER=lark-cli
LARK_CLI_BIN=lark-cli
TASK_STATE_PATH=.data/tasks.json
LARK_CLI_TIMEOUT_MS=45000
LARK_CLI_READ_RETRIES=1
```

真实命令实现集中在 `apps/api/src/adapters/LarkCliAdapter.ts`，不会影响 Agent 主流程。飞书机器人事件优先通过长连接接入：

```powershell
npm run dev:lark-events
```

详细配置见：

- `飞书开放平台后台填写清单.md`
- `飞书开放平台长连接接入指南.md`
- `飞书应用初版交付与部署指南.md`
- `稳定API方案与迁移路线.md`

机器人自定义菜单一级最多 3 个。推荐把“开始整理 / 查看进度 / 取消任务”放在“任务”子菜单下，并把“仪表盘”作为单独一级菜单；如果后台只配 3 个一级菜单，则用“开始整理 / 打开仪表盘 / 取消任务”，用户仍可直接在群里发 `进度`。

## Cloudflare Pages 初版部署

Web 仪表盘已经支持通过环境变量连接远程或隧道后的 API：

```env
VITE_API_BASE_URL=https://your-api-domain.example.com
VITE_WS_URL=wss://your-api-domain.example.com/ws
```

部署前确认 Cloudflare Wrangler 已登录：

```powershell
npx --yes wrangler@4.87.0 whoami
```

部署 Web 仪表盘：

```powershell
npm run deploy:web:cloudflare
```

检查 Cloudflare 登录、Pages 项目和最近部署：

```powershell
npm run doctor:deploy
```

比赛演示前检查本地 Agent API、readiness 和可选的 lark-cli 状态：

```powershell
npm run doctor:runtime
```

## 轻量云服务器稳定入口

当前已经把项目部署到轻量云服务器，并使用免费 `sslip.io` 通配 DNS 与 Let's Encrypt HTTPS 证书：

```text
https://agent-pilot.47-236-122-49.sslip.io
```

飞书后台的机器人菜单“打开仪表盘”、网页应用桌面端主页、移动端主页可以优先填写这个地址。该入口同时托管 Web 仪表盘，并通过 Nginx 反向代理 `/api/*`、`/health` 和 `/ws` 到 Agent API。

服务器运维记录见：

- `轻量云服务器部署记录.md`

如果后端仍在本地运行，可以用 Cloudflare Tunnel 暂时暴露 API：

```powershell
npm run tunnel:api:cloudflare
```

比赛现场可以用一键演示栈启动 API、飞书事件桥接和 Cloudflare Tunnel：

```powershell
npm run demo:stack
```

如果希望飞书后台填写一个长期不变的入口，但后端暂时仍跑在本机，优先部署 Cloudflare Pages 边缘代理。这样飞书后台可以直接填写固定的 Pages URL，`/api/*` 和 `/ws` 会由 Pages `_worker.js` 转发到当前 Agent API：

```powershell
npm run demo:stack
npm run deploy:web-proxy:cloudflare
```

之后飞书后台可以优先填写：

```text
https://feishu-ai-im-collab-assistant.pages.dev
```

每次 Quick Tunnel 变化后，只需重新运行 `npm run deploy:web-proxy:cloudflare` 更新 Pages 的转发目标，不必反复修改飞书后台。

如果你的账号已经注册了 `workers.dev` 子域名，也可以部署独立 Worker Relay：

```powershell
npm run deploy:api-relay:cloudflare
```

如果已经拥有接入 Cloudflare 的自有域名，推荐改用 Named Tunnel/token 的稳定栈：

```powershell
npm run stable:stack
npm run doctor:stable-api
```

当前已创建 Cloudflare Named Tunnel：

```text
feishu-agent-api
c8a7da53-a5b0-46c5-8182-425dea10df19
```

它还没有绑定公网主机名，因此状态会显示 `inactive`。绑定 `api.your-domain.com -> http://localhost:8787` 后再启动稳定栈即可。

如果要给评委远程长期访问，推荐 2 vCPU / 4 GB RAM 的轻量云服务器运行 API 和长连接桥接，再用 Cloudflare Tunnel 或服务器 Nginx/HTTPS 暴露入口。

如果官方不提供服务器，项目不只剩“购买服务器 + 购买域名”一条路。当前保底路线是 Cloudflare Pages 固定前端入口，本地运行 Agent API 和飞书长连接，再通过 Quick Tunnel 或 Pages 边缘代理接入；低成本路线、风险和人工操作项见：

- `低成本部署方案与人工操作清单.md`
- `第四周期任务规划.md`

正式演示前可以运行交付级诊断，脚本会生成 `.runtime/delivery-report.md`，列出自动检查结果和仍需你手工处理的事项：

```powershell
npm run doctor:delivery -- -SkipLarkCli
```

部署后的页面也支持运行时指定 API 地址：

```text
https://feishu-ai-im-collab-assistant.pages.dev/?api=https://your-api.trycloudflare.com
```

## 当前 Demo 链路

```text
IM 自然语言指令
  -> Agent Planner
  -> 读取 IM 上下文
  -> 生成需求文档
  -> 生成 PPT 结构
  -> 生成讲稿与交付摘要
  -> WebSocket 同步到移动端与桌面端仪表盘
```
