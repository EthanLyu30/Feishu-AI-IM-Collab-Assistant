# 飞书 IM 触发接入说明

更新时间：2026.04.28

## 1. 当前能力

项目已新增一个最小飞书 IM 触发入口：

```text
POST /api/triggers/lark-im
POST /api/lark/events
```

两个路径使用同一套处理逻辑，方便本地模拟和后续飞书事件订阅接入。

当前支持：

- 飞书 URL challenge 回调。
- 扁平测试 payload：`chatId`、`messageId`、`sender`、`text`。
- 飞书事件形状 payload：`event.message.chat_id`、`event.message.message_id`、`event.message.content`。
- 关键词触发：`@Agent`、`@Agent-Pilot`、`/agent`、`Agent-Pilot`、`请整理`、`生成需求文档`、`生成汇报`、`生成 PPT`。
- 同一个 `messageId` 幂等去重，避免重复事件导致重复生成文档和 Slides；默认写入 `.data/lark-state.json`，E2E 使用内存态。
- 可选配置飞书 verify token、事件 encrypt key、允许的测试群和机器人自身 ID，用于拒绝伪造请求、签名错误请求、非白名单群和机器人自消息。
- 任务会记录 `trigger.source = lark-im`，并保留 `chatId`、`messageId`、`sender`、`rawText`。
- 群内触发后会先进入 `waiting_user` 状态，并在同一群聊等待用户回复“确认 / 继续 / 开始生成”等短指令。
- 用户确认后，Agent 才继续执行 Docs、Slides、讲稿和交付摘要生成。
- 群内支持最小会话命令：“进度”查看当前任务，“取消 / 停止”取消当前活跃任务。
- 同一群存在 `created / planning / waiting_user / running` 任务时，新的触发消息会被拦截为 `chat session already active`，避免同群出现多个悬挂会话。

可选环境变量：

```env
LARK_EVENT_VERIFY_TOKEN=
LARK_EVENT_ENCRYPT_KEY=
LARK_ALLOWED_CHAT_IDS=
LARK_BOT_OPEN_ID=
LARK_BOT_USER_ID=
LARK_STATE_PATH=.data/lark-state.json
```

当配置 `LARK_EVENT_ENCRYPT_KEY` 后，后端会保存 Express raw body，并按飞书事件签名规则校验：

```text
sha256(timestamp + nonce + encrypt_key + raw_body) == X-Lark-Signature
```

## 2. 本地模拟

启动 Mock 环境：

```powershell
npm run dev:e2e
```

发送一条普通消息，应该被忽略：

```powershell
Invoke-RestMethod `
  -Method Post `
  -Uri "http://localhost:8787/api/triggers/lark-im" `
  -ContentType "application/json" `
  -Body (@{
    chatId = "oc_test"
    messageId = "om_plain"
    sender = "ou_user"
    text = "大家下午三点开会"
  } | ConvertTo-Json)
```

发送触发消息，应该创建 Agent 任务：

```powershell
Invoke-RestMethod `
  -Method Post `
  -Uri "http://localhost:8787/api/triggers/lark-im" `
  -ContentType "application/json" `
  -Body (@{
    chatId = "oc_test"
    messageId = "om_trigger"
    sender = "ou_user"
    text = "@Agent 请整理群聊讨论，生成需求文档和汇报 Slides。"
  } | ConvertTo-Json)
```

此时任务会先停在 `waiting_user`，再发送确认消息：

```powershell
Invoke-RestMethod `
  -Method Post `
  -Uri "http://localhost:8787/api/triggers/lark-im" `
  -ContentType "application/json" `
  -Body (@{
    chatId = "oc_test"
    messageId = "om_confirm"
    sender = "ou_user"
    text = "确认"
  } | ConvertTo-Json)
```

查询当前任务进度：

```powershell
Invoke-RestMethod `
  -Method Post `
  -Uri "http://localhost:8787/api/triggers/lark-im" `
  -ContentType "application/json" `
  -Body (@{
    chatId = "oc_test"
    messageId = "om_progress"
    sender = "ou_user"
    text = "进度"
  } | ConvertTo-Json)
```

取消当前活跃任务：

```powershell
Invoke-RestMethod `
  -Method Post `
  -Uri "http://localhost:8787/api/triggers/lark-im" `
  -ContentType "application/json" `
  -Body (@{
    chatId = "oc_test"
    messageId = "om_cancel"
    sender = "ou_user"
    text = "取消"
  } | ConvertTo-Json)
```

模拟飞书事件形状：

```powershell
$body = @{
  event = @{
    message = @{
      chat_id = "oc_test"
      message_id = "om_event"
      content = '{"text":"/agent 请整理需求，并生成 PPT。"}'
    }
    sender = @{
      sender_id = @{
        open_id = "ou_user"
      }
    }
  }
} | ConvertTo-Json -Depth 8

Invoke-RestMethod `
  -Method Post `
  -Uri "http://localhost:8787/api/lark/events" `
  -ContentType "application/json" `
  -Body $body
```

## 3. 飞书后台接入方向

后续接真实事件订阅时，推荐先接：

```text
im.message.receive_v1
```

当前有两种真实事件接入方式：

| 方式 | 适用场景 | 状态 |
| --- | --- | --- |
| HTTPS 回调 | 最贴近最终部署，需要公网 HTTPS 域名 | 后端已支持 raw body 签名校验，仍需部署 HTTPS 地址并在飞书后台配置 |
| `lark-cli event +subscribe` WebSocket | 本地开发演示，不需要公网地址 | CLI 已支持，使用 bot 身份订阅后可把事件桥接到本地 `/api/lark/events` |

本地 WebSocket 订阅 dry-run 示例：

```powershell
lark-cli event +subscribe --as bot --event-types im.message.receive_v1 --dry-run
```

接入流程建议：

1. 部署后端到 HTTPS 域名。
2. 将事件订阅地址配置为：

```text
https://你的域名/api/lark/events
```

3. 完成飞书 challenge 验证。
4. 只处理测试群、文本消息和 @Agent / 指令消息。
5. 配置 `LARK_ALLOWED_CHAT_IDS`，只允许测试群触发。
6. 配置 `LARK_BOT_OPEN_ID` / `LARK_BOT_USER_ID`，确认消息来源不是机器人自己，避免回发消息再次触发。
7. 配置 `LARK_EVENT_VERIFY_TOKEN` 和 `LARK_EVENT_ENCRYPT_KEY`，启用 token 与 raw body 签名校验。
8. 用 `message_id` 去重，避免重试事件重复生成产物。

## 4. 当前限制

- 已支持 verify token、raw body 签名校验、白名单群、机器人自消息过滤和 `messageId` 持久化去重；真实 HTTPS 回调仍需公网部署和飞书后台配置验证。
- 还没有完整任务持久化，进程重启后 Task / Event 本身仍会丢失。
- 已有最小“确认 / 继续 / 进度 / 取消”状态机，但还没有改计划、多人审批和超时恢复。
- 当前 Web 仪表盘仍是开发期页面，后续需要包装成飞书应用内页面。

## 5. 验证命令

```powershell
npm run typecheck
npm run build
npm run test:e2e
```

当前 E2E 已覆盖：

- challenge 回调。
- 普通消息忽略。
- 扁平 payload 创建任务。
- 群内确认消息继续执行任务。
- 群内进度查询和取消任务。
- 机器人自消息忽略。
- 同群活跃会话互斥。
- 飞书事件形状 payload 创建任务。
- 重复 `messageId` 幂等忽略，并在非 E2E 模式下持久化到 `.data/`。
