import { CATEGORY_ORDER, type NormalizedExpense } from "./types.ts";

function formatDate(iso: string): string {
  // "2026-04-28T..." or "2026-04-28" → "2026/04/28"
  const datePart = iso.slice(0, 10);
  return datePart.replace(/-/g, "/");
}

function compareExpenses(a: NormalizedExpense, b: NormalizedExpense): number {
  const dateA = a.occurredAt.slice(0, 10);
  const dateB = b.occurredAt.slice(0, 10);
  if (dateA !== dateB) return dateA < dateB ? -1 : 1;

  // 時刻あり優先 / 同日内は時刻昇順
  const timeA = a.occurredAt.length > 10 ? a.occurredAt : "9999";
  const timeB = b.occurredAt.length > 10 ? b.occurredAt : "9999";
  if (timeA !== timeB) return timeA < timeB ? -1 : 1;

  const catA = CATEGORY_ORDER.indexOf(a.category);
  const catB = CATEGORY_ORDER.indexOf(b.category);
  return catA - catB;
}

export function sortExpenses(expenses: NormalizedExpense[]): NormalizedExpense[] {
  return [...expenses].sort(compareExpenses);
}

// 8 列のうち G（レート）はシートの formula が auto 計算するので常に空。
// F/H は確定情報のみ書く（仮レートで JPY 概算しない）。
//   - JPY ネイティブ行: F = 空、H = 円額
//   - 外貨行 (USD 等): F = 現地額、H = 確定 JPY が無ければ空
export type SheetRow = [
  string,            // B 日付
  string,            // C カテゴリ
  string,            // D 利用先
  string,            // E 詳細
  number | "",       // F 現地価格（JPY 行は空）
  "",                // G レート（常に空）
  number | "",       // H 円（未確定なら空）
  string,            // I 計算対象外
];

export function toSheetRows(expenses: NormalizedExpense[]): SheetRow[] {
  const sorted = sortExpenses(expenses);
  return sorted.map((e) => {
    const isJpy = e.currencyLocal === "JPY";
    return [
      formatDate(e.occurredAt),
      e.category,
      e.merchant,
      e.detail ?? "",
      isJpy ? "" : (e.amountLocal ?? ""),
      "",
      e.amountJPY ?? "",
      e.excluded ? "TRUE" : "FALSE",
    ];
  });
}

export function toTsv(expenses: NormalizedExpense[]): string {
  const rows = toSheetRows(expenses);
  return rows
    .map((row) => row.map((cell) => String(cell)).join("\t"))
    .join("\n");
}

export type CategorySummary = {
  count: number;
  jpyConfirmed: number;
  jpyConfirmedRows: number;
  jpyPendingRows: number;
};

export function summarizeByCategory(
  expenses: NormalizedExpense[],
): Map<string, CategorySummary> {
  const map = new Map<string, CategorySummary>();
  for (const e of expenses) {
    const prev =
      map.get(e.category) ??
      { count: 0, jpyConfirmed: 0, jpyConfirmedRows: 0, jpyPendingRows: 0 };
    const next: CategorySummary = {
      count: prev.count + 1,
      jpyConfirmed: prev.jpyConfirmed,
      jpyConfirmedRows: prev.jpyConfirmedRows,
      jpyPendingRows: prev.jpyPendingRows,
    };
    if (e.amountJPY != null && !e.excluded) {
      next.jpyConfirmed += e.amountJPY;
      next.jpyConfirmedRows += 1;
    } else if (e.amountJPY == null) {
      next.jpyPendingRows += 1;
    }
    map.set(e.category, next);
  }
  return map;
}
