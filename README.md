# Feishu AI IM Collab Assistant

Agent-Pilot 是一个面向飞书比赛题目“基于 IM 的办公协同智能助手”的工程骨架。

当前框架已经包含：

- `apps/api`：Agent 后端、豆包 Ark Provider、任务编排、实时 WebSocket、Office Adapter。
- `apps/web`：可点击的多端协同仪表盘，用于演示移动端 IM 入口和桌面端 Agent 进度。
- `packages/shared`：任务、步骤、事件、产物等共享类型。
- `MockOfficeToolAdapter`：在飞书 API 未完全接入前模拟 IM、文档、PPT 和交付。
- `LarkCliAdapter`：为后续通过官方 `larksuite/cli` 接入飞书能力预留边界。

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
```

真实命令实现集中在 `apps/api/src/adapters/LarkCliAdapter.ts`，不会影响 Agent 主流程。飞书机器人事件优先通过长连接接入：

```powershell
npm run dev:lark-events
```

详细配置见：

- `飞书开放平台后台填写清单.md`
- `飞书开放平台长连接接入指南.md`
- `飞书应用初版交付与部署指南.md`

## Cloudflare Pages 初版部署

Web 仪表盘已经支持通过环境变量连接远程或隧道后的 API：

```env
VITE_API_BASE_URL=https://your-api-domain.example.com
VITE_WS_URL=wss://your-api-domain.example.com/ws
```

部署前确认 Cloudflare Wrangler 已登录：

```powershell
npx wrangler whoami
```

部署 Web 仪表盘：

```powershell
npm run deploy:web:cloudflare
```

检查 Cloudflare 登录、Pages 项目和最近部署：

```powershell
npm run doctor:deploy
```

如果后端仍在本地运行，可以用 Cloudflare Tunnel 暂时暴露 API：

```powershell
npm run tunnel:api:cloudflare
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
