import type { RawExpense } from "./types.ts";
import { normalizeMerchant, withinTimeWindow } from "./dedup.ts";

/**
 * オーソリ→確定の差分をチップとして1レコードに統合する。
 * dedup() を通した後の入力を想定。
 *
 * 同一マーチャント・同日の中で、確定額 > オーソリ額 のペアがあれば、
 * 差分を tipLocal に保持し、確定額をベースの amountLocal とする。
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
      if (!withinTimeWindow(a.occurredAt, b.occurredAt, 72)) continue;
      if (a.amountLocal == null || b.amountLocal == null) continue;

      // a と b のどちらかが auth、もう片方が confirm の場合に統合
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
