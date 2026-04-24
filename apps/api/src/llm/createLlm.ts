import { config } from "../env";
import type { AgentLlm } from "./AgentLlm";
import { DoubaoLlm } from "./DoubaoLlm";
import { MockLlm } from "./MockLlm";

export function createLlm(): AgentLlm {
  if (config.useDoubao && config.arkApiKey && config.arkEndpointId) {
    return new DoubaoLlm({
      apiKey: config.arkApiKey,
      endpointId: config.arkEndpointId,
      baseUrl: config.arkBaseUrl
    });
  }

  return new MockLlm();
}

