import { EventEmitter } from "node:events";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { AgentEvent, AgentEventType, AgentPlan, AgentStep, Artifact, Task, TaskSource, TaskStatus } from "@agent-pilot/shared";
import { createId, nowIso } from "../utils/id";

type StoreEvents = {
  event: [AgentEvent];
};

export class TaskStore {
  private tasks = new Map<string, Task>();
  private events: AgentEvent[] = [];
  private emitter = new EventEmitter();

  constructor(private readonly statePath = ":memory:") {
    this.load();
  }

  onEvent(listener: (event: AgentEvent) => void) {
    this.emitter.on("event", listener);
    return () => this.emitter.off("event", listener);
  }

  listTasks() {
    return Array.from(this.tasks.values()).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  listEvents(taskId?: string) {
    return taskId ? this.events.filter((event) => event.taskId === taskId) : [...this.events];
  }

  getTask(taskId: string) {
    return this.tasks.get(taskId);
  }

  clear() {
    this.tasks.clear();
    this.events = [];
    this.persist();
  }

  createTask(input: { title: string; source: TaskSource; userIntent: string; trigger?: Task["trigger"] }) {
    const now = nowIso();
    const task: Task = {
      id: createId("task"),
      title: input.title,
      source: input.source,
      trigger: input.trigger,
      status: "created",
      userIntent: input.userIntent,
      artifacts: [],
      createdAt: now,
      updatedAt: now
    };
    this.tasks.set(task.id, task);
    this.emit(task.id, "task.created", { task });
    return task;
  }

  updateTask(taskId: string, patch: Partial<Task>) {
    const current = this.requireTask(taskId);
    const next = { ...current, ...patch, updatedAt: nowIso() };
    this.tasks.set(taskId, next);
    this.emit(taskId, "task.updated", { task: next });
    return next;
  }

  setStatus(taskId: string, status: TaskStatus, error?: string) {
    return this.updateTask(taskId, { status, error });
  }

  setPlan(taskId: string, plan: AgentPlan) {
    const task = this.updateTask(taskId, { plan });
    this.emit(taskId, "task.planned", { plan });
    return task;
  }

  updateStep(taskId: string, stepId: string, patch: Partial<AgentStep>) {
    const task = this.requireTask(taskId);
    if (!task.plan) return task;

    const steps = task.plan.steps.map((step) =>
      step.id === stepId ? { ...step, ...patch } : step
    );
    const nextPlan = { ...task.plan, steps };
    const nextTask = this.updateTask(taskId, { plan: nextPlan });

    const step = steps.find((item) => item.id === stepId);
    if (step?.status === "running") {
      this.emit(taskId, "step.started", { step });
    }
    if (step?.status === "completed") {
      this.emit(taskId, "step.completed", { step });
    }
    return nextTask;
  }

  addAdHocStep(taskId: string, step: AgentStep) {
    const task = this.requireTask(taskId);
    const plan: AgentPlan = task.plan ?? {
      goal: task.userIntent,
      steps: [],
      requiredConfirmations: [],
      risks: []
    };
    const nextPlan = { ...plan, steps: [...plan.steps, step] };
    return this.updateTask(taskId, { plan: nextPlan });
  }

  upsertArtifact(taskId: string, artifact: Artifact) {
    const task = this.requireTask(taskId);
    const exists = task.artifacts.some((item) => item.id === artifact.id);
    const artifacts = exists
      ? task.artifacts.map((item) => (item.id === artifact.id ? artifact : item))
      : [...task.artifacts, artifact];
    const next = this.updateTask(taskId, { artifacts });
    this.emit(taskId, exists ? "artifact.updated" : "artifact.created", { artifact });
    return next;
  }

  emit(taskId: string, type: AgentEventType, payload: Record<string, unknown>) {
    const event: AgentEvent = {
      id: createId("evt"),
      taskId,
      type,
      timestamp: nowIso(),
      payload
    };
    this.events.push(event);
    this.emitter.emit("event", event);
    this.persist();
    return event;
  }

  private load() {
    if (!this.shouldPersist() || !existsSync(this.statePath)) {
      return;
    }

    try {
      const raw = readFileSync(this.statePath, "utf-8");
      if (!raw.trim()) return;

      const snapshot = JSON.parse(raw) as Partial<TaskStoreSnapshot>;
      const tasks = Array.isArray(snapshot.tasks) ? snapshot.tasks : [];
      const events = Array.isArray(snapshot.events) ? snapshot.events : [];

      this.tasks = new Map(tasks.map((task) => [task.id, task]));
      this.events = events;
    } catch {
      try {
        renameSync(this.statePath, `${this.statePath}.corrupt-${Date.now()}`);
      } catch {
        // Keep startup resilient even if the corrupt state file cannot be moved.
      }
      this.tasks = new Map();
      this.events = [];
    }
  }

  private persist() {
    if (!this.shouldPersist()) {
      return;
    }

    mkdirSync(dirname(this.statePath), { recursive: true });
    const snapshot: TaskStoreSnapshot = {
      tasks: this.listTasks(),
      events: this.events
    };
    const tmpPath = `${this.statePath}.tmp`;
    writeFileSync(tmpPath, JSON.stringify(snapshot, null, 2), "utf-8");
    renameSync(tmpPath, this.statePath);
  }

  private shouldPersist() {
    return this.statePath !== ":memory:";
  }

  private requireTask(taskId: string) {
    const task = this.tasks.get(taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }
    return task;
  }
}

interface TaskStoreSnapshot {
  tasks: Task[];
  events: AgentEvent[];
}
