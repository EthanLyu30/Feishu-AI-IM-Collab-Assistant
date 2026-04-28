import type { Request } from "express";
import type { LarkImTriggerRequest } from "@agent-pilot/shared";
import { config } from "../env";
import type { ExtractedLarkTrigger } from "../triggers/larkImTrigger";

interface GuardDecision {
  allowed: boolean;
  reason?: string;
  status?: number;
}

export function validateLarkVerifyToken(
  req: Request,
  input: LarkImTriggerRequest
): GuardDecision {
  if (!config.larkEventVerifyToken) {
    return { allowed: true };
  }

  const token = readVerifyToken(req, input);
  if (token === config.larkEventVerifyToken) {
    return { allowed: true };
  }

  return {
    allowed: false,
    reason: "invalid lark verify token",
    status: 401
  };
}

export function validateLarkMessage(extracted: ExtractedLarkTrigger): GuardDecision {
  if (config.larkAllowedChatIds.length > 0) {
    if (!extracted.chatId || !config.larkAllowedChatIds.includes(extracted.chatId)) {
      return {
        allowed: false,
        reason: "chat is not allowed"
      };
    }
  }

  if (isBotSelfMessage(extracted)) {
    return {
      allowed: false,
      reason: "bot self message ignored"
    };
  }

  return { allowed: true };
}

function readVerifyToken(req: Request, input: LarkImTriggerRequest) {
  const bodyToken = (input as { token?: string; verification_token?: string }).token;
  const bodyVerificationToken = (input as { token?: string; verification_token?: string })
    .verification_token;

  return (
    bodyToken ??
    bodyVerificationToken ??
    req.header("x-lark-token") ??
    req.header("x-lark-request-token") ??
    req.header("x-lark-verification-token")
  );
}

function isBotSelfMessage(extracted: ExtractedLarkTrigger) {
  if (extracted.senderType && ["app", "bot"].includes(extracted.senderType.toLocaleLowerCase())) {
    return true;
  }

  return Boolean(
    extracted.sender &&
      (extracted.sender === config.larkBotOpenId || extracted.sender === config.larkBotUserId)
  );
}
