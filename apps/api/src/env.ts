import dotenv from "dotenv";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";

const explicitEnv = new Set(Object.keys(process.env));

for (const envPath of [
  path.resolve(process.cwd(), ".env"),
  path.resolve(process.cwd(), "../../.env")
]) {
  dotenv.config({ path: envPath });
}

for (const envPath of [
  path.resolve(process.cwd(), ".env.local"),
  path.resolve(process.cwd(), "../../.env.local")
]) {
  loadLocalEnv(envPath, explicitEnv);
}

const envSchema = z.object({
  API_PORT: z.coerce.number().default(8787),
  AGENT_LLM_MODE: z.enum(["mock", "doubao"]).default("mock"),
  ARK_BASE_URL: z.string().url().default("https://ark.cn-beijing.volces.com/api/v3"),
  ARK_ENDPOINT_ID: z.string().optional(),
  ARK_API_KEY: z.string().optional(),
  OFFICE_ADAPTER: z.enum(["mock", "lark-cli"]).default("mock"),
  LARK_CLI_BIN: z.string().default("lark-cli"),
  LARK_DEFAULT_CHAT_ID: z.string().optional(),
  LARK_EVENT_VERIFY_TOKEN: z.string().optional(),
  LARK_EVENT_ENCRYPT_KEY: z.string().optional(),
  LARK_ALLOWED_CHAT_IDS: z.string().optional(),
  LARK_BOT_OPEN_ID: z.string().optional(),
  LARK_BOT_USER_ID: z.string().optional(),
  LARK_STATE_PATH: z.string().default(".data/lark-state.json")
});

const parsed = envSchema.parse(process.env);

export const config = {
  apiPort: parsed.API_PORT,
  llmMode: parsed.AGENT_LLM_MODE,
  arkBaseUrl: parsed.ARK_BASE_URL,
  arkEndpointId: parsed.ARK_ENDPOINT_ID,
  arkApiKey: parsed.ARK_API_KEY,
  officeAdapter: parsed.OFFICE_ADAPTER,
  larkCliBin: parsed.LARK_CLI_BIN,
  larkDefaultChatId: parsed.LARK_DEFAULT_CHAT_ID,
  larkEventVerifyToken: parsed.LARK_EVENT_VERIFY_TOKEN,
  larkEventEncryptKey: parsed.LARK_EVENT_ENCRYPT_KEY,
  larkAllowedChatIds: splitCsv(parsed.LARK_ALLOWED_CHAT_IDS),
  larkBotOpenId: parsed.LARK_BOT_OPEN_ID,
  larkBotUserId: parsed.LARK_BOT_USER_ID,
  larkStatePath: parsed.LARK_STATE_PATH,
  get useDoubao() {
    return Boolean(
      parsed.AGENT_LLM_MODE === "doubao" && parsed.ARK_ENDPOINT_ID && parsed.ARK_API_KEY
    );
  }
};

function splitCsv(value: string | undefined) {
  return (
    value
      ?.split(",")
      .map((item) => item.trim())
      .filter(Boolean) ?? []
  );
}

function loadLocalEnv(envPath: string, explicitKeys: Set<string>) {
  if (!existsSync(envPath)) return;

  const parsed = dotenv.parse(readFileSync(envPath));
  for (const [key, value] of Object.entries(parsed)) {
    if (!explicitKeys.has(key)) {
      process.env[key] = value;
    }
  }
}
