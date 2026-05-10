import type { ParseResult, RawMessage } from "../types.ts";
import { normalizeMerchant, parseUsDateTime, stripHtml } from "./util.ts";

// Toast HTML / plain-text emails:
//   Ordered: 4/28/26 5:16 PM
//
//   1 Shine a Light 16oz 4pack $20.00
//
//   Subtotal $20.00
//   Tax $0.94
//   HI 5 Can 4Pack Tax $0.24
//   Tip $4.00
//   Total $25.18

// `\b` は "Subtotal" 内の "Total" にマッチしないようにするため必須。
function extractAmount(text: string, label: string): number | null {
  const re = new RegExp(`\\b${label}\\s+\\$?\\s*(-?[\\d,]+(?:\\.\\d+)?)`, "i");
  const m = text.match(re);
  return m ? Number(m[1]!.replace(/,/g, "")) : null;
}

export function parseToast(msg: RawMessage): ParseResult {
  const text = stripHtml(msg.body);

  const total = extractAmount(text, "Total");
  if (total == null) return { ok: false, reason: "toast: no total" };

  // Merchant from subject "Receipt for Order #N at <merchant>"
  const subjectMatch = msg.subject.match(/at\s+(.+?)\s*$/);
  let merchantRaw = subjectMatch ? subjectMatch[1]!.trim() : msg.subject;
  merchantRaw = merchantRaw.replace(/^(Tell us how we did!\s*)?Receipt for Order #\d+ at\s+/i, "");

  // Items section: "Ordered: <m/d/y h:mm AM/PM>" の直後から "Subtotal" まで。
  // stripHtml() が改行を space に潰すため、行アンカーは使わず lazy match で並べる。
  // 日付フォーマットを明示してアンカーすることで先頭アイテムの数量が greedy に食われるのを防ぐ。
  const sectionRe = /Ordered:\s*\d{1,2}\/\d{1,2}\/\d{2,4}\s+\d{1,2}:\d{2}\s*[AP]M\s+([\s\S]*?)\s+Subtotal\b/i;
  const sectionMatch = text.match(sectionRe);
  let items: string[] = [];
  if (sectionMatch) {
    const seg = sectionMatch[1]!;
    // 数量プレフィックス (1, 2, ...) はオプション。商品名のみ取り出す。
    // 先頭の \s* で前アイテム末尾のスペースを食い、qty を後続グループに正しく回す。
    const itemRe = /\s*(?:\d+\s+)?([^$]+?)\s+\$(-?[\d,]+\.\d{2})/g;
    let m: RegExpExecArray | null;
    while ((m = itemRe.exec(seg)) !== null) {
      items.push(m[1]!.trim());
    }
  }

  // Date
  const dtMatch = text.match(/Ordered:\s*(\d{1,2}\/\d{1,2}\/\d{2,4}\s+\d{1,2}:\d{2}\s*[AP]M)/i);
  const occurredAt = dtMatch ? parseUsDateTime(dtMatch[1]!) : null;
  if (!occurredAt) return { ok: false, reason: "toast: no ordered date/time" };

  const tip = extractAmount(text, "Tip");

  // Detail は購入品名のみ（チップ・タックスは含めない）。
  const detail = items.join(", ") || undefined;

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
      tipLocal: tip ?? null,
      detail,
    },
  };
}
