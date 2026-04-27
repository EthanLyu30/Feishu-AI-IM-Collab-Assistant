# 飞书 IM 触发接入说明

更新时间：2026.04.27

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
- 同一个 `messageId` 幂等去重，避免重复事件导致重复生成文档和 Slides。
- 任务会记录 `trigger.source = lark-im`，并保留 `chatId`、`messageId`、`sender`、`rawText`。

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

接入流程建议：

1. 部署后端到 HTTPS 域名。
2. 将事件订阅地址配置为：

```text
https://你的域名/api/lark/events
```

3. 完成飞书 challenge 验证。
4. 只处理测试群、文本消息和 @Agent / 指令消息。
5. 确认消息来源不是机器人自己，避免回发消息再次触发。
6. 用 `message_id` 去重，避免重试事件重复生成产物。

## 4. 当前限制

- 还没有实现飞书事件签名校验。
- 还没有过滤机器人自己发送的消息。
- 还没有任务持久化，进程重启后幂等记录会丢失。
- 还没有“确认 / 修改 / 继续执行”的暂停恢复状态机。
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
- 飞书事件形状 payload 创建任务。
- 重复 `messageId` 幂等忽略。
