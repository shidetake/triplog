import type { RawExpense } from "./types.ts";
import { isFuzzyMatch, normalizeMerchant, withinTimeWindow } from "./dedup.ts";

// auth / confirm に分かれて届く Sony 銀行の二段表記を1レコードに再統合する処理群。
// パイプラインでは:
//   1) mergeSquareSplitTip()  — pre-dedup。Square のチップ別決済 (auth + confirm = receipt) を3点統合
//   2) dedup()                — 残りを通常の重複判定にかける
//   3) tipMerge()             — post-dedup。確定額 > オーソリ額 のペアの差分を tip 化（旧 Sony 銀行モデル）

const AMOUNT_EPS = 0.05;
const TIME_WINDOW_HOURS = 72;
const RECEIPT_SOURCES = new Set(["receipt-email", "rideshare", "airline"]);

/**
 * Square のチップ別決済パターンの再統合 (3-way)。
 *
 * Square は店内決済時に「ベース額」、客がチップを後で追加した時に「チップ額」を別決済として走らせる。
 * Sony 銀行はそれぞれ別メールで届くため:
 *   - sony-bank-auth: ベース（チップ前）の額
 *   - sony-bank-confirm: チップ部分のみ
 *   - receipt-email: チップ込みの最終 total
 * `auth.amount + confirm.amount = receipt.amount`（許容 ±$0.05）が成立する3点セットを検出して
 * receipt 行に統合し、`tipLocal` に confirm 額を入れる。
 *
 * dedup の前段で実行する。3つ組として消費されたレコードは後段の dedup を通らない。
 */
export function mergeSquareSplitTip(expenses: RawExpense[]): RawExpense[] {
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

/**
 * 旧来モデルの auth + confirm 統合 (2-way)。
 *
 * 同一マーチャント・同日の中で、確定額 > オーソリ額 のペアがあれば、
 * 差分を tipLocal に保持し、確定額をベースの amountLocal とする。
 *
 * dedup() を通した後の入力を想定。
 * mergeSquareSplitTip では拾えなかった Sony 銀行ペア（receipt メール無しのケース等）の保険。
 */
export function tipMerge(expenses: RawExpense[]): RawExpense[] {
  const result: RawExpense[] = [];
  const consumed = new Set<number>();

  for (let i = 0; i < expenses.length; i++) {
    if (consumed.has(i)) continue;
    const a = expenses[i]!;
    let merged = { ...a };

    for (let j = i + 1; j < expenses.length; j++) {
      if (consumed.has(j)) continue;
      const b = expenses[j]!;
      if (a.currencyLocal !== b.currencyLocal) continue;
      if (normalizeMerchant(a.merchantRaw) !== normalizeMerchant(b.merchantRaw))
        continue;
      if (!withinTimeWindow(a.occurredAt, b.occurredAt, TIME_WINDOW_HOURS)) continue;
      if (a.amountLocal == null || b.amountLocal == null) continue;

      const isAuthConfirmPair =
        (a.source === "sony-bank-auth" && b.source === "sony-bank-confirm") ||
        (a.source === "sony-bank-confirm" && b.source === "sony-bank-auth");

      if (!isAuthConfirmPair) continue;

      const auth = a.source === "sony-bank-auth" ? a : b;
      const confirm = a.source === "sony-bank-confirm" ? a : b;

      const diff = (confirm.amountLocal ?? 0) - (auth.amountLocal ?? 0);
      merged = {
        ...confirm,
        occurredAt: auth.occurredAt, // 利用日は速報側
        amountLocal: confirm.amountLocal,
        tipLocal: diff > 0 ? Number(diff.toFixed(2)) : (merged.tipLocal ?? null),
      };
      consumed.add(j);
      break;
    }

    consumed.add(i);
    result.push(merged);
  }

  return result;
}
