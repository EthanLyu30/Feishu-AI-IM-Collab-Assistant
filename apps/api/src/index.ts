import cors from "cors";
import express from "express";
import { createServer } from "node:http";
import { z } from "zod";
import type {
  CreateTaskRequest,
  LarkImTriggerRequest,
  LarkImTriggerResponse,
  RuntimeConfig,
  SendCommandRequest
} from "@agent-pilot/shared";
import { createOfficeAdapter } from "./adapters/createOfficeAdapter";
import { AgentOrchestrator } from "./agent/AgentOrchestrator";
import { config } from "./env";
import { createLlm } from "./llm/createLlm";
import { attachRealtime } from "./realtime";
import { TaskStore } from "./state/TaskStore";
import {
  buildTaskTrigger,
  extractLarkImTrigger,
  isConfirmationText,
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
    event: z.unknown().optional(),
    challenge: z.string().optional()
  })
  .passthrough() satisfies z.ZodType<LarkImTriggerRequest>;

const app = express();
const server = createServer(app);
const store = new TaskStore();
const llm = createLlm();
const office = createOfficeAdapter();
const orchestrator = new AgentOrchestrator(store, llm, office);
const handledLarkMessages = new Map<string, string>();

attachRealtime(server, store);

app.use(cors());
app.use(express.json({ limit: "1mb" }));

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

app.post("/api/tasks", (req, res) => {
  const input = createTaskSchema.parse(req.body);
  const task = orchestrator.createTask(input);
  res.status(202).json({ task });
});

const handleLarkImTrigger: express.RequestHandler = (req, res, next) => {
  try {
    const input = larkImTriggerSchema.parse(req.body);
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

    if (isConfirmationText(extracted.text)) {
      const waitingTask = store
        .listTasks()
        .find(
          (task) =>
            task.status === "waiting_user" &&
            task.trigger?.source === "lark-im" &&
            task.trigger?.chatId === extracted.chatId
        );

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
        handledLarkMessages.set(extracted.messageId, task.id);
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

    const intent = sanitizeIntent(extracted.text);
    const task = orchestrator.createTask({
      intent:
        intent ||
        "请读取当前飞书群最近讨论，整理正式需求文档，生成汇报 Slides 和 3 分钟讲稿，并把交付摘要回发到群里。",
      source: "im",
      trigger
    });
    if (extracted.messageId) {
      handledLarkMessages.set(extracted.messageId, task.id);
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
