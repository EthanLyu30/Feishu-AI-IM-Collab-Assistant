import cors from "cors";
import express from "express";
import { createServer } from "node:http";
import { z } from "zod";
import type {
  CreateTaskRequest,
  LarkImTriggerRequest,
  LarkImTriggerResponse,
  ReadinessStatus,
  RuntimeConfig,
  SendCommandRequest,
  Task,
  TaskStatus
} from "@agent-pilot/shared";
import { createOfficeAdapter } from "./adapters/createOfficeAdapter";
import { AgentOrchestrator } from "./agent/AgentOrchestrator";
import { config } from "./env";
import { createLlm } from "./llm/createLlm";
import { attachRealtime } from "./realtime";
import {
  validateLarkMessage,
  validateLarkSignature,
  validateLarkVerifyToken,
  type RawBodyRequest
} from "./security/LarkEventGuard";
import { HandledMessageStore } from "./state/HandledMessageStore";
import { TaskStore } from "./state/TaskStore";
import {
  buildTaskTrigger,
  extractLarkImTrigger,
  isCancelText,
  isConfirmationText,
  isProgressText,
  sanitizeIntent,
  shouldTriggerAgent
} from "./triggers/larkImTrigger";

const createTaskSchema = z.object({
  intent: z.string().min(1),
  source: z.enum(["im", "mobile", "desktop", "api"]).default("im"),
  trigger: z
    .object({
      source: z.enum(["web", "lark-im"]),
      chatId: z.string().optional(),
      messageId: z.string().optional(),
      sender: z.string().optional(),
      rawText: z.string().optional()
    })
    .optional()
}) satisfies z.ZodType<CreateTaskRequest>;

const commandSchema = z.object({
  command: z.string().min(1)
}) satisfies z.ZodType<SendCommandRequest>;

const larkImTriggerSchema = z
  .object({
    chatId: z.string().optional(),
    messageId: z.string().optional(),
    sender: z.string().optional(),
    text: z.string().optional(),
    senderType: z.string().optional(),
    header: z
      .object({
        token: z.string().optional()
      })
      .passthrough()
      .optional(),
    event: z.unknown().optional(),
    token: z.string().optional(),
    verification_token: z.string().optional(),
    challenge: z.string().optional()
  })
  .passthrough() satisfies z.ZodType<LarkImTriggerRequest>;

const app = express();
const server = createServer(app);
const store = new TaskStore();
const llm = createLlm();
const office = createOfficeAdapter();
const orchestrator = new AgentOrchestrator(store, llm, office);
const handledLarkMessages = new HandledMessageStore(config.larkStatePath);
const startedAt = Date.now();

attachRealtime(server, store);

app.use(cors());
app.use(
  express.json({
    limit: "1mb",
    verify: (req, _res, buffer) => {
      (req as RawBodyRequest).rawBody = Buffer.from(buffer);
    }
  })
);

app.get("/health", (_req, res) => {
  res.json({ ok: true, llm: llm.mode, officeAdapter: office.name });
});

app.get("/api/config", (_req, res) => {
  const runtimeConfig: RuntimeConfig = {
    llmMode: llm.mode,
    officeAdapter: office.name,
    hasArkEndpoint: Boolean(config.arkEndpointId),
    hasArkApiKey: Boolean(config.arkApiKey),
    hasLarkDefaultChatId: Boolean(config.larkDefaultChatId),
    larkImTriggerPath: "/api/triggers/lark-im"
  };
  res.json(runtimeConfig);
});

app.get("/api/readiness", (_req, res) => {
  const checks = [
    {
      id: "llm",
      label: "豆包 2.0 Pro",
      ok: llm.mode === "doubao" && config.useDoubao,
      detail:
        llm.mode === "doubao" && config.useDoubao
          ? "已配置 Ark endpoint 和 API key。"
          : "当前未完整启用 doubao，可能处于 mock 或缺少 Ark 配置。"
    },
    {
      id: "office",
      label: "飞书 Office Adapter",
      ok: office.name === "lark-cli",
      detail: office.name === "lark-cli" ? "已使用 lark-cli 创建 Docs / Slides / 群回发。" : "当前使用 mock adapter。"
    },
    {
      id: "chat",
      label: "默认测试群",
      ok: Boolean(config.larkDefaultChatId),
      detail: config.larkDefaultChatId ? "已配置默认测试群。" : "未配置 LARK_DEFAULT_CHAT_ID。"
    },
    {
      id: "allowed-chats",
      label: "群白名单",
      ok: config.larkAllowedChatIds.length > 0,
      detail: config.larkAllowedChatIds.length
        ? `已限制 ${config.larkAllowedChatIds.length} 个允许触发的群。`
        : "未配置 LARK_ALLOWED_CHAT_IDS，真实演示前建议限制测试群。"
    },
    {
      id: "bot-filter",
      label: "机器人自消息过滤",
      ok: Boolean(config.larkBotOpenId || config.larkBotUserId),
      detail: config.larkBotOpenId || config.larkBotUserId
        ? "已配置机器人身份过滤。"
        : "未配置 LARK_BOT_OPEN_ID / LARK_BOT_USER_ID，仅依赖 senderType 过滤。"
    },
    {
      id: "event-security",
      label: "事件安全",
      ok: Boolean(config.larkEventVerifyToken || config.larkEventEncryptKey),
      detail: config.larkEventVerifyToken || config.larkEventEncryptKey
        ? "已配置 verify token 或 encrypt key。"
        : "长连接本地演示可运行；若切 webhook，必须配置签名或 token。"
    },
    {
      id: "state",
      label: "幂等状态",
      ok: config.larkStatePath !== ":memory:",
      detail:
        config.larkStatePath === ":memory:"
          ? "当前幂等记录为内存模式，重启后会丢失。"
          : `幂等记录路径：${config.larkStatePath}`
    }
  ];

  const readiness: ReadinessStatus = {
    ok: checks.every((check) => check.ok),
    checkedAt: new Date().toISOString(),
    uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
    publicApiBaseUrl: config.publicApiBaseUrl,
    publicWebBaseUrl: config.publicWebBaseUrl,
    checks
  };

  res.json(readiness);
});

app.get("/api/tasks", (_req, res) => {
  res.json({ tasks: store.listTasks(), events: store.listEvents() });
});

app.get("/api/tasks/:taskId", (req, res) => {
  const task = store.getTask(req.params.taskId);
  if (!task) {
    res.status(404).json({ error: "Task not found." });
    return;
  }
  res.json({ task, events: store.listEvents(task.id) });
});

app.delete("/api/test/reset", (_req, res) => {
  if (!config.enableTestEndpoints) {
    res.status(404).json({ error: "Not found." });
    return;
  }

  store.clear();
  res.json({ ok: true });
});

app.post("/api/tasks", (req, res) => {
  const input = createTaskSchema.parse(req.body);
  const task = orchestrator.createTask(input);
  res.status(202).json({ task });
});

const handleLarkImTrigger: express.RequestHandler = (req, res, next) => {
  try {
    const input = larkImTriggerSchema.parse(req.body);
    const verifyDecision = validateLarkVerifyToken(req, input);
    if (!verifyDecision.allowed) {
      const response: LarkImTriggerResponse = {
        accepted: false,
        ignored: true,
        reason: verifyDecision.reason ?? "lark verification failed"
      };
      res.status(verifyDecision.status ?? 403).json(response);
      return;
    }

    const signatureDecision = validateLarkSignature(req as RawBodyRequest, input);
    if (!signatureDecision.allowed) {
      const response: LarkImTriggerResponse = {
        accepted: false,
        ignored: true,
        reason: signatureDecision.reason ?? "lark signature verification failed"
      };
      res.status(signatureDecision.status ?? 403).json(response);
      return;
    }

    if (input.challenge) {
      const response: LarkImTriggerResponse = {
        accepted: false,
        ignored: true,
        challenge: input.challenge,
        reason: "lark.challenge"
      };
      res.json(response);
      return;
    }

    const extracted = extractLarkImTrigger(input);
    const trigger = buildTaskTrigger(extracted);
    const messageDecision = validateLarkMessage(extracted);
    if (!messageDecision.allowed) {
      const response: LarkImTriggerResponse = {
        accepted: false,
        ignored: true,
        reason: messageDecision.reason ?? "lark message ignored",
        trigger
      };
      res.status(messageDecision.status ?? 200).json(response);
      return;
    }

    if (extracted.messageId && handledLarkMessages.has(extracted.messageId)) {
      const response: LarkImTriggerResponse = {
        accepted: false,
        ignored: true,
        reason: "duplicate message ignored",
        trigger
      };
      res.json(response);
      return;
    }

    if (isCancelText(extracted.text)) {
      const activeTask = findLatestLarkTaskByChat(extracted.chatId, [
        "waiting_user",
        "planning",
        "running"
      ]);

      if (!activeTask) {
        const response: LarkImTriggerResponse = {
          accepted: false,
          ignored: true,
          reason: "no active task to cancel",
          trigger
        };
        res.json(response);
        return;
      }

      void orchestrator.cancelTask(activeTask.id, extracted.text);
      if (extracted.messageId) {
        handledLarkMessages.add(extracted.messageId, activeTask.id);
      }

      const response: LarkImTriggerResponse = {
        accepted: true,
        ignored: false,
        reason: "cancelled active task",
        task: store.getTask(activeTask.id) ?? activeTask,
        trigger
      };
      res.status(202).json(response);
      return;
    }

    if (isProgressText(extracted.text)) {
      const latestTask = findLatestLarkTaskByChat(extracted.chatId);

      if (!latestTask) {
        const response: LarkImTriggerResponse = {
          accepted: false,
          ignored: true,
          reason: "no task found for progress",
          trigger
        };
        res.json(response);
        return;
      }

      void orchestrator.reportTaskProgress(latestTask.id, extracted.text);
      if (extracted.messageId) {
        handledLarkMessages.add(extracted.messageId, latestTask.id);
      }

      const response: LarkImTriggerResponse = {
        accepted: true,
        ignored: false,
        reason: "reported task progress",
        task: latestTask,
        trigger
      };
      res.status(202).json(response);
      return;
    }

    if (isConfirmationText(extracted.text)) {
      const waitingTask = findLatestLarkTaskByChat(extracted.chatId, ["waiting_user"]);

      if (!waitingTask) {
        const response: LarkImTriggerResponse = {
          accepted: false,
          ignored: true,
          reason: "no waiting task to confirm",
          trigger
        };
        res.json(response);
        return;
      }

      const task = orchestrator.confirmTask(waitingTask.id, extracted.text) ?? waitingTask;
      if (extracted.messageId) {
        handledLarkMessages.add(extracted.messageId, task.id);
      }

      const response: LarkImTriggerResponse = {
        accepted: true,
        ignored: false,
        reason: "confirmed waiting task",
        task,
        trigger
      };
      res.status(202).json(response);
      return;
    }

    if (!shouldTriggerAgent(extracted.text)) {
      const response: LarkImTriggerResponse = {
        accepted: false,
        ignored: true,
        reason: "message does not match agent trigger keywords",
        trigger
      };
      res.json(response);
      return;
    }

    const activeSession = findLatestLarkTaskByChat(extracted.chatId, [
      "created",
      "planning",
      "waiting_user",
      "running"
    ]);
    if (activeSession) {
      const response: LarkImTriggerResponse = {
        accepted: false,
        ignored: true,
        reason: "chat session already active",
        task: activeSession,
        trigger
      };
      res.json(response);
      return;
    }

    const intent = sanitizeIntent(extracted.text);
    const task = orchestrator.createTask({
      intent:
        intent ||
        "请读取当前飞书群最近讨论，整理正式需求文档，生成汇报 Slides 和 3 分钟讲稿，并把交付摘要回发到群里。",
      source: "im",
      trigger
    });
    if (extracted.messageId) {
      handledLarkMessages.add(extracted.messageId, task.id);
    }

    const response: LarkImTriggerResponse = {
      accepted: true,
      ignored: false,
      task,
      trigger: task.trigger
    };
    res.status(202).json(response);
  } catch (error) {
    next(error);
  }
};

function findLatestLarkTaskByChat(chatId: string | undefined, statuses?: TaskStatus[]) {
  if (!chatId) return undefined;

  return store
    .listTasks()
    .find(
      (task): task is Task =>
        task.trigger?.source === "lark-im" &&
        task.trigger?.chatId === chatId &&
        (!statuses || statuses.includes(task.status))
    );
}

app.post("/api/lark/events", handleLarkImTrigger);
app.post("/api/triggers/lark-im", handleLarkImTrigger);

app.post("/api/tasks/:taskId/commands", async (req, res, next) => {
  try {
    const input = commandSchema.parse(req.body);
    const task = await orchestrator.handleCommand(req.params.taskId, input.command);
    res.json({ task });
  } catch (error) {
    next(error);
  }
});

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const message = error instanceof Error ? error.message : "Unexpected server error.";
  res.status(400).json({ error: message });
});

server.listen(config.apiPort, () => {
  console.log(`Agent-Pilot API listening on http://localhost:${config.apiPort}`);
  console.log(`LLM mode: ${llm.mode}; office adapter: ${office.name}`);
});
