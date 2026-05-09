import type { RawExpense, Source } from "./types.ts";

const SOURCE_PRIORITY: Record<Source, number> = {
  "hotel-folio": 4,
  "receipt-email": 3,
  airline: 3,
  rideshare: 3,
  "sony-bank-confirm": 2,
  "sony-bank-auth": 1,
  other: 0,
};

const PREFIX_RE = /^(TST\*|SQ\*|SP\*|SQU\*|WPY\*|PAYPAL\s*\*?\s*|PY\*)/i;

export function normalizeMerchant(name: string): string {
  return name
    .replace(PREFIX_RE, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

export function withinAmountTolerance(
  a: number | null,
  b: number | null,
  tolerance = 0.25,
): boolean {
  if (a === null || b === null) return false;
  if (a === 0 && b === 0) return true;
  const max = Math.max(Math.abs(a), Math.abs(b));
  if (max === 0) return true;
  return Math.abs(a - b) / max <= tolerance;
}

export function withinTimeWindow(
  aIso: string,
  bIso: string,
  hours = 72,
): boolean {
  const a = new Date(aIso).getTime();
  const b = new Date(bIso).getTime();
  if (Number.isNaN(a) || Number.isNaN(b)) return false;
  return Math.abs(a - b) <= hours * 3600 * 1000;
}

function isSameTransaction(a: RawExpense, b: RawExpense): boolean {
  if (a.currencyLocal !== b.currencyLocal) return false;
  if (normalizeMerchant(a.merchantRaw) !== normalizeMerchant(b.merchantRaw)) {
    return false;
  }
  if (!withinAmountTolerance(a.amountLocal, b.amountLocal)) return false;
  if (!withinTimeWindow(a.occurredAt, b.occurredAt)) return false;
  return true;
}

function pickRepresentative(group: RawExpense[]): RawExpense {
  const sorted = [...group].sort(
    (a, b) => SOURCE_PRIORITY[b.source] - SOURCE_PRIORITY[a.source],
  );
  const rep = { ...sorted[0]! };

  // amountJPY: sony-bank-confirm から拾う
  const confirm = group.find((g) => g.source === "sony-bank-confirm");
  if (confirm?.amountJPY != null && rep.amountJPY == null) {
    rep.amountJPY = confirm.amountJPY;
  }

  // occurredAt: 速報側（auth）優先、なければ最も早い日付
  const auth = group.find((g) => g.source === "sony-bank-auth");
  if (auth?.occurredAt) {
    rep.occurredAt = auth.occurredAt;
  } else {
    const earliest = group
      .map((g) => g.occurredAt)
      .filter(Boolean)
      .sort()[0];
    if (earliest) rep.occurredAt = earliest;
  }

  // detail: 上位ソースのものを優先（既にrep側にあればそのまま）
  if (!rep.detail) {
    const detailed = sorted.find((g) => g.detail);
    if (detailed) rep.detail = detailed.detail;
  }

  return rep;
}

export function dedup(expenses: RawExpense[]): RawExpense[] {
  const visited = new Array<boolean>(expenses.length).fill(false);
  const result: RawExpense[] = [];

  for (let i = 0; i < expenses.length; i++) {
    if (visited[i]) continue;
    const seed = expenses[i]!;
    const group: RawExpense[] = [seed];
    visited[i] = true;
    for (let j = i + 1; j < expenses.length; j++) {
      if (visited[j]) continue;
      if (isSameTransaction(seed, expenses[j]!)) {
        group.push(expenses[j]!);
        visited[j] = true;
      }
    }
    result.push(pickRepresentative(group));
  }

  return result;
}
