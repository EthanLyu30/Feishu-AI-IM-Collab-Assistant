import type { AgentLlm, LlmMessage } from "./AgentLlm";

export class MockLlm implements AgentLlm {
  mode = "mock" as const;

  async completeText(messages: LlmMessage[]) {
    return messages[messages.length - 1]?.content ?? "";
  }

  async completeJson<T>(): Promise<T> {
    throw new Error("MockLlm does not support arbitrary JSON completion directly.");
  }
}
