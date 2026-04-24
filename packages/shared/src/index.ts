export type TaskSource = "im" | "mobile" | "desktop" | "api";

export type TaskStatus =
  | "created"
  | "planning"
  | "running"
  | "waiting_user"
  | "completed"
  | "failed";

export type StepStatus = "pending" | "running" | "completed" | "failed" | "skipped";

export type ArtifactType = "doc" | "slides" | "canvas" | "summary" | "export";

export type AgentEventType =
  | "task.created"
  | "task.updated"
  | "task.planned"
  | "step.started"
  | "step.completed"
  | "artifact.created"
  | "artifact.updated"
  | "user.commanded"
  | "task.delivered"
  | "task.failed";

export interface ChatMessage {
  id: string;
  sender: "user" | "teammate" | "agent" | "system";
  content: string;
  timestamp: string;
}

export interface MessageContext {
  source: "mock" | "feishu";
  chatName: string;
  messages: ChatMessage[];
}

export interface AgentStep {
  id: string;
  title: string;
  tool: string;
  status: StepStatus;
  inputSummary: string;
  expectedOutput: string;
  outputSummary?: string;
  startedAt?: string;
  completedAt?: string;
}

export interface AgentPlan {
  goal: string;
  steps: AgentStep[];
  requiredConfirmations: string[];
  risks: string[];
}

export interface Artifact {
  id: string;
  type: ArtifactType;
  title: string;
  version: number;
  content: string;
  url?: string;
  createdBy: "agent" | "user";
  updatedAt: string;
}

export interface Task {
  id: string;
  title: string;
  source: TaskSource;
  status: TaskStatus;
  userIntent: string;
  plan?: AgentPlan;
  artifacts: Artifact[];
  createdAt: string;
  updatedAt: string;
  error?: string;
}

export interface AgentEvent {
  id: string;
  taskId: string;
  type: AgentEventType;
  timestamp: string;
  payload: Record<string, unknown>;
}

export interface CreateTaskRequest {
  intent: string;
  source?: TaskSource;
}

export interface SendCommandRequest {
  command: string;
}

export interface RuntimeConfig {
  llmMode: "mock" | "doubao";
  officeAdapter: "mock" | "lark-cli";
  hasArkEndpoint: boolean;
  hasArkApiKey: boolean;
}

export const sampleDiscussion: ChatMessage[] = [
  {
    id: "m1",
    sender: "user",
    content: "我们需要做一个校园活动报名系统，先支持学生查看活动和报名。",
    timestamp: "2026-04-24T09:00:00.000Z"
  },
  {
    id: "m2",
    sender: "teammate",
    content: "老师这边需要发布活动，还要能看到报名人数。",
    timestamp: "2026-04-24T09:01:00.000Z"
  },
  {
    id: "m3",
    sender: "user",
    content: "最好有截止时间，超过时间不能报名。",
    timestamp: "2026-04-24T09:02:00.000Z"
  },
  {
    id: "m4",
    sender: "teammate",
    content: "后台要能导出报名名单，后面做活动签到。",
    timestamp: "2026-04-24T09:03:00.000Z"
  },
  {
    id: "m5",
    sender: "user",
    content: "汇报时重点讲痛点、方案、核心流程和后续规划。",
    timestamp: "2026-04-24T09:04:00.000Z"
  }
];

export const sampleIntent =
  "帮我把刚才关于校园活动报名系统的讨论整理成需求文档，并生成一份 5 页汇报 PPT，最后给我一段 3 分钟讲稿。";

