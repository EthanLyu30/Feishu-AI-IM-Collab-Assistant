import cors from "cors";
import express from "express";
import { createServer } from "node:http";
import { z } from "zod";
import type { CreateTaskRequest, RuntimeConfig, SendCommandRequest } from "@agent-pilot/shared";
import { createOfficeAdapter } from "./adapters/createOfficeAdapter";
import { AgentOrchestrator } from "./agent/AgentOrchestrator";
import { config } from "./env";
import { createLlm } from "./llm/createLlm";
import { attachRealtime } from "./realtime";
import { TaskStore } from "./state/TaskStore";

const createTaskSchema = z.object({
  intent: z.string().min(1),
  source: z.enum(["im", "mobile", "desktop", "api"]).default("im")
}) satisfies z.ZodType<CreateTaskRequest>;

const commandSchema = z.object({
  command: z.string().min(1)
}) satisfies z.ZodType<SendCommandRequest>;

const app = express();
const server = createServer(app);
const store = new TaskStore();
const llm = createLlm();
const office = createOfficeAdapter();
const orchestrator = new AgentOrchestrator(store, llm, office);

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
    hasLarkDefaultChatId: Boolean(config.larkDefaultChatId)
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
