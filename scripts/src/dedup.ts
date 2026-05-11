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
    .replace(/[’‘'`]/g, "'") // apostrophe variants (U+2019/U+2018/U+0060) → straight (U+0027)
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
export function isFuzzyMatch(a: string, b: string): boolean {
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
  // 同 source × 異 messageId は「Gmail の重複コピー」のみ merge する厳格モード:
  //   - 金額が完全一致 (±$0.01)
  //   - 時刻が 1 分以内
  //   - detail がコンフリクトしない（両方非空で異なる場合は別取引: Delta の HIDETAKE/NAE 等）
  //   - notes がコンフリクトしない（両方非空で異なる場合は別取引: Sony 銀行の承認番号、Delta のチケット番号等）
  // これで Uber の重複レシート（同一トリップが 2-3 通届くケース）は merge する一方、
  // 同店舗・同額・短時間内の別注文（Sony 確定 $1 が複数 / Delta の連名 / HOWZIT $10.42 vs $11.42）は別レコードとして残せる。
  if (a.source === b.source && a.messageId !== b.messageId) {
    if (a.amountLocal == null || b.amountLocal == null) return false;
    if (Math.abs(a.amountLocal - b.amountLocal) > 0.01) return false;
    if (!withinTimeWindow(a.occurredAt, b.occurredAt, 1 / 60)) return false;
    const da = (a.detail ?? "").trim();
    const db = (b.detail ?? "").trim();
    if (da && db && da !== db) return false;
    const na = (a.notes ?? "").trim();
    const nb = (b.notes ?? "").trim();
    if (na && nb && na !== nb) return false;
    return true;
  }
  // 異 source 間（sony-merged + receipt-email 等）: tip-merge.ts の承認番号ベース pre-merge
  // を経た後はほぼ完全一致するはずなので、絶対値で厳しく判定する。
  // 旧 ±25% 相対許容は同店舗・近額の別取引（HOWZIT $10.42 vs $11.42 等）を誤マージするため廃止。
  if (a.amountLocal == null || b.amountLocal == null) return false;
  if (Math.abs(a.amountLocal - b.amountLocal) > 0.10) return false;
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

  // occurredAt は表示用の現地時刻なので、上位 source（receipt-email 等、メール本文を直接パース）を尊重する。
  // 旧実装では Sony 銀行 auth の "カード利用日" (JST) で上書きしていたが、
  // それだと Hawaii 取引が 1日ずれて表示されるため廃止（user feedback: 現地時刻で表示）。
  // sortKey は時系列順のため UTC ベース、これは sorted[0] のものをそのまま rep が引き継ぐ。

  // detail: 上位ソースのものを優先（既にrep側にあればそのまま）
  if (!rep.detail) {
    const detailed = sorted.find((g) => g.detail);
    if (detailed) rep.detail = detailed.detail;
  }

  // notes: 上位ソースのものを優先。rep が notes を持たない場合のみ補完
  // （J 列 / 備考に出る情報。部屋付けラベル等を取りこぼさないため）
  if (!rep.notes) {
    const noted = sorted.find((g) => g.notes);
    if (noted) rep.notes = noted.notes;
  }

  // tipLocal: グループ内のいずれかが持っていれば引き継ぐ
  // （承認番号で auth+confirm が pre-merge された結果が混ざるケースを救う）
  if (rep.tipLocal == null) {
    const tipped = group.find((g) => g.tipLocal != null);
    if (tipped) rep.tipLocal = tipped.tipLocal;
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
