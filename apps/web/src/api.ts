import type { CreateTaskRequest, RuntimeConfig, SendCommandRequest, Task } from "@agent-pilot/shared";

export type EndpointConfig = {
  apiBaseUrl: string;
  wsUrl: string;
  source: "query" | "storage" | "env" | "local";
};

const endpointStorageKey = "agent-pilot:endpoints";
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
  const endpoint = getEndpointConfig();
  if (endpoint.wsUrl) return endpoint.wsUrl;

  if (endpoint.apiBaseUrl) {
    const apiUrl = new URL(endpoint.apiBaseUrl);
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

export function getEndpointConfig(): EndpointConfig {
  const queryConfig = readQueryConfig();
  if (queryConfig.apiBaseUrl || queryConfig.wsUrl) {
    persistEndpointConfig(queryConfig);
    return { ...queryConfig, source: "query" };
  }

  const storedConfig = readStoredConfig();
  if (storedConfig.apiBaseUrl || storedConfig.wsUrl) {
    return { ...storedConfig, source: "storage" };
  }

  if (configuredApiBaseUrl || configuredWsUrl) {
    return {
      apiBaseUrl: configuredApiBaseUrl,
      wsUrl: configuredWsUrl,
      source: "env"
    };
  }

  return { apiBaseUrl: "", wsUrl: "", source: "local" };
}

export function saveEndpointConfig(config: Pick<EndpointConfig, "apiBaseUrl" | "wsUrl">) {
  persistEndpointConfig(config);
  window.dispatchEvent(new Event("agent-pilot:endpoints-changed"));
}

export function resetEndpointConfig() {
  window.localStorage.removeItem(endpointStorageKey);
  window.dispatchEvent(new Event("agent-pilot:endpoints-changed"));
}

function apiUrl(path: string) {
  const endpoint = getEndpointConfig();
  return endpoint.apiBaseUrl ? appendPath(endpoint.apiBaseUrl, path) : path;
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

function readQueryConfig() {
  const params = new URLSearchParams(window.location.search);
  return {
    apiBaseUrl: normalizeBaseUrl(params.get("api")),
    wsUrl: normalizeWsUrl(params.get("ws"))
  };
}

function readStoredConfig() {
  try {
    const stored = JSON.parse(window.localStorage.getItem(endpointStorageKey) ?? "{}") as Partial<EndpointConfig>;
    return {
      apiBaseUrl: normalizeBaseUrl(stored.apiBaseUrl),
      wsUrl: normalizeWsUrl(stored.wsUrl)
    };
  } catch {
    return { apiBaseUrl: "", wsUrl: "" };
  }
}

function persistEndpointConfig(config: Pick<EndpointConfig, "apiBaseUrl" | "wsUrl">) {
  const nextConfig = {
    apiBaseUrl: normalizeBaseUrl(config.apiBaseUrl),
    wsUrl: normalizeWsUrl(config.wsUrl)
  };

  if (!nextConfig.apiBaseUrl && !nextConfig.wsUrl) {
    window.localStorage.removeItem(endpointStorageKey);
    return;
  }

  window.localStorage.setItem(endpointStorageKey, JSON.stringify(nextConfig));
}

function normalizeWsUrl(value: unknown) {
  const normalized = normalizeBaseUrl(value);
  if (!normalized) return "";
  if (normalized.endsWith("/ws")) return normalized;
  return appendPath(normalized, "/ws");
}
