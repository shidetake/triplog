import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { RawExpense, RawMessage, TripConfig } from "./types.ts";
import { dedup } from "./dedup.ts";
import { mergeSonyAuthConfirmByApproval, tipMerge } from "./tip-merge.ts";
import { categorize } from "./categorize.ts";
import { applyFx } from "./fx.ts";
import { summarizeByCategory, toTsv } from "./build-tsv.ts";

function usage(): never {
  console.error("Usage: pipeline <slug>");
  console.error("  Reads:  trips/<slug>/config.json");
  console.error("          trips/<slug>/raw/extracted.json (RawExpense[])");
  console.error("  Writes: trips/<slug>/output.tsv");
  process.exit(2);
}

const slug = process.argv[2];
if (!slug) usage();

const projectRoot = resolve(process.cwd());
const tripDir = resolve(projectRoot, "trips", slug);
const config: TripConfig = JSON.parse(
  readFileSync(resolve(tripDir, "config.json"), "utf8"),
);
const raw: RawExpense[] = JSON.parse(
  readFileSync(resolve(tripDir, "raw/extracted.json"), "utf8"),
);

// agent-fallback など sortKey が未設定のレコードに対し、raw/<messageId>.json から email date を引いて backfill。
// fanout のメッセージID（"<base>#<suffix>"）は base 部分でルックアップ。
const rawDir = resolve(tripDir, "raw");
const meta = new Set([
  "extracted.json",
  "needs-agent.json",
  "filtered-out.json",
  "messages.json",
  "kept.json",
  "download-errors.json",
  "html-errors.json",
  "agent-fallback.json",
]);
const rawByMid = new Map<string, RawMessage>();
for (const f of readdirSync(rawDir)) {
  if (!f.endsWith(".json") || meta.has(f)) continue;
  const fp = join(rawDir, f);
  if (!statSync(fp).isFile()) continue;
  try {
    const m = JSON.parse(readFileSync(fp, "utf8"));
    if (m.messageId) rawByMid.set(m.messageId, m);
  } catch {
    /* skip */
  }
}
for (const e of raw) {
  if (e.sortKey) continue;
  const baseId = e.messageId.split("#")[0]!;
  const m = rawByMid.get(baseId);
  if (m?.date) {
    try {
      e.sortKey = new Date(m.date).toISOString();
    } catch {
      /* skip */
    }
  }
}

// Sony 銀行メールの "カード利用日" は送信時刻 (JST) の日付がそのまま入るため、
// 例えば HST 4/28 15:00 の取引は JST 4/29 朝にメール送信され occurredAt = 2026-04-29 になる。
// 旅行先 TZ が分かっていれば sortKey (UTC) を現地 TZ に変換して日付を上書きする。
// 補正対象は「日付のみ (時刻なし) の Sony 銀行レコード」だけ。本文に現地時刻が
// 入っているソース (receipt-email 等) や、明示的に時刻付きで来る Sony confirm は触らない。
function localDateInTz(utcIso: string, tz: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(utcIso));
  const y = parts.find((p) => p.type === "year")!.value;
  const m = parts.find((p) => p.type === "month")!.value;
  const d = parts.find((p) => p.type === "day")!.value;
  return `${y}-${m}-${d}`;
}
if (config.timezone) {
  for (const e of raw) {
    if (e.source !== "sony-bank-auth" && e.source !== "sony-bank-confirm") continue;
    if (!e.sortKey) continue;
    if (e.occurredAt.length > 10) continue;
    try {
      e.occurredAt = localDateInTz(e.sortKey, config.timezone);
    } catch {
      /* skip on bad date */
    }
  }
}

const preMerged = mergeSonyAuthConfirmByApproval(raw);
const deduped = dedup(preMerged);
const tipped = tipMerge(deduped);
const categorized = categorize(tipped);

const uncategorized = categorized.filter((e) => !e.category);
if (uncategorized.length > 0) {
  console.error(`ERROR: ${uncategorized.length} records missing category:`);
  for (const e of uncategorized) {
    console.error(`  - ${e.merchant} (${e.messageId})`);
  }
  process.exit(1);
}

const normalized = applyFx(categorized, config);
const tsv = toTsv(normalized);
writeFileSync(resolve(tripDir, "output.tsv"), tsv + "\n");

console.error(`wrote ${normalized.length} rows to trips/${slug}/output.tsv`);
console.error("category totals:");
for (const [cat, s] of summarizeByCategory(normalized)) {
  const pending = s.jpyPendingRows > 0 ? ` / 未確定 ${s.jpyPendingRows}件` : "";
  console.error(
    `  ${cat}: ${s.count}件 (確定 ${s.jpyConfirmedRows}件 ¥${s.jpyConfirmed.toLocaleString()}${pending})`,
  );
}
