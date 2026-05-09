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
  fxRateOverride?: number | null;
};
