import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

interface HandledMessageState {
  messages: Record<string, string>;
}

export class HandledMessageStore {
  private readonly filePath: string;
  private readonly inMemory: boolean;
  private readonly messages = new Map<string, string>();

  constructor(filePath: string) {
    this.inMemory = filePath === ":memory:";
    this.filePath = this.inMemory ? filePath : resolve(process.cwd(), filePath);
    this.load();
  }

  has(messageId: string) {
    return this.messages.has(messageId);
  }

  get(messageId: string) {
    return this.messages.get(messageId);
  }

  add(messageId: string, taskId: string) {
    this.messages.set(messageId, taskId);
    this.persist();
  }

  private load() {
    if (this.inMemory) return;
    if (!existsSync(this.filePath)) return;

    try {
      const state = JSON.parse(readFileSync(this.filePath, "utf-8")) as Partial<HandledMessageState>;
      for (const [messageId, taskId] of Object.entries(state.messages ?? {})) {
        if (messageId && taskId) {
          this.messages.set(messageId, taskId);
        }
      }
    } catch {
      this.messages.clear();
    }
  }

  private persist() {
    if (this.inMemory) return;

    mkdirSync(dirname(this.filePath), { recursive: true });
    const state: HandledMessageState = {
      messages: Object.fromEntries(this.messages.entries())
    };
    writeFileSync(this.filePath, `${JSON.stringify(state, null, 2)}\n`, "utf-8");
  }
}
