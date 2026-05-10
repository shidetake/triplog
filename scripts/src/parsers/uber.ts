import type { ParseResult, RawMessage } from "../types.ts";
import { parseJpDateTime, stripHtml } from "./util.ts";

// Uber Japanese-locale receipt emails:
//   "2026年5月4日 午後1時12分"  (booking time)
//   "合計 $29.05"
//   "乗車料金 $25.67"
//   "Sales Tax $1.30"
//   "待ち時間 $0.07"
//   "迎車料金 $2.01"
//   "9.25 マイル, 17 minutes"
//   "午後1時23分 <pickup address>"
//   "午後1時40分 <dropoff address>"
// Pickup/dropoff appear twice (map alt + body text); we take the first pair.

function findUsd(text: string, label: string): number | null {
  const re = new RegExp(`${label}\\s+\\$\\s?(-?[\\d,]+(?:\\.\\d{2})?)`);
  const m = text.match(re);
  return m ? Number(m[1]!.replace(/,/g, "")) : null;
}

const TIME_LINE_RE = /(午前|午後)(\d{1,2})時(\d{1,2})分\s+([^午]+?)(?=\s*午前|\s*午後|\s+ドライバー|\s*$)/g;

function jpToHHmm(ampm: string, h: string, m: string): string {
  let hh = Number(h);
  if (ampm === "午後" && hh < 12) hh += 12;
  if (ampm === "午前" && hh === 12) hh = 0;
  return `${String(hh).padStart(2, "0")}:${m.padStart(2, "0")}`;
}

export function parseUber(msg: RawMessage): ParseResult {
  const text = stripHtml(msg.body);
  const occurredAt = parseJpDateTime(text) ?? null;
  if (!occurredAt) return { ok: false, reason: "uber: no booking date" };

  const total = findUsd(text, "合計");
  if (total === null) return { ok: false, reason: "uber: no total" };
  const fare = findUsd(text, "乗車料金");
  const tax = findUsd(text, "Sales Tax");
  const wait = findUsd(text, "待ち時間");
  const pickupFee = findUsd(text, "迎車料金");

  // Tip (after-charge): may appear as "チップ" if added later
  const tip = findUsd(text, "チップ");

  // Distance/time
  const distMatch = text.match(/(\d+(?:\.\d+)?)\s*マイル,?\s*(\d+)\s*minutes?/);
  const dist = distMatch ? `${distMatch[1]!}mi/${distMatch[2]!}min` : null;

  // Vehicle type (UberX/Comfort/Black/etc)
  const vehicleMatch = text.match(/乗車サービスの詳細\s+([A-Za-z][A-Za-z0-9 ]*?)\s+\d/);
  const vehicle = vehicleMatch ? vehicleMatch[1]!.trim() : null;

  // Pickup/dropoff: use simpler approach — find first two "午前/午後 時 分 <addr>" pairs after "乗車サービスの詳細"
  const detailIdx = text.indexOf("乗車サービスの詳細");
  const tail = detailIdx >= 0 ? text.slice(detailIdx) : text;
  const stops: Array<{ time: string; addr: string }> = [];
  // Match "午前/午後 H時M分 <addr>" until next time stamp or "ドライバー"
  const stopRe = /(午前|午後)(\d{1,2})時(\d{1,2})分\s+([^]+?)(?=\s*(午前|午後)\d{1,2}時\d{1,2}分|\s*ドライバー名|$)/g;
  let m: RegExpExecArray | null;
  while ((m = stopRe.exec(tail)) !== null) {
    stops.push({
      time: jpToHHmm(m[1]!, m[2]!, m[3]!),
      addr: m[4]!.replace(/\s+/g, " ").trim(),
    });
    if (stops.length >= 2) break;
  }

  let detail: string | undefined;
  if (stops.length >= 2) {
    const a = shortAddress(stops[0]!.addr);
    const b = shortAddress(stops[1]!.addr);
    detail = `${a}→${b} ${stops[0]!.time}`;
    if (vehicle) detail = `${vehicle} ${detail}`;
    if (dist) detail = `${detail} (${dist})`;
  } else if (vehicle) {
    detail = `${vehicle}${dist ? ` ${dist}` : ""}`;
  }

  return {
    ok: true,
    expense: {
      source: "rideshare",
      messageId: msg.messageId,
      occurredAt,
      merchantRaw: "Uber",
      merchant: "UBER",
      amountLocal: total,
      currencyLocal: "USD",
      amountJPY: null,
      tipLocal: tip,
      category: "現地移動",
      detail,
      notes:
        fare !== null
          ? `fare:${fare}${tax !== null ? `,tax:${tax}` : ""}${wait !== null ? `,wait:${wait}` : ""}${pickupFee !== null ? `,pickupFee:${pickupFee}` : ""}`
          : undefined,
    },
  };
}

function shortAddress(a: string): string {
  // "Terminal 2, Daniel K. Inouye International Airport (HNL), Honolulu, HI 96819, US"
  //   → "HNL T2"
  // "412 Lewers St, Honolulu, HI 96815, US" → "Lewers St" (street name)
  if (/HNL/i.test(a)) {
    const t = a.match(/Terminal\s*(\d+)/i);
    return t ? `HNL T${t[1]}` : "HNL";
  }
  // Strip ", Honolulu, HI..." trailing
  const head = a.split(/,\s*Honolulu/i)[0]?.trim() ?? a;
  // Take last token if multi-word street
  return head.length > 32 ? head.slice(0, 32) + "…" : head;
}
