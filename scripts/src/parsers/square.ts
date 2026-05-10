import type { ParseResult, RawMessage } from "../types.ts";
import { normalizeMerchant, parseEnDateTime } from "./util.ts";

// Square email body is a single sentence:
//   "You paid $29.65 with your Visa ending in 1048 to Howzit Brewing on Apr 30 2026 at 5:58 PM."
// Subject: "Receipt from <merchant> #<code>"

const PAID_RE = /You paid \$\s?(-?[\d,]+(?:\.\d{2})?)\s+with your\s+\S+\s+ending in\s+\d+\s+to\s+(.+?)\s+on\s+([A-Za-z]{3,9}\s+\d{1,2},?\s+\d{4})\s+at\s+(\d{1,2}:\d{2}\s*[AP]M)/i;

export function parseSquare(msg: RawMessage): ParseResult {
  const m = msg.body.match(PAID_RE);
  if (!m) return { ok: false, reason: "square: no paid sentence" };
  const amt = m[1]!;
  const merchantRaw = m[2]!;
  const dateStr = m[3]!;
  const timeStr = m[4]!;
  const occurredAt = parseEnDateTime(`${dateStr} at ${timeStr}`);
  if (!occurredAt) return { ok: false, reason: "square: bad date/time" };
  return {
    ok: true,
    expense: {
      source: "receipt-email",
      messageId: msg.messageId,
      occurredAt,
      merchantRaw: merchantRaw.trim(),
      merchant: normalizeMerchant(merchantRaw),
      amountLocal: Number(amt.replace(/,/g, "")),
      currencyLocal: "USD",
      amountJPY: null,
      tipLocal: null, // square email lacks tip breakdown
      notes: "tip/items not in email body",
    },
  };
}
