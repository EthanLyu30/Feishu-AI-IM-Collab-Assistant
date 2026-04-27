import type { LarkImTriggerRequest, TaskTrigger } from "@agent-pilot/shared";

export const larkTriggerKeywords = [
  "@Agent",
  "@Agent-Pilot",
  "/agent",
  "Agent-Pilot",
  "请整理",
  "生成需求文档",
  "生成汇报",
  "生成 PPT"
];

interface ExtractedLarkTrigger {
  chatId?: string;
  messageId?: string;
  sender?: string;
  text: string;
}

export function extractLarkImTrigger(input: LarkImTriggerRequest): ExtractedLarkTrigger {
  const event = input.event as LarkEventPayload | undefined;
  const message = event?.message;
  const sender = event?.sender;

  const text =
    input.text ??
    extractText(message?.content) ??
    extractText((event as { content?: string } | undefined)?.content) ??
    "";

  return {
    chatId: input.chatId ?? message?.chat_id,
    messageId: input.messageId ?? message?.message_id,
    sender:
      input.sender ??
      sender?.sender_id?.open_id ??
      sender?.sender_id?.user_id ??
      sender?.sender_id?.union_id,
    text
  };
}

export function shouldTriggerAgent(text: string) {
  const normalized = text.trim();
  if (!normalized) return false;

  return larkTriggerKeywords.some((keyword) =>
    normalized.toLocaleLowerCase().includes(keyword.toLocaleLowerCase())
  );
}

export function sanitizeIntent(text: string) {
  return text
    .replace(/@Agent-Pilot/gi, "")
    .replace(/@Agent/gi, "")
    .replace(/\/agent/gi, "")
    .replace(/^Agent-Pilot[:：\s]*/i, "")
    .trim();
}

export function buildTaskTrigger(input: ExtractedLarkTrigger): TaskTrigger {
  return {
    source: "lark-im",
    chatId: input.chatId,
    messageId: input.messageId,
    sender: input.sender,
    rawText: input.text
  };
}

function extractText(content: string | undefined) {
  if (!content) return undefined;

  try {
    const parsed = JSON.parse(content) as { text?: string; title?: string; content?: unknown };
    if (typeof parsed.text === "string") return parsed.text;
    if (typeof parsed.title === "string") return parsed.title;
    return JSON.stringify(parsed);
  } catch {
    return content;
  }
}

interface LarkEventPayload {
  message?: {
    chat_id?: string;
    message_id?: string;
    content?: string;
  };
  sender?: {
    sender_id?: {
      open_id?: string;
      user_id?: string;
      union_id?: string;
    };
  };
}
