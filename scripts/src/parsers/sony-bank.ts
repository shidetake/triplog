import type { ParseResult, RawMessage } from "../types.ts";
import { fullWidthToHalf, normalizeMerchant } from "./util.ts";

// Common parser body for both auth and confirm. The two emails differ only in:
//  - subject ("ご利用のお知らせ" vs "ご利用金額確定のお知らせ")
//  - the date label ("カード利用日" vs "確定日")
// Both currently expose only USD ("XX.XX米ドル" or "X,XXX円"), no JPY conversion in-email.
function parseSonyBankBody(body: string): {
  amountLocal: number | null;
  currencyLocal: string;
  amountJPY: number | null;
  merchantRaw: string;
  merchant: string;
  occurredAt: string | null;
  approvalNo: string | null;
} {
  const amtMatch = body.match(/ご利用金額：\s*(-?[\d,]+(?:\.\d+)?)\s*(米ドル|円|ユーロ|英ポンド|香港ドル|シンガポールドル|台湾ドル|ウォン|豪ドル|加ドル|ＮＺドル|スイスフラン)/);
  const merchantMatch = body.match(/ご利用加盟店：\s*([^\r\n]+)/);
  const dateMatch = body.match(/(カード利用日|確定日)：\s*(\d{4})年(\d{1,2})月(\d{1,2})日/);
  const approvalMatch = body.match(/承認番号：\s*(\d+)/);

  const currencyMap: Record<string, string> = {
    米ドル: "USD",
    円: "JPY",
    ユーロ: "EUR",
    英ポンド: "GBP",
    香港ドル: "HKD",
    シンガポールドル: "SGD",
    台湾ドル: "TWD",
    ウォン: "KRW",
    豪ドル: "AUD",
    加ドル: "CAD",
    ＮＺドル: "NZD",
    スイスフラン: "CHF",
  };

  const amount = amtMatch ? Number(amtMatch[1]!.replace(/,/g, "")) : null;
  const currency = amtMatch ? currencyMap[amtMatch[2]!] ?? "USD" : "USD";
  const merchantRaw = merchantMatch ? merchantMatch[1]!.trim() : "";
  const occurredAt = dateMatch
    ? `${dateMatch[2]!}-${dateMatch[3]!.padStart(2, "0")}-${dateMatch[4]!.padStart(2, "0")}`
    : null;

  return {
    amountLocal: currency !== "JPY" ? amount : null,
    currencyLocal: currency,
    amountJPY: currency === "JPY" ? amount : null,
    merchantRaw: fullWidthToHalf(merchantRaw),
    merchant: normalizeMerchant(merchantRaw),
    occurredAt,
    approvalNo: approvalMatch ? approvalMatch[1]! : null,
  };
}

export function parseSonyBankAuth(msg: RawMessage): ParseResult {
  const r = parseSonyBankBody(msg.body);
  if (!r.amountLocal && !r.amountJPY) {
    return { ok: false, reason: "no amount in sony-bank-auth body" };
  }
  if (!r.occurredAt) {
    return { ok: false, reason: "no date in sony-bank-auth body" };
  }
  return {
    ok: true,
    expense: {
      source: "sony-bank-auth",
      messageId: msg.messageId,
      occurredAt: r.occurredAt,
      merchantRaw: r.merchantRaw,
      merchant: r.merchant,
      amountLocal: r.amountLocal,
      currencyLocal: r.currencyLocal,
      amountJPY: r.amountJPY,
      tipLocal: null,
      notes: r.approvalNo ? `承認番号:${r.approvalNo}` : undefined,
    },
  };
}

export function parseSonyBankConfirm(msg: RawMessage): ParseResult {
  const r = parseSonyBankBody(msg.body);
  if (!r.amountLocal && !r.amountJPY) {
    return { ok: false, reason: "no amount in sony-bank-confirm body" };
  }
  if (!r.occurredAt) {
    return { ok: false, reason: "no date in sony-bank-confirm body" };
  }
  return {
    ok: true,
    expense: {
      source: "sony-bank-confirm",
      messageId: msg.messageId,
      occurredAt: r.occurredAt,
      merchantRaw: r.merchantRaw,
      merchant: r.merchant,
      amountLocal: r.amountLocal,
      currencyLocal: r.currencyLocal,
      amountJPY: r.amountJPY,
      tipLocal: null,
      notes: r.approvalNo ? `承認番号:${r.approvalNo}` : undefined,
    },
  };
}
