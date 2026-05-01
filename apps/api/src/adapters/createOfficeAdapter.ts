import { config } from "../env";
import type { OfficeToolAdapter } from "./OfficeToolAdapter";
import { LarkCliAdapter } from "./LarkCliAdapter";
import { MockOfficeToolAdapter } from "./MockOfficeToolAdapter";

export function createOfficeAdapter(): OfficeToolAdapter {
  if (config.officeAdapter === "lark-cli") {
    return new LarkCliAdapter(config.larkCliBin, config.larkDefaultChatId, {
      timeoutMs: config.larkCliTimeoutMs,
      readRetries: config.larkCliReadRetries
    });
  }

  return new MockOfficeToolAdapter();
}
