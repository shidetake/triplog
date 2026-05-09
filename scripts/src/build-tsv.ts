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

export type SheetRow = [
  string, // B 日付
  string, // C カテゴリ
  string, // D 利用先
  string, // E 詳細
  number, // F 現地価格
  number | string, // G レート
  number, // H 円
  string, // I 計算対象外
];

export function toSheetRows(expenses: NormalizedExpense[]): SheetRow[] {
  const sorted = sortExpenses(expenses);
  return sorted.map((e) => [
    formatDate(e.occurredAt),
    e.category,
    e.merchant,
    e.detail ?? "",
    e.amountLocal ?? 0,
    e.fxRate,
    e.amountJPY,
    e.excluded ? "TRUE" : "FALSE",
  ]);
}

export function toTsv(expenses: NormalizedExpense[]): string {
  const rows = toSheetRows(expenses);
  return rows
    .map((row) => row.map((cell) => String(cell)).join("\t"))
    .join("\n");
}

export function summarizeByCategory(
  expenses: NormalizedExpense[],
): Map<string, { count: number; jpy: number }> {
  const map = new Map<string, { count: number; jpy: number }>();
  for (const e of expenses) {
    const prev = map.get(e.category) ?? { count: 0, jpy: 0 };
    map.set(e.category, {
      count: prev.count + 1,
      jpy: prev.jpy + (e.excluded ? 0 : e.amountJPY),
    });
  }
  return map;
}
