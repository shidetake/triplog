import { CATEGORY_ORDER, type NormalizedExpense } from "./types.ts";

function formatDate(iso: string): string {
  // "2026-04-28T..." or "2026-04-28" → "2026/04/28"
  const datePart = iso.slice(0, 10);
  return datePart.replace(/-/g, "/");
}

// sortKey が occurredAt の日付から ±2日以内なら信頼する。
// 例: HONOLULU COOKIE — occurredAt=2026-05-04T10:58 (HST), sortKey=2026-05-04T21:03Z → 0日差 ✓ 採用
// 例: Hawaii 午後 — occurredAt=2026-04-28T17:21 (HST), sortKey=2026-04-29T03:21Z → 1日差 (UTC越境) ✓ 採用
// 例: Delta (事前購入) — occurredAt=2026-05-04, sortKey=2025-11-28T... → ~5ヶ月差 ✗ fallback (occurredAt で並べる)
function dateDayDiff(a: string, b: string): number {
  const ta = new Date(a.slice(0, 10) + "T00:00:00Z").getTime();
  const tb = new Date(b.slice(0, 10) + "T00:00:00Z").getTime();
  return Math.abs(ta - tb) / (24 * 3600 * 1000);
}
function effectiveSortKey(e: NormalizedExpense): string {
  if (e.sortKey && dateDayDiff(e.sortKey, e.occurredAt) <= 2) {
    return e.sortKey;
  }
  // 時刻不明 (date-only "YYYY-MM-DD") は同日の末尾に寄せる:
  // 旅行記の自然順は「朝の取引 → 夜の取引 → ホテル check-in (date-only)」になる方が読みやすい。
  if (e.occurredAt.length <= 10) return e.occurredAt + "T99:99:99Z";
  return e.occurredAt;
}

function compareExpenses(a: NormalizedExpense, b: NormalizedExpense): number {
  // 2段階ソート:
  //   L1: occurredAt の日付部分（現地表示日）。日付が違えば普通に日付順
  //   L2: 同じ表示日内では effectiveSortKey で時系列
  // 例: 4/28 京都 Uber (JST 11:44 = UTC 02:44) と 4/28 ハワイ Uber (HST 08:32 = UTC 18:32) は両方 "2026-04-28"。
  // L2 で UTC 比較すると Kyoto が先になる（user feedback: トランザクション順を優先）。
  const dateA = a.occurredAt.slice(0, 10);
  const dateB = b.occurredAt.slice(0, 10);
  if (dateA !== dateB) return dateA < dateB ? -1 : 1;

  const keyA = effectiveSortKey(a);
  const keyB = effectiveSortKey(b);
  if (keyA !== keyB) return keyA < keyB ? -1 : 1;

  return CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category);
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
