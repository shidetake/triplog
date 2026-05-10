import type { RawExpense } from "./types.ts";
import { isFuzzyMatch, normalizeMerchant, withinTimeWindow } from "./dedup.ts";

// auth / confirm に分かれて届く Sony 銀行の二段表記を1レコードに再統合する処理群。
// パイプラインでは:
//   1) mergeSonyAuthConfirmByApproval()  — pre-dedup。承認番号で auth + confirm を確定的にペア化
//   2) dedup()                            — その結果と receipt-email 等を通常の閾値で統合
//   3) tipMerge()                         — post-dedup。承認番号が無い旧パターン用の保険

const TIME_WINDOW_HOURS = 72;
const APPROVAL_RE = /承認番号[:：]\s*(\d+)/;

function extractApprovalNo(notes: string | undefined): string | null {
  if (!notes) return null;
  const m = notes.match(APPROVAL_RE);
  return m ? m[1]! : null;
}

/**
 * Sony 銀行の auth + confirm を承認番号で確定的にペア統合する (2-way, pre-dedup)。
 *
 * Square の "チップ別決済" のように、本来1取引が auth (ベース額) + confirm (チップ部分のみ)
 * の2回 charge に分割されるケースで、Sony 銀行は同じ承認番号を両方に振ってくる。
 * これを使えば receipt メールの有無や金額演算に依存せず、確定的にペアを同定できる。
 *
 * マージ後のレコード:
 *   - source = sony-bank-auth (時系列の起点側を維持)
 *   - amountLocal = auth + confirm
 *   - tipLocal = confirm.amountLocal
 *   - occurredAt = auth.occurredAt
 *   - merchantRaw / merchant / messageId = auth のものを引き継ぐ
 *
 * 後段の dedup() で receipt-email と通常の閾値で統合される。承認番号が片方にしか無いケースは
 * touch せずスルー（後段の tipMerge で拾う、または auth/confirm 単独行として残る）。
 */
export function mergeSonyAuthConfirmByApproval(expenses: RawExpense[]): RawExpense[] {
  const consumed = new Set<number>();
  const out: RawExpense[] = [];

  // auth インデックスを承認番号でひける map に
  const authByApproval = new Map<string, number>();
  for (let i = 0; i < expenses.length; i++) {
    const e = expenses[i]!;
    if (e.source !== "sony-bank-auth") continue;
    const ap = extractApprovalNo(e.notes);
    if (ap && !authByApproval.has(ap)) authByApproval.set(ap, i);
  }

  for (let j = 0; j < expenses.length; j++) {
    const c = expenses[j]!;
    if (c.source !== "sony-bank-confirm") continue;
    const ap = extractApprovalNo(c.notes);
    if (!ap) continue;
    const i = authByApproval.get(ap);
    if (i == null || consumed.has(i) || consumed.has(j)) continue;

    const auth = expenses[i]!;
    if (auth.currencyLocal !== c.currencyLocal) continue;
    if (auth.amountLocal == null || c.amountLocal == null) continue;
    if (!withinTimeWindow(auth.occurredAt, c.occurredAt, TIME_WINDOW_HOURS)) continue;
    // 念のためマーチャントもチェック（承認番号が万一衝突した場合の保険）。
    // Sony 銀行は表記が揺れる（"SHO" vs "SHOP &" など truncation 違い）ので fuzzy で判定。
    if (!isFuzzyMatch(normalizeMerchant(auth.merchantRaw), normalizeMerchant(c.merchantRaw))) continue;

    out.push({
      ...auth,
      amountLocal: Number((auth.amountLocal + c.amountLocal).toFixed(2)),
      amountJPY: auth.amountJPY ?? c.amountJPY ?? null,
      tipLocal: c.amountLocal,
    });
    consumed.add(i);
    consumed.add(j);
  }

  for (let k = 0; k < expenses.length; k++) {
    if (!consumed.has(k)) out.push(expenses[k]!);
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
