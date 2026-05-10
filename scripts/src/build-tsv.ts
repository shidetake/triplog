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

// 8 列のうち G（レート）は シートの formula が自動計算するので、書き込み時は常に空。
// JPY 通貨の行は F（現地価格）も空にして H（円）にだけ金額を入れる
// （シート側の `=IF(ISBLANK($F),"",$H/$F)` 仕様で G が空のまま保たれる）。
export type SheetRow = [
  string,           // B 日付
  string,           // C カテゴリ
  string,           // D 利用先
  string,           // E 詳細
  number | "",      // F 現地価格（JPY 行は空）
  "",               // G レート（常に空; シートの formula が auto 計算）
  number,           // H 円
  string,           // I 計算対象外
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
      isJpy ? "" : (e.amountLocal ?? 0),
      "",
      e.amountJPY,
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
