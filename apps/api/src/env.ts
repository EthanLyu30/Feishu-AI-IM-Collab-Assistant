import dotenv from "dotenv";
import path from "node:path";
import { z } from "zod";

dotenv.config({ path: path.resolve(process.cwd(), ".env") });
dotenv.config({ path: path.resolve(process.cwd(), ".env.local"), override: true });

const envSchema = z.object({
  API_PORT: z.coerce.number().default(8787),
  AGENT_LLM_MODE: z.enum(["mock", "doubao"]).default("mock"),
  ARK_BASE_URL: z.string().url().default("https://ark.cn-beijing.volces.com/api/v3"),
  ARK_ENDPOINT_ID: z.string().optional(),
  ARK_API_KEY: z.string().optional(),
  OFFICE_ADAPTER: z.enum(["mock", "lark-cli"]).default("mock"),
  LARK_CLI_BIN: z.string().default("lark-cli")
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
  get useDoubao() {
    return Boolean(
      parsed.AGENT_LLM_MODE === "doubao" && parsed.ARK_ENDPOINT_ID && parsed.ARK_API_KEY
    );
  }
};

