import type { ParseResult, RawMessage } from "../types.ts";
import { normalizeMerchant, parseEnDateTime } from "./util.ts";

// Square email body は1文のみ:
//   "You paid $29.65 with your Visa ending in 1048 to Howzit Brewing on Apr 30 2026 at 5:58 PM."
// 詳細（明細）は本文には無く、本文中の `https://squareup.com/r/<hash>` を WebFetch して
// `RawMessage.linkedContent` に格納してから extract を回す。

const PAID_RE = /You paid \$\s?(-?[\d,]+(?:\.\d{2})?)\s+with your\s+\S+\s+ending in\s+\d+\s+to\s+(.+?)\s+on\s+([A-Za-z]{3,9}\s+\d{1,2},?\s+\d{4})\s+at\s+(\d{1,2}:\d{2}\s*[AP]M)/i;

// linkedContent から品名行を抽出する。Square full-receipt のテキスト形は概ね:
//   <qty>  <name>      $<price>
// または "<name>\n<modifier>\n$<price>"。
// ノイズ語（Subtotal/Tax/Tip/Total/Discount/Auto Gratuity 等）は除外。
const SKIP_LINE_RE = /^(subtotal|tax|tip|total|discount|gratuity|auto gratuity|sales tax|service charge|amount paid|change|payment|tendered|cash|visa|mastercard|amex|debit|change due|balance|tip:|gift|rewards|points)\b/i;

function extractItemsFromLinked(text: string): string[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const items: string[] = [];
  // 1) "<qty>  <name>  $<price>" 形式（同一行に金額がある）
  const sameLineRe = /^(\d+)\s+(.+?)\s+\$\s?(-?[\d,]+\.\d{2})\s*$/;
  // 2) "<qty> <name>" + 別行で "$<price>" のパターンも吸収
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i]!;
    if (SKIP_LINE_RE.test(ln)) continue;
    const m = ln.match(sameLineRe);
    if (m) {
      const name = m[2]!.replace(/\s+/g, " ").trim();
      if (name && !SKIP_LINE_RE.test(name)) items.push(name);
    }
  }
  return items;
}

export function parseSquare(msg: RawMessage): ParseResult {
  const m = msg.body.match(PAID_RE);
  if (!m) return { ok: false, reason: "square: no paid sentence" };
  const amt = m[1]!;
  const merchantRaw = m[2]!;
  const dateStr = m[3]!;
  const timeStr = m[4]!;
  const occurredAt = parseEnDateTime(`${dateStr} at ${timeStr}`);
  if (!occurredAt) return { ok: false, reason: "square: bad date/time" };

  let detail: string | undefined;
  if (msg.linkedContent) {
    const items = extractItemsFromLinked(msg.linkedContent);
    if (items.length) detail = items.join(", ");
  }

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
      tipLocal: null,
      detail,
    },
  };
}
