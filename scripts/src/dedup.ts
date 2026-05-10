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

const PREFIX_RE = /^(TST\*|SQ\s*\*|SP\s+|SQU\*|WPY\*|PAYPAL\s*\*?\s*|PY\*|UBR\*\s*|FH\*\s*|PENDING\.\s*|PENDING\s+|\*)/i;
// Trailing patterns to strip: store numbers, branch suffixes, etc.
const SUFFIX_RES = [
  /\s+#?\d{4,}$/,
  /\s+-\s+[A-Z][A-Z\s]*$/,
  /\s+\d{1,3}$/,
];

export function normalizeMerchant(name: string): string {
  let n = name
    .replace(PREFIX_RE, "")
    .replace(/[#＃]/g, "#")
    .replace(/[-–—]/g, " ") // dash variants → space
    .replace(/'’/g, "'")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
  for (const re of SUFFIX_RES) n = n.replace(re, "").trim();
  return n;
}

// Fuzzy match の3段階:
//   1) 完全一致
//   2) prefix / suffix 一致（長さ6以上）
//   3) 単語集合の包含（短い側が2語以上で、その単語が全部長い側に含まれる）
//      例: "ISLAND VINTAGE WINE" ⊂ "IVWB ROYAL HAWAIIAN ISLAND VINTAGE WINE BAR"
//      金額±25% / 時刻±72h と AND で評価されるので、誤マージは現実的にほぼ起きない。
function isFuzzyMatch(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.length >= 6 && b.length >= 6 && (a.startsWith(b) || b.startsWith(a))) return true;
  const wordsA = a.split(/\s+/).filter(Boolean);
  const wordsB = b.split(/\s+/).filter(Boolean);
  const [shortW, longW] = wordsA.length <= wordsB.length ? [wordsA, wordsB] : [wordsB, wordsA];
  if (shortW.length < 2) return false;
  const longSet = new Set(longW);
  return shortW.every((w) => longSet.has(w));
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
  if (!isFuzzyMatch(normalizeMerchant(a.merchantRaw), normalizeMerchant(b.merchantRaw))) {
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
