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
