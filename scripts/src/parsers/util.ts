// Shared parser utilities

export function stripHtml(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&[a-z]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function fullWidthToHalf(s: string): string {
  return s
    .replace(/[！-～]/g, (c) =>
      String.fromCharCode(c.charCodeAt(0) - 0xfee0),
    )
    .replace(/　/g, " ");
}

const PROCESSOR_PREFIX = /^(TST\*|SQ\*|SP\*|PAYPAL\*|SQUARE\s*\*|SQUAREUP\s*\*)\s*/i;
export function normalizeMerchant(raw: string): string {
  let s = fullWidthToHalf(raw);
  s = s.replace(PROCESSOR_PREFIX, "");
  s = s.toUpperCase();
  s = s.replace(/\s+/g, " ").trim();
  return s;
}

export function parseJpDateTime(s: string): string | null {
  const m = s.match(/(\d{4})年(\d{1,2})月(\d{1,2})日\s*(午前|午後)?(\d{1,2})時(\d{1,2})分/);
  if (!m) return null;
  const yy = m[1]!;
  const mm = m[2]!;
  const dd = m[3]!;
  const ampm = m[4];
  const hhRaw = m[5]!;
  const min = m[6]!;
  let hh = Number(hhRaw);
  if (ampm === "午後" && hh < 12) hh += 12;
  if (ampm === "午前" && hh === 12) hh = 0;
  return `${yy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}T${String(hh).padStart(2, "0")}:${min.padStart(2, "0")}:00`;
}

export function parseUsDateTime(s: string): string | null {
  const m = s.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})\s+(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
  if (!m) return null;
  const mm = m[1]!;
  const dd = m[2]!;
  const yyRaw = m[3]!;
  const hhRaw = m[4]!;
  const min = m[5]!;
  const ampm = m[6];
  const yy = yyRaw.length === 2 ? `20${yyRaw}` : yyRaw;
  let hh = Number(hhRaw);
  if (ampm?.toUpperCase() === "PM" && hh < 12) hh += 12;
  if (ampm?.toUpperCase() === "AM" && hh === 12) hh = 0;
  return `${yy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}T${String(hh).padStart(2, "0")}:${min}:00`;
}

const MONTH_TO_NUM: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};
export function parseEnDateTime(s: string): string | null {
  // 月名は3〜9文字（"May" / "April" / "September" 等）を許容。MONTH_TO_NUM lookup は3文字 prefix。
  const m = s.match(/([A-Za-z]{3,9})\s+(\d{1,2}),?\s+(\d{4})\s+at\s+(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
  if (!m) return null;
  const mon = m[1]!;
  const dd = m[2]!;
  const yy = m[3]!;
  const hhRaw = m[4]!;
  const min = m[5]!;
  const ampm = m[6];
  const mm = MONTH_TO_NUM[mon.slice(0, 3).toLowerCase()];
  if (!mm) return null;
  let hh = Number(hhRaw);
  if (ampm?.toUpperCase() === "PM" && hh < 12) hh += 12;
  if (ampm?.toUpperCase() === "AM" && hh === 12) hh = 0;
  return `${yy}-${mm}-${dd.padStart(2, "0")}T${String(hh).padStart(2, "0")}:${min}:00`;
}

export function parseEnDate(s: string): string | null {
  const m = s.match(/([A-Za-z]{3,9})\s+(\d{1,2}),?\s+(\d{4})/);
  if (!m) return null;
  const mon = m[1]!;
  const dd = m[2]!;
  const yy = m[3]!;
  const mm = MONTH_TO_NUM[mon.slice(0, 3).toLowerCase()];
  if (!mm) return null;
  return `${yy}-${mm}-${dd.padStart(2, "0")}`;
}

export function findFirstUsd(text: string): number | null {
  const m = text.match(/\$\s?(-?\d{1,3}(?:,\d{3})*(?:\.\d{2})?|-?\d+(?:\.\d{2})?)/);
  if (!m) return null;
  return Number(m[1]!.replace(/,/g, ""));
}
