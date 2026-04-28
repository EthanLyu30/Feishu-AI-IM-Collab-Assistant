import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

const cliBin = process.env.LARK_CLI_BIN || "lark-cli";
const apiUrl = process.env.AGENT_LARK_EVENT_URL || "http://localhost:8787/api/lark/events";
const eventTypes = process.env.LARK_EVENT_TYPES || "im.message.receive_v1";
const identity = process.env.LARK_EVENT_AS || "bot";
const args = ["event", "+subscribe", "--as", identity, "--event-types", eventTypes, "--quiet"];

if (process.env.LARK_EVENT_DRY_RUN === "1") {
  args.push("--dry-run");
}

const command = buildCommand(cliBin, args);

const child = spawn(command.bin, command.args, {
  stdio: ["ignore", "pipe", "pipe"],
  windowsHide: true
});

let buffer = "";
let delivered = 0;

console.error(`[lark-event-bridge] subscribe ${eventTypes} as ${identity}`);
console.error(`[lark-event-bridge] forward events to ${apiUrl}`);

child.stdout.on("data", (chunk) => {
  buffer += chunk.toString("utf-8");
  const lines = buffer.split(/\r?\n/);
  buffer = lines.pop() ?? "";

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    void forwardLine(trimmed);
  }
});

child.stderr.on("data", (chunk) => {
  const text = chunk.toString("utf-8").trim();
  if (text) {
    console.error(`[lark-cli] ${text}`);
  }
});

child.on("error", (error) => {
  console.error(`[lark-event-bridge] failed to start ${cliBin}: ${error.message}`);
  process.exitCode = 1;
});

child.on("close", (code) => {
  console.error(`[lark-event-bridge] lark-cli exited with code ${code}`);
  process.exitCode = code ?? 1;
});

process.on("SIGINT", () => {
  child.kill("SIGINT");
});

process.on("SIGTERM", () => {
  child.kill("SIGTERM");
});

async function forwardLine(line) {
  let payload;
  try {
    payload = JSON.parse(line);
  } catch {
    console.error(`[lark-event-bridge] skip non-json line: ${line.slice(0, 200)}`);
    return;
  }

  try {
    const response = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-agent-pilot-source": "lark-cli-event-bridge"
      },
      body: JSON.stringify(payload)
    });
    const body = await response.text();
    delivered += 1;
    console.error(
      `[lark-event-bridge] forwarded #${delivered}: ${response.status} ${body.slice(0, 240)}`
    );
  } catch (error) {
    console.error(
      `[lark-event-bridge] forward failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

function buildCommand(bin, commandArgs) {
  if (process.platform !== "win32") {
    return { bin, args: commandArgs };
  }

  const runJs = resolveWindowsRunJs(bin);
  if (runJs) {
    return { bin: process.execPath, args: [runJs, ...commandArgs] };
  }

  return { bin, args: commandArgs };
}

function resolveWindowsRunJs(bin) {
  const wrapperDir = /[\\/]/.test(bin) ? dirname(bin.replace(/\.(cmd|ps1)$/i, "")) : undefined;
  const candidates = [
    wrapperDir ? join(wrapperDir, "node_modules", "@larksuite", "cli", "scripts", "run.js") : undefined,
    join(process.cwd(), "node_modules", "@larksuite", "cli", "scripts", "run.js"),
    process.env.APPDATA
      ? join(process.env.APPDATA, "npm", "node_modules", "@larksuite", "cli", "scripts", "run.js")
      : undefined,
    process.env.npm_config_prefix
      ? join(process.env.npm_config_prefix, "node_modules", "@larksuite", "cli", "scripts", "run.js")
      : undefined
  ];

  return candidates.find((candidate) => candidate && existsSync(candidate));
}
