export type LlmMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export interface AgentLlm {
  mode: "mock" | "doubao";
  completeText(messages: LlmMessage[], options?: { temperature?: number }): Promise<string>;
  completeJson<T>(messages: LlmMessage[], options?: { temperature?: number }): Promise<T>;
}

