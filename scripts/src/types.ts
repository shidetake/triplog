export type Source =
  | "sony-bank-auth"
  | "sony-bank-confirm"
  | "receipt-email"
  | "hotel-folio"
  | "airline"
  | "rideshare"
  | "other";

export type Category =
  | "渡航"
  | "宿泊"
  | "現地移動"
  | "飲食"
  | "お土産"
  | "衣服"
  | "エンタメ"
  | "日用品"
  | "通信"
  | "その他";

export const CATEGORY_ORDER: Category[] = [
  "渡航",
  "宿泊",
  "現地移動",
  "飲食",
  "お土産",
  "衣服",
  "エンタメ",
  "日用品",
  "通信",
  "その他",
];

export type RawExpense = {
  source: Source;
  messageId: string;
  occurredAt: string; // ISO8601 or "YYYY-MM-DD"
  merchantRaw: string;
  merchant: string;
  amountLocal: number | null;
  currencyLocal: string; // "USD", "JPY"
  amountJPY: number | null;
  tipLocal: number | null;
  category?: Category;
  detail?: string;
  notes?: string;
};

export type NormalizedExpense = RawExpense & {
  category: Category;
  amountJPY: number; // 正規化後は必須
  fxRate: number | "BANK";
  excluded: boolean; // I列 計算対象外
};

export type NoiseFilters = {
  fromDomains: string[];
  subjectPatterns: string[];
};

export type TripConfig = {
  slug: string;
  spreadsheetId: string;
  sheetName: string;
  headerRow: number;
  dataStartRow: number;
  writeRange: string; // "B19:I"
  period: { start: string; end: string };
  originAirport?: string;
  destinationAirport?: string;
  primaryStay?: string;
  queries: string[];
  noiseFilters?: NoiseFilters;
  fxRateOverride?: number | null;
};

export type RawMessage = {
  messageId: string;
  from: string;
  subject: string;
  date: string; // RFC 2822 / ISO
  body: string; // plain text or stripped HTML
  bodyRaw?: string; // original (HTML or plain)
  attachments?: Array<{
    filename: string;
    mimeType: string;
    path: string; // relative to trip dir
    textContent?: string; // extracted text for PDFs etc.
  }>;
};

export type ParseResult =
  | { ok: true; expense: RawExpense }
  | { ok: false; reason: string }; // skip silently

