import type { ParseResult, RawMessage } from "../types.ts";
import { findFirstUsd, normalizeMerchant, parseEnDateTime } from "./util.ts";

// Clover (app@clover.com) のレシートメール本文は要点だけ:
//   <merchant>
//   <address>
//   <phone>
//   May 03, 2026 • 12:27 PM   ← `•` は省かれることも (NALU 形式)
//   $14.40
//   full transaction receipt   ← HTML 上の SendGrid URL は stripHtml で消える
//   https://<merchantのhomepage>
// 品目は本文には無い。SKILL.md §3.6 の Clover enrichment が
// SendGrid → clover.com/p/<id> を WebFetch して `linkedContent` に格納する。

// "Mon DD, YYYY [• ]HH:MM AM/PM" — bullet 有無の両方を吸収するため
// 年と時刻のあいだは [^\d]+ で繋ぐ
const DATETIME_RE = /([A-Za-z]{3,9})\s+(\d{1,2}),\s+(\d{4})[^\d]+(\d{1,2}:\d{2}\s*[AP]M)/i;

// linkedContent から品目を抽出する。WebFetch の prompt 次第で形が揺れるので
// markdown bullet (`- `, `* `) と "<name>: $<price>" / "<qty> <name> $<price>" を吸収。
const SKIP_LINE_RE =
  /^(subtotal|tax|tip|total|discount|gratuity|auto gratuity|sales tax|service charge|amount paid|change|payment|tendered|cash|visa|mastercard|amex|debit|change due|balance|tip:|gift|rewards|points|order|cashier|customer|receipt|line items|financial|payment method|merchant|date|time)\b/i;

const ITEM_RE = /^(?:\d+\s+)?(.+?)\s*[:\s]\s*\$\s?(-?[\d,]+\.\d{2})/;

function extractItemsFromLinked(text: string): string[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*[-*•]\s+/, "").trim())
    .filter(Boolean);
  const items: string[] = [];
  for (const ln of lines) {
    if (SKIP_LINE_RE.test(ln)) continue;
    // markdown 強調 (**text**) は素朴に剥がす
    const cleaned = ln.replace(/\*\*/g, "");
    const m = cleaned.match(ITEM_RE);
    if (!m) continue;
    const name = m[1]!.replace(/\s+/g, " ").trim();
    if (!name || SKIP_LINE_RE.test(name)) continue;
    items.push(name);
  }
  return items;
}

export function parseClover(msg: RawMessage): ParseResult {
  // Merchant from subject "Your receipt from <merchant>"
  const subjMatch = msg.subject.match(/Your receipt from\s+(.+?)\s*$/i);
  const merchantRaw = subjMatch ? subjMatch[1]!.trim() : msg.subject.trim();

  const dt = msg.body.match(DATETIME_RE);
  if (!dt) return { ok: false, reason: "clover: no date/time" };
  const occurredAt = parseEnDateTime(`${dt[1]} ${dt[2]}, ${dt[3]} at ${dt[4]}`);
  if (!occurredAt) return { ok: false, reason: "clover: bad date/time" };

  const total = findFirstUsd(msg.body);
  if (total == null) return { ok: false, reason: "clover: no amount" };

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
      merchantRaw,
      merchant: normalizeMerchant(merchantRaw),
      amountLocal: total,
      currencyLocal: "USD",
      amountJPY: null,
      tipLocal: null,
      detail,
    },
  };
}
