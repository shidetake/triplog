import type { RawExpense } from "./types.ts";
import { isFuzzyMatch, normalizeMerchant, withinTimeWindow } from "./dedup.ts";

// Square / Toast 等のチップ別決済パターン:
//   - sony-bank-auth: ベース（チップ前）の額
//   - sony-bank-confirm: チップ部分のみの追加決済
//   - receipt-email: チップ込みの最終 total
// auth + confirm = receipt がきっかり成立する3つ組を検出して
// receipt 行に統合し、tipLocal に confirm 額を入れる。
//
// dedup() の前段で走らせる。3つ組として消費されたレコードは後段の dedup を通らない。
// 受信メールと額の組み合わせが偶然合致する誤検知を避けるため、許容差は厳しめ ($0.05)。

const AMOUNT_EPS = 0.05;
const TIME_WINDOW_HOURS = 72;
const RECEIPT_SOURCES = new Set(["receipt-email", "rideshare", "airline"]);

export function applySplitTipMatch(expenses: RawExpense[]): RawExpense[] {
  const consumed = new Set<number>();
  const out: RawExpense[] = [];

  for (let r = 0; r < expenses.length; r++) {
    if (consumed.has(r)) continue;
    const receipt = expenses[r]!;
    if (!RECEIPT_SOURCES.has(receipt.source)) continue;
    if (receipt.amountLocal == null) continue;

    const rMerchant = normalizeMerchant(receipt.merchantRaw);
    let foundAuth = -1;
    let foundConfirm = -1;

    outer: for (let a = 0; a < expenses.length; a++) {
      if (consumed.has(a) || a === r) continue;
      const auth = expenses[a]!;
      if (auth.source !== "sony-bank-auth" || auth.amountLocal == null) continue;
      if (auth.currencyLocal !== receipt.currencyLocal) continue;
      if (!isFuzzyMatch(normalizeMerchant(auth.merchantRaw), rMerchant)) continue;
      if (!withinTimeWindow(auth.occurredAt, receipt.occurredAt, TIME_WINDOW_HOURS)) continue;

      for (let c = 0; c < expenses.length; c++) {
        if (consumed.has(c) || c === r || c === a) continue;
        const confirm = expenses[c]!;
        if (confirm.source !== "sony-bank-confirm" || confirm.amountLocal == null) continue;
        if (confirm.currencyLocal !== receipt.currencyLocal) continue;
        if (!isFuzzyMatch(normalizeMerchant(confirm.merchantRaw), rMerchant)) continue;
        if (!withinTimeWindow(confirm.occurredAt, receipt.occurredAt, TIME_WINDOW_HOURS)) continue;

        const sum = auth.amountLocal + confirm.amountLocal;
        if (Math.abs(sum - receipt.amountLocal) <= AMOUNT_EPS) {
          foundAuth = a;
          foundConfirm = c;
          break outer;
        }
      }
    }

    if (foundAuth >= 0 && foundConfirm >= 0) {
      const auth = expenses[foundAuth]!;
      const confirm = expenses[foundConfirm]!;
      out.push({
        ...receipt,
        occurredAt: auth.occurredAt, // 利用日 = Sony 銀行のカード利用日（速報側）
        tipLocal: confirm.amountLocal,
        amountJPY: receipt.amountJPY ?? confirm.amountJPY ?? auth.amountJPY ?? null,
      });
      consumed.add(r);
      consumed.add(foundAuth);
      consumed.add(foundConfirm);
    } else {
      out.push(receipt);
      consumed.add(r);
    }
  }

  for (let i = 0; i < expenses.length; i++) {
    if (!consumed.has(i)) out.push(expenses[i]!);
  }
  return out;
}
