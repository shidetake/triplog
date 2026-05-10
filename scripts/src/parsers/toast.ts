import type { ParseResult, RawMessage } from "../types.ts";
import { normalizeMerchant, parseUsDateTime, stripHtml } from "./util.ts";

// Toast HTML emails have rows like:
//   <tr><td>Subtotal</td><td ...>$20.00</td></tr>
// We extract by collapsing whitespace and matching label/value pairs.

function extractKv(text: string, label: string): string | null {
  const re = new RegExp(`${label}\\s+\\$?\\s*(-?[\\d,]+(?:\\.\\d+)?)`, "i");
  const m = text.match(re);
  return m ? m[1]!.replace(/,/g, "") : null;
}

const FOOTER_RE = /Powered by Toast|toasttab\.com|Tell us how we did/i;

export function parseToast(msg: RawMessage): ParseResult {
  const text = stripHtml(msg.body);

  const total = extractKv(text, "Total");
  const subtotal = extractKv(text, "Subtotal");
  const tax = extractKv(text, "Tax");
  const tip = extractKv(text, "Tip");

  if (!total) return { ok: false, reason: "toast: no total" };

  // Merchant: subject "Receipt for Order #N at <merchant>"
  const subjectMatch = msg.subject.match(/at\s+(.+?)\s*$/);
  let merchantRaw = subjectMatch ? subjectMatch[1]!.trim() : msg.subject;
  // Remove leading "Tell us how we did! Receipt for Order #N at "
  merchantRaw = merchantRaw.replace(/^(Tell us how we did!\s*)?Receipt for Order #\d+ at\s+/i, "");

  // Items: lines like "1 Shine a Light 16oz 4pack ... $20.00"
  // We collect lines that look like items between "Ordered:" and "Subtotal"
  const itemMatch = text.match(/Ordered:\s*[\d\/\s:APM]+(.+?)Subtotal/i);
  let items: string[] = [];
  if (itemMatch) {
    const seg = itemMatch[1]!;
    // Items appear as "<qty> <name> $price"
    const itemRe = /(\d+)\s+([^$]+?)\s+\$(-?[\d,]+\.\d{2})/g;
    let m;
    while ((m = itemRe.exec(seg)) !== null) {
      items.push(`${m[2]!.trim()}`);
    }
  }

  // Date: "Ordered: 4/28/26 5:16 PM"
  const dtMatch = text.match(/Ordered:\s*(\d{1,2}\/\d{1,2}\/\d{2,4}\s+\d{1,2}:\d{2}\s*[AP]M)/i);
  const occurredAt = dtMatch ? parseUsDateTime(dtMatch[1]!) : null;
  if (!occurredAt) return { ok: false, reason: "toast: no ordered date/time" };

  const totalNum = Number(total);
  const tipNum = tip ? Number(tip) : null;

  let detail = items.join(", ");
  if (tipNum !== null && subtotal) {
    const subtotalNum = Number(subtotal);
    const pct = subtotalNum > 0 ? Math.round((tipNum / subtotalNum) * 100) : null;
    if (pct !== null) {
      detail = detail
        ? `${detail}（チップ$${tipNum.toFixed(2)} / ${pct}%）`
        : `（チップ$${tipNum.toFixed(2)} / ${pct}%）`;
    }
  }

  return {
    ok: true,
    expense: {
      source: "receipt-email",
      messageId: msg.messageId,
      occurredAt,
      merchantRaw,
      merchant: normalizeMerchant(merchantRaw),
      amountLocal: totalNum,
      currencyLocal: "USD",
      amountJPY: null,
      tipLocal: tipNum,
      detail: detail || undefined,
    },
  };
}
