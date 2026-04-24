import type { CreateTaskRequest, RuntimeConfig, SendCommandRequest, Task } from "@agent-pilot/shared";

export async function fetchRuntimeConfig(): Promise<RuntimeConfig> {
  const response = await fetch("/api/config");
  return response.json();
}

export async function fetchTasks(): Promise<Task[]> {
  const response = await fetch("/api/tasks");
  const data = await response.json();
  return data.tasks;
}

export async function createTask(input: CreateTaskRequest): Promise<Task> {
  const response = await fetch("/api/tasks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? "Create task failed.");
  return data.task;
}

export async function sendCommand(taskId: string, input: SendCommandRequest): Promise<Task> {
  const response = await fetch(`/api/tasks/${taskId}/commands`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? "Send command failed.");
  return data.task;
}

