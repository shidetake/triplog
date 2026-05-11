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
  | "医療"
  | "カジノ"
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
  "医療",
  "カジノ",
  "通信",
  "その他",
];

export type RawExpense = {
  source: Source;
  messageId: string;
  occurredAt: string; // 表示用。現地時刻 ISO8601 or "YYYY-MM-DD"
  // 並び替え用の UTC タイムスタンプ。email の Date ヘッダーから取る。
  // occurredAt は現地時刻なので TZ がバラバラで sort できない（JST と HST が混在する旅行記録）。
  // sortKey は UTC で揃ってるので時系列順に並べられる。
  sortKey?: string;
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
  amountJPY: number | null; // 確定 JPY のみ。未確定は null（書き込み時は空欄）
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
  // Square 等、本文に full-receipt URL のみ載せて中身が外部にあるソース向け。
  // skill 側で WebFetch して取得したテキストを格納する。
  linkedContent?: string;
};

export type ParseResult =
  | { ok: true; expense: RawExpense }
  | { ok: false; reason: string }; // skip silently

