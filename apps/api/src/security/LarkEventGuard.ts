import { createHash, timingSafeEqual } from "node:crypto";
import type { Request } from "express";
import type { LarkImTriggerRequest } from "@agent-pilot/shared";
import { config } from "../env";
import type { ExtractedLarkTrigger } from "../triggers/larkImTrigger";

interface GuardDecision {
  allowed: boolean;
  reason?: string;
  status?: number;
}

export interface RawBodyRequest extends Request {
  rawBody?: Buffer;
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

export function validateLarkSignature(
  req: RawBodyRequest,
  input: LarkImTriggerRequest
): GuardDecision {
  if (!config.larkEventEncryptKey) {
    return { allowed: true };
  }

  const signature = req.header("x-lark-signature");
  const timestamp = req.header("x-lark-request-timestamp");
  const nonce = req.header("x-lark-request-nonce");

  // Feishu URL verification can arrive without signature headers. Token verification still protects it.
  if (input.challenge && !signature && !timestamp && !nonce) {
    return { allowed: true };
  }

  if (!signature || !timestamp || !nonce || !req.rawBody) {
    return {
      allowed: false,
      reason: "missing lark signature headers",
      status: 401
    };
  }

  const expected = calculateLarkSignature({
    timestamp,
    nonce,
    encryptKey: config.larkEventEncryptKey,
    rawBody: req.rawBody
  });

  if (safeEqualHex(signature, expected)) {
    return { allowed: true };
  }

  return {
    allowed: false,
    reason: "invalid lark signature",
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

export function calculateLarkSignature(input: {
  timestamp: string;
  nonce: string;
  encryptKey: string;
  rawBody: Buffer | string;
}) {
  const bodyBuffer = Buffer.isBuffer(input.rawBody)
    ? input.rawBody
    : Buffer.from(input.rawBody, "utf-8");
  const prefix = Buffer.from(`${input.timestamp}${input.nonce}${input.encryptKey}`, "utf-8");
  return createHash("sha256").update(Buffer.concat([prefix, bodyBuffer])).digest("hex");
}

function readVerifyToken(req: Request, input: LarkImTriggerRequest) {
  const bodyToken = (input as { token?: string; verification_token?: string }).token;
  const bodyVerificationToken = (input as { token?: string; verification_token?: string })
    .verification_token;
  const headerToken = (input as { header?: { token?: string } }).header?.token;

  return (
    bodyToken ??
    bodyVerificationToken ??
    headerToken ??
    req.header("x-lark-token") ??
    req.header("x-lark-request-token") ??
    req.header("x-lark-verification-token")
  );
}

function safeEqualHex(actual: string, expected: string) {
  const normalizedActual = actual.trim().toLocaleLowerCase();
  const normalizedExpected = expected.trim().toLocaleLowerCase();

  if (normalizedActual.length !== normalizedExpected.length) {
    return false;
  }

  return timingSafeEqual(Buffer.from(normalizedActual, "hex"), Buffer.from(normalizedExpected, "hex"));
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
