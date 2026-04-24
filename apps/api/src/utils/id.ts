import { randomUUID } from "node:crypto";

export function createId(prefix: string) {
  return `${prefix}_${randomUUID().slice(0, 8)}`;
}

export function nowIso() {
  return new Date().toISOString();
}

export function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

