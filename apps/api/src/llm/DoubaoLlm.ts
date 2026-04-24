import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import type { AgentLlm, LlmMessage } from "./AgentLlm";
import { parseJsonFromModel } from "./json";

export class DoubaoLlm implements AgentLlm {
  mode = "doubao" as const;
  private client: OpenAI;

  constructor(
    private readonly options: {
      apiKey: string;
      endpointId: string;
      baseUrl: string;
    }
  ) {
    this.client = new OpenAI({
      apiKey: options.apiKey,
      baseURL: options.baseUrl
    });
  }

  async completeText(messages: LlmMessage[], options?: { temperature?: number }) {
    const response = await this.client.chat.completions.create({
      model: this.options.endpointId,
      messages: messages as ChatCompletionMessageParam[],
      temperature: options?.temperature ?? 0.2
    });

    return response.choices[0]?.message?.content ?? "";
  }

  async completeJson<T>(messages: LlmMessage[], options?: { temperature?: number }) {
    try {
      const response = await this.client.chat.completions.create({
        model: this.options.endpointId,
        messages: messages as ChatCompletionMessageParam[],
        temperature: options?.temperature ?? 0.2,
        response_format: { type: "json_object" }
      });
      return parseJsonFromModel<T>(response.choices[0]?.message?.content ?? "");
    } catch (error) {
      const fallback = await this.completeText(messages, options);
      return parseJsonFromModel<T>(fallback);
    }
  }
}

