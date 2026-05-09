import type { NormalizedExpense, RawExpense, TripConfig } from "./types.ts";

export type FxResolution = {
  amountJPY: number;
  fxRate: number | "BANK";
};

/**
 * 1レコードに対してJPY額とレート列の値を確定する。
 *
 * 優先順位:
 *   1. amountJPY が既に取れている（Sony銀行確定）→ rate="BANK"
 *   2. JPY建てレコード → rate=1, amountJPY=amountLocal
 *   3. config.fxRateOverride があればそれで換算
 *   4. それ以外は throw（呼び出し側でユーザー判断）
 */
export function resolveFx(
  expense: RawExpense,
  config: TripConfig,
): FxResolution {
  if (expense.amountJPY != null) {
    return { amountJPY: Math.round(expense.amountJPY), fxRate: "BANK" };
  }
  if (expense.currencyLocal === "JPY" && expense.amountLocal != null) {
    return { amountJPY: Math.round(expense.amountLocal), fxRate: 1 };
  }
  if (expense.amountLocal != null && config.fxRateOverride != null) {
    return {
      amountJPY: Math.round(expense.amountLocal * config.fxRateOverride),
      fxRate: config.fxRateOverride,
    };
  }
  throw new Error(
    `cannot resolve FX for ${expense.merchant} (${expense.currencyLocal} ${expense.amountLocal})`,
  );
}

export function applyFx(
  expenses: RawExpense[],
  config: TripConfig,
): NormalizedExpense[] {
  return expenses.map((e) => {
    if (!e.category) {
      throw new Error(`category missing for ${e.merchant} (${e.messageId})`);
    }
    const fx = resolveFx(e, config);
    return {
      ...e,
      category: e.category,
      amountJPY: fx.amountJPY,
      fxRate: fx.fxRate,
      excluded: false,
    };
  });
}
