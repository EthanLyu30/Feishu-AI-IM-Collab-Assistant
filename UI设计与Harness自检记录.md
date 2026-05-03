# UI 设计与 Harness 自检记录

更新时间：2026.05.03

## 1. 设计目标

本轮 UI 不再按“演示仪表盘”处理，而是按评审可感知的 Agent 工作台处理：

- 首屏必须能看出自然语言入口、运行状态、LLM / Office / API 配置。
- 必须显式展示赛题 A-F 场景覆盖，而不是只写在 README。
- 移动端优先保留“启动 Agent”入口，避免用户在飞书手机端进入后先看到一堆说明。
- 卡片圆角保持 8px 以内，减少样板化的大圆角卡片感。

参考方向：

- Harness UI：范围/模块/流水线/执行记录的产品化导航思路。
- Harness Dashboards：聚焦一个主题，少量关键 widget，避免堆满指标。
- Vercel Dashboard：轻量顶部状态、干净边框、功能优先的开发者工具质感。

## 2. 已完成 UI 改动

- 增加 A-F 场景覆盖条：IM 入口、任务规划、Docs、Slides、多端同步、总结交付。
- 调整移动端信息顺序：命令入口优先，场景覆盖次之，运行细节继续向下。
- 优化侧边导航激活态、页面背景、场景状态色、移动端标题尺度。
- 保留 Web 运行台定位：它是 GUI 辅助操作台，最终产物仍是飞书 Docs / Slides / 群回发摘要。

## 3. Bot Open ID 获取方式

当前代码支持 `LARK_BOT_OPEN_ID` 或 `LARK_BOT_USER_ID`。实际只要配置其中一个即可；本项目已经使用 `open_id` 完成机器人自身消息过滤。

推荐命令：

```powershell
npx --yes @larksuite/cli api GET /open-apis/bot/v3/info --as bot --format json
```

返回 JSON 中的 `open_id` 写入 `.env`：

```env
LARK_BOT_OPEN_ID=ou_xxx
```

然后重启：

```bash
systemctl restart agent-pilot-api.service agent-pilot-lark-events.service
```

验证：

```bash
curl -fsS https://agent-pilot.47-236-122-49.sslip.io/api/readiness
```

看到“机器人自消息过滤”为通过即可。`LARK_BOT_USER_ID` 暂时不是必需项，除非后续某些 API 强制要求 `user_id` 类型。

## 4. Harness 自检命令

单轮 UI 门禁：

```powershell
npm run doctor:ui
```

快速跳过 E2E：

```powershell
npm run doctor:ui -- -SkipE2E
```

多轮循环：

```powershell
npm run harness:loop -- -Rounds 3
```

输出：

```text
.runtime/ui-harness/report.md
.runtime/ui-harness/desktop.png
.runtime/ui-harness/mobile.png
.runtime/harness-loop/report.md
```

## 5. 当前硬门禁

- TypeScript 类型检查必须通过。
- Web 构建必须通过。
- 本地 API 与 Web 栈必须能启动。
- 桌面端和移动端必须出现标题、启动按钮、Pipeline、运行检查。
- A-F 场景覆盖条必须存在，且至少 6 个场景节点。
- 页面不能出现横向溢出。
- 主要卡片圆角不得超过 8px。
- 关键按钮、状态行、卡片文字溢出计数需保持在预算内。

## 6. 下一轮建议

- 真实飞书群内跑一次 `/agent ...`，截取飞书消息、Web 运行台、Docs、Slides 四类证据。
- 若评委更看重飞书内嵌体验，可继续做飞书网页应用免登和用户态展示。
- 若切换 webhook，再补事件 raw body 签名校验；长连接模式下当前不是阻塞项。
