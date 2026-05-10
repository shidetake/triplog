import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { RawExpense, TripConfig } from "./types.ts";
import { dedup } from "./dedup.ts";
import { mergeSquareSplitTip, tipMerge } from "./tip-merge.ts";
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

const preMerged = mergeSquareSplitTip(raw);
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
console.error("category totals (JPY):");
for (const [cat, { count, jpy }] of summarizeByCategory(normalized)) {
  console.error(`  ${cat}: ${count} rows, ¥${jpy.toLocaleString()}`);
}
