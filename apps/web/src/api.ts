import type { CreateTaskRequest, RuntimeConfig, SendCommandRequest, Task } from "@agent-pilot/shared";

const configuredApiBaseUrl = normalizeBaseUrl(import.meta.env.VITE_API_BASE_URL);
const configuredWsUrl = normalizeBaseUrl(import.meta.env.VITE_WS_URL);

export async function fetchRuntimeConfig(): Promise<RuntimeConfig> {
  const response = await fetch(apiUrl("/api/config"));
  return response.json();
}

export async function fetchTasks(): Promise<Task[]> {
  const response = await fetch(apiUrl("/api/tasks"));
  const data = await response.json();
  return data.tasks;
}

export async function createTask(input: CreateTaskRequest): Promise<Task> {
  const response = await fetch(apiUrl("/api/tasks"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? "Create task failed.");
  return data.task;
}

export async function sendCommand(taskId: string, input: SendCommandRequest): Promise<Task> {
  const response = await fetch(apiUrl(`/api/tasks/${taskId}/commands`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? "Send command failed.");
  return data.task;
}

export function getRealtimeWsUrl(): string {
  if (configuredWsUrl) return configuredWsUrl;

  if (configuredApiBaseUrl) {
    const apiUrl = new URL(configuredApiBaseUrl);
    apiUrl.protocol = apiUrl.protocol === "https:" ? "wss:" : "ws:";
    apiUrl.pathname = appendPath(apiUrl.pathname, "/ws");
    apiUrl.search = "";
    apiUrl.hash = "";
    return apiUrl.toString();
  }

  const isLocal = ["localhost", "127.0.0.1", "0.0.0.0"].includes(window.location.hostname);
  const host = isLocal ? `${window.location.hostname}:8787` : window.location.host;
  const protocol = window.location.protocol === "https:" ? "wss" : "ws";
  return `${protocol}://${host}/ws`;
}

function apiUrl(path: string) {
  return configuredApiBaseUrl ? appendPath(configuredApiBaseUrl, path) : path;
}

function normalizeBaseUrl(value: unknown) {
  if (typeof value !== "string") return "";
  return value.trim().replace(/\/+$/, "");
}

function appendPath(baseUrl: string, path: string) {
  const base = baseUrl.replace(/\/+$/, "");
  const suffix = path.startsWith("/") ? path : `/${path}`;
  return `${base}${suffix}`;
}
