import type { NormalizedExpense, RawExpense, TripConfig } from "./types.ts";

/**
 * 1レコードに対して JPY を確定する（確定情報のみ）。
 *
 * 確定パターン:
 *   1. amountJPY が既に取れている（Sony 銀行確定の JPY 額がある稀なケース）
 *   2. JPY 建てレコード（amountJPY = amountLocal）
 * それ以外は **null** を返す。仮レートでの概算は行わない（user feedback: 確定情報のみ書く）。
 */
function resolveJpy(expense: RawExpense): number | null {
  if (expense.amountJPY != null) return Math.round(expense.amountJPY);
  if (expense.currencyLocal === "JPY" && expense.amountLocal != null) {
    return Math.round(expense.amountLocal);
  }
  return null;
}

export function applyFx(
  expenses: RawExpense[],
  _config: TripConfig,
): NormalizedExpense[] {
  return expenses.map((e) => {
    if (!e.category) {
      throw new Error(`category missing for ${e.merchant} (${e.messageId})`);
    }
    return {
      ...e,
      category: e.category,
      amountJPY: resolveJpy(e),
      excluded: false,
    };
  });
}
