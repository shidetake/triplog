import type { ParseResult, RawExpense, RawMessage } from "../types.ts";
import { normalizeMerchant } from "./util.ts";

// Marriott Folio is a multi-line PDF. After pdf-parse it's text-only.
// We split it into per-night room charges and per-day in-stay charges.
//
// Folio rows look roughly like:
//   04/28/26  ROOM CHARGE - OCEAN VIEW   $XXX.XX
//   04/28/26  RESORT FEE                 $XX.XX
//   04/28/26  STATE TAX 4.712%           $X.XX
//   04/28/26  TAT 10.25%                 $XX.XX
//   04/28/26  HCT 3%                     $X.XX
//   ...
//   04/30/26  IN-STAY CHARGE: ORCHIDS    $XX.XX   (room-charged restaurant bill)
//
// For each night we collapse {room+resort fee+all taxes} into ONE 宿泊 line with date = check-in (per HANDOFF.md §4.5).
// For in-stay charges (restaurant/spa/etc) we emit individual lines preserving date and detail.

const DATE_AMOUNT_RE = /(\d{2}\/\d{2}\/\d{2,4})\s+([^\$]+?)\s+\$?\s*(-?[\d,]+\.\d{2})/g;

function mmddyyToIso(s: string): string {
  const parts = s.split("/");
  const mm = parts[0]!;
  const dd = parts[1]!;
  const yyRaw = parts[2]!;
  const yy = yyRaw.length === 2 ? `20${yyRaw}` : yyRaw;
  return `${yy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
}

const ROOM_LINE_RE = /(ROOM\s*CHARGE|GUEST\s*ROOM|ACCOMMODATION)/i;
const RESORT_FEE_RE = /RESORT\s*FEE/i;
const TAX_RE = /(STATE\s*TAX|TAT|HCT|GET|TAX)/i;
// In-stay restaurant/spa keywords that should be split out as 飲食/etc
const IN_STAY_FOOD_KEYWORDS = /(ORCHIDS|ISLAND VINTAGE|HONOLULU COFFEE|HULA GRILL|YARD HOUSE|HOWZIT|HANA KOA|RESTAURANT|BAR|F&B|FOOD|BREAKFAST|LUNCH|DINNER)/i;

export function parseMarriottFolio(msg: RawMessage): ParseResult {
  // Find PDF attachment with extracted text
  const att = (msg.attachments ?? []).find(
    (a) => /\.pdf$/i.test(a.filename) || a.mimeType.includes("pdf") || a.mimeType === "application/octet-stream",
  );
  if (!att?.textContent) {
    return { ok: false, reason: "marriott-folio: no PDF text content" };
  }

  // Hotel name
  const merchantMatch = att.textContent.match(/(The Royal Hawaiian|Royal Hawaiian|Halekulani|Marriott\s+\S+)/i);
  const merchantRaw = merchantMatch ? merchantMatch[1]! : "Royal Hawaiian";

  type Row = { date: string; description: string; amount: number };
  const rows: Row[] = [];
  let m: RegExpExecArray | null;
  while ((m = DATE_AMOUNT_RE.exec(att.textContent)) !== null) {
    const dateStr = m[1]!;
    const descRaw = m[2]!;
    const amt = m[3]!;
    rows.push({
      date: mmddyyToIso(dateStr),
      description: descRaw.replace(/\s+/g, " ").trim(),
      amount: Number(amt.replace(/,/g, "")),
    });
  }
  if (rows.length === 0) {
    return { ok: false, reason: "marriott-folio: no date+amount rows" };
  }

  // Aggregate: roomTotal, inStayLines
  let roomTotal = 0;
  const inStayLines: RawExpense[] = [];
  let firstDate: string | null = null;

  for (const r of rows) {
    if (firstDate === null || r.date < firstDate) firstDate = r.date;
    if (
      ROOM_LINE_RE.test(r.description) ||
      RESORT_FEE_RE.test(r.description) ||
      TAX_RE.test(r.description)
    ) {
      roomTotal += r.amount;
      continue;
    }
    if (IN_STAY_FOOD_KEYWORDS.test(r.description)) {
      // detail には品目のみ（PDF 行の description は店名コードなので空欄でも可、
      // 中身が分かるなら入れる）。「部屋付け」というメタ情報は J 列 (備考 / notes) へ。
      inStayLines.push({
        source: "hotel-folio",
        messageId: `${msg.messageId}#${inStayLines.length + 1}`,
        occurredAt: r.date,
        merchantRaw: r.description,
        merchant: normalizeMerchant(r.description),
        amountLocal: r.amount,
        currencyLocal: "USD",
        amountJPY: null,
        tipLocal: null,
        category: "飲食",
        notes: "部屋付け",
      });
      continue;
    }
    // Unknown line — add to room total as fallback (safer than dropping)
    roomTotal += r.amount;
  }

  // Emit one stay-aggregate row + in-stay rows; but ParseResult is single.
  // Workaround: return aggregate as expense, store inStayLines via a side-channel.
  // We'll handle this in the caller by checking attachmentTextContent ourselves.
  // Simpler: encode multi-row in `notes` JSON and let extract.ts fan out.
  const aggregate: RawExpense = {
    source: "hotel-folio",
    messageId: msg.messageId,
    occurredAt: firstDate ?? "",
    merchantRaw,
    merchant: normalizeMerchant(merchantRaw),
    amountLocal: roomTotal,
    currencyLocal: "USD",
    amountJPY: null,
    tipLocal: null,
    category: "宿泊",
    detail: `客室+Resort Fee+各種税込`,
    notes: inStayLines.length
      ? `__FANOUT__:${JSON.stringify(inStayLines)}`
      : undefined,
  };
  return { ok: true, expense: aggregate };
}
