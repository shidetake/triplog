import type { RawMessage, Source } from "../types.ts";

export type ParserKind =
  | "sony-bank-auth"
  | "sony-bank-confirm"
  | "toast"
  | "square"
  | "clover"
  | "uber"
  | "delta"
  | "marriott-folio"
  | "ziosk"
  | "uniqlo"
  | "alo-yoga"
  | "agent"; // fallback: needs LLM extraction

export function detectSource(msg: RawMessage): ParserKind {
  const from = msg.from.toLowerCase();
  const subject = msg.subject;

  // Sony bank: same sender, distinguish via subject
  if (from.includes("banking@sonybank.jp")) {
    if (subject.includes("ご利用金額確定")) return "sony-bank-confirm";
    if (subject.includes("ご利用のお知らせ")) return "sony-bank-auth";
  }

  if (from.includes("noreply@uber.com")) return "uber";
  if (from.includes("deltaairlines@t.delta.com") || from.includes("delta.com")) return "delta";
  if (from.includes("donotreply@marriott.com") || from.includes("@marriott.com")) {
    // Folio email comes with PDF attachment
    const hasPdf = (msg.attachments ?? []).some(
      (a) => /\.pdf$/i.test(a.filename) || a.mimeType.includes("pdf") || a.mimeType === "application/octet-stream",
    );
    if (hasPdf) return "marriott-folio";
    return "agent";
  }
  if (from.includes("toasttab.com") || from.includes("toast-restaurants.com")) return "toast";
  if (from.includes("messaging.squareup.com")) return "square";
  if (from.includes("@clover.com")) return "clover";
  if (from.includes("ziosk.com")) return "ziosk";
  if (from.includes("ml.store.uniqlo.com")) return "uniqlo";
  if (from.includes("@aloyoga.com")) return "alo-yoga";

  return "agent";
}

export const PARSER_TO_SOURCE: Record<ParserKind, Source> = {
  "sony-bank-auth": "sony-bank-auth",
  "sony-bank-confirm": "sony-bank-confirm",
  toast: "receipt-email",
  square: "receipt-email",
  clover: "receipt-email",
  uber: "rideshare",
  delta: "airline",
  "marriott-folio": "hotel-folio",
  ziosk: "receipt-email",
  uniqlo: "receipt-email",
  "alo-yoga": "receipt-email",
  agent: "other",
};
