# 稳定 API 方案与迁移路线

更新时间：2026.05.01

## 1. 当前状态

当前已经稳定部署的是前端仪表盘：

```text
https://feishu-ai-im-collab-assistant.pages.dev
```

当前 API 暴露有三层：

1. 已部署的 Cloudflare Pages 边缘代理，固定入口为 Pages 域名。
2. 当前开发期 Quick Tunnel，用于把本机 `http://localhost:8787` 临时暴露出去。
3. 已创建但尚未绑定域名的 Cloudflare Named Tunnel。

当前 Quick Tunnel：

```text
https://*.trycloudflare.com
```

Quick Tunnel 适合开发和比赛现场临时演示，但不是稳定 API。进程停止、电脑重启或重新启动 Tunnel 后，URL 可能变化。

当前已创建 Named Tunnel：

```text
Tunnel Name: feishu-agent-api
Tunnel ID: c8a7da53-a5b0-46c5-8182-425dea10df19
Status: inactive
```

`inactive` 的原因不是创建失败，而是还没有为它配置 public hostname，且本机没有启动稳定 tunnel connector。下一步需要把一个域名，例如 `api.your-domain.com`，绑定到该 tunnel，并指向本地服务 `http://localhost:8787`。

## 2. 为什么不能直接把 trycloudflare 当稳定 API

Quick Tunnel 的设计目标是“免配置临时暴露本地服务”，不是生产入口。它的限制：

- URL 随启动变化。
- 无法保证长期可用。
- 不适合长期写入飞书后台。
- 不适合作为评委远程体验入口。

当前它仍然有价值：在没有后端云部署前，可以让 Cloudflare Pages 上的仪表盘访问本地 Agent API。

## 2.5 当前首选增强方案：Cloudflare Pages 边缘代理

如果暂时没有自有域名，又不想每次 Quick Tunnel 地址变化后都去飞书后台改菜单，当前首选 Cloudflare Pages `_worker.js` 边缘代理。

形态：

```text
飞书内仪表盘
  -> https://feishu-ai-im-collab-assistant.pages.dev
  -> Pages _worker.js 转发 /api/* 和 /ws
  -> 当前 Quick Tunnel / Named Tunnel
  -> 本地 Agent API
```

启动：

```powershell
npm run demo:stack
npm run deploy:web-proxy:cloudflare
```

飞书后台填写：

```text
网页应用主页 / 机器人菜单打开仪表盘：
https://feishu-ai-im-collab-assistant.pages.dev
```

边界：

- 这是稳定入口，不是全云端 API；本地 API 和 Tunnel 仍需运行。
- Quick Tunnel 改变后，要重新运行 `npm run deploy:web-proxy:cloudflare` 更新 Pages 运行时的 upstream。
- 真正长期无人值守，仍应使用 Named Tunnel + 自有域名或云服务器。

## 2.6 备用增强方案：Cloudflare Worker Relay

如果暂时没有自有域名，又不想每次 Quick Tunnel 地址变化后都去飞书后台改菜单，可以使用 Cloudflare Worker Relay。

形态：

```text
飞书内仪表盘
  -> https://feishu-agent-api-relay.<your-subdomain>.workers.dev
  -> 当前 Quick Tunnel / Named Tunnel
  -> 本地 Agent API
```

它解决的是“飞书后台可填写一个长期不变的 API 入口”。本地 Quick Tunnel 变化时，只需要重新部署 Relay 的 `UPSTREAM_API_BASE_URL`，不需要改飞书后台。

启动：

```powershell
npm run demo:stack
npm run deploy:api-relay:cloudflare
```

输出示例：

```text
Stable relay API: https://feishu-agent-api-relay.<your-subdomain>.workers.dev
Feishu dashboard URL: https://feishu-ai-im-collab-assistant.pages.dev/?api=https://feishu-agent-api-relay.<your-subdomain>.workers.dev
```

适合：

- 比赛现场快速稳定演示。
- 前端飞书菜单不想反复修改。
- 本地 Agent 仍需要 `lark-cli` 和长连接的阶段。

边界：

- 这不是全云端 API，本地 API 和 Tunnel 仍需运行。
- Quick Tunnel 改变后，要重新运行 `npm run deploy:api-relay:cloudflare`。
- Cloudflare 账号必须先注册 `workers.dev` 子域名，否则 Wrangler 会要求到控制台完成 onboarding。
- 如果要长期无人值守，仍应使用 Named Tunnel + 自有域名或云服务器。

## 3. 推荐稳定方案 A：Cloudflare Named Tunnel + 自有域名

这是最贴合当前架构的稳定方案。因为当前 API 需要：

- 调用本机或本地环境中的 `lark-cli`。
- 保持飞书长连接事件桥接。
- 读写本地任务状态和临时文件。
- 调豆包 2.0 Pro 和飞书 Docs / Slides 能力。

推荐目标：

```text
https://api.your-domain.com
```

飞书后台和仪表盘填：

```text
https://feishu-ai-im-collab-assistant.pages.dev/?api=https://api.your-domain.com
```

需要你手工准备：

1. 一个域名，并把 DNS 接入 Cloudflare。
2. 在 Cloudflare Zero Trust 里给已创建的 `feishu-agent-api` 配置 public hostname。
3. 让 public hostname 指向本地服务 `http://localhost:8787`。
4. 如果选择 token 运行方式，把 Cloudflare 后台生成的 tunnel token 写入本机 `.env.local`。

推荐后台填写：

```text
Cloudflare Zero Trust -> Networks -> Tunnels -> feishu-agent-api
Public Hostname:
  Subdomain: api
  Domain: your-domain.com
  Service Type: HTTP
  URL: localhost:8787
```

接入后可运行的命令形态：

```powershell
npm run stable:stack
npm run doctor:stable-api
```

`.env.local` 推荐写法：

```env
PUBLIC_API_BASE_URL=https://api.your-domain.com
PUBLIC_WEB_BASE_URL=https://feishu-ai-im-collab-assistant.pages.dev

# 二选一。推荐 token，适合不用本机 origin cert 的方式。
CLOUDFLARE_TUNNEL_TOKEN=从 Zero Trust Tunnel 页面复制
# 或
CLOUDFLARE_TUNNEL_NAME=feishu-agent-api
```

优点：

- API URL 稳定。
- 不需要改造现有 Express API 和 lark-cli 适配器。
- 仍然能使用本地长连接，最适合比赛阶段。

缺点：

- 电脑或本地服务必须保持运行。
- 需要自有域名，或由 Cloudflare Zero Trust 下发 tunnel token。

项目已补稳定栈脚本。`.env` 中配置后即可启动：

```env
PUBLIC_API_BASE_URL=https://api.your-domain.com
CLOUDFLARE_TUNNEL_TOKEN=eyJ...
```

或：

```env
PUBLIC_API_BASE_URL=https://api.your-domain.com
CLOUDFLARE_TUNNEL_NAME=feishu-agent-api
```

启动：

```powershell
npm run stable:stack
npm run doctor:stable-api
```

## 4. 推荐稳定方案 B：云服务器 / 容器部署 API

如果希望评委随时访问，不依赖你的电脑，则把 API 部署到云服务器或容器平台。

适合部署目标：

- 轻量云服务器，推荐 2 vCPU / 4 GB RAM / 60 GB SSD，Ubuntu 22.04 或 24.04。
- 最低可用规格为 2 vCPU / 2 GB RAM / 40 GB SSD，但长连接、Node 构建、日志和后续数据库会比较紧。
- Cloudflare Tunnel 指向一台固定服务器，或服务器直接使用 Nginx + HTTPS。
- 支持 Node.js 长进程的容器服务。

需要迁移：

- `.env` 中的 Ark / Lark 配置。
- `lark-cli` 登录态或改用飞书 OpenAPI SDK。
- 本地 `.tmp`、`.data` 迁移到持久磁盘或数据库。
- 使用 PM2 或 systemd 常驻运行 `npm run dev:api` 和 `npm run dev:lark-events`。
- 使用 `npm run doctor:stable-api` 做上线前检查。

优点：

- 更稳定。
- 比赛评委远程打开也可用。
- 不依赖你本机网络和电脑电源。

缺点：

- 运维成本更高。
- 需要更严格的密钥管理。
- `lark-cli` 用户态登录搬到服务器会增加一次授权和运维复杂度。

当前建议：

| 方案 | 适合阶段 | 结论 |
| --- | --- | --- |
| Pages 边缘代理 + Quick Tunnel | 现在立即演示 | 可继续用，但本机和 Quick Tunnel 要保持运行 |
| Named Tunnel + 自有域名 | 比赛提交前优先 | 最贴合当前架构，API URL 稳定，改动小 |
| 云服务器 + Cloudflare Tunnel | 评委远程长期体验 | 最稳，但需要购买服务器和迁移登录态 |
| 全云 Worker / Durable Object | 长期产品化 | 架构漂亮，但当前改造成本最大 |

## 5. 长期方案 C：Webhook + Cloudflare Worker / Durable Object

这是真正云原生的终局方向，但不是当前最快路径。

目标形态：

```text
飞书事件 webhook
  -> Cloudflare Worker
  -> Durable Object / Queue
  -> Agent 执行器
  -> 飞书 Docs / Slides / 群回发
```

需要重构：

- 不再依赖 `lark-cli event +subscribe`。
- 飞书事件走 HTTPS webhook，并启用 raw body 签名校验。
- 任务状态迁移到 Durable Object / D1 / KV。
- 飞书 OpenAPI 调用改为 SDK / HTTP，而不是 CLI。
- Slides / Docs 生成逻辑要适配 Worker Runtime 或拆到执行器服务。

优点：

- 架构更像正式 SaaS。
- 不依赖本地机器。

缺点：

- 改造成本明显更大。
- 短期容易影响主链路稳定性。

## 6. 当前阶段决策

第三周期建议：

1. 保留 Cloudflare Pages 作为稳定前端入口。
2. 短期使用 Pages 边缘代理固定飞书后台入口。
3. 一旦有自有域名，立即切换到 Named Tunnel，获得真正稳定 API。
4. 在比赛主链路稳定后，再评估 Worker / 云服务器长期化。

当前一键演示命令：

```powershell
npm run demo:stack
```

该命令会：

- 启动本地 API。
- 启动飞书长连接事件桥接。
- 启动 Cloudflare Quick Tunnel。
- 输出带 `api=` 参数的飞书仪表盘 URL。

当前部署诊断命令：

```powershell
npm run doctor:deploy
npm run doctor:stable-api
```

## 7. 飞书后台填写策略

临时演示：

```text
网页应用主页 / 机器人菜单打开仪表盘：
https://feishu-ai-im-collab-assistant.pages.dev/?api=https://<quick-tunnel>.trycloudflare.com
```

稳定 API 后：

```text
网页应用主页 / 机器人菜单打开仪表盘：
https://feishu-ai-im-collab-assistant.pages.dev/?api=https://api.your-domain.com
```

Worker Relay 过渡方案：

```text
网页应用主页 / 机器人菜单打开仪表盘：
https://feishu-ai-im-collab-assistant.pages.dev/?api=https://feishu-agent-api-relay.<your-subdomain>.workers.dev
```

Pages 边缘代理过渡方案：

```text
网页应用主页 / 机器人菜单打开仪表盘：
https://feishu-ai-im-collab-assistant.pages.dev
```

事件接收：

```text
继续使用长连接 im.message.receive_v1
```

等迁移到云端 webhook 后再改为：

```text
https://api.your-domain.com/api/lark/events
```
