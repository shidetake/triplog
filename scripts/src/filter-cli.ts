import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { TripConfig } from "./types.ts";
import { applyNoiseFilters, type MessageMeta } from "./filter.ts";

const slug = process.argv[2];
if (!slug) {
  console.error("Usage: filter-cli <slug>");
  process.exit(2);
}

const projectRoot = resolve(process.cwd(), "..");
const tripDir = resolve(projectRoot, "trips", slug);
const config: TripConfig = JSON.parse(
  readFileSync(resolve(tripDir, "config.json"), "utf8"),
);
const messages: MessageMeta[] = JSON.parse(
  readFileSync(resolve(tripDir, "raw/messages.json"), "utf8"),
);

const result = applyNoiseFilters(messages, config.noiseFilters);

writeFileSync(
  resolve(tripDir, "raw/kept.json"),
  JSON.stringify(result.keep, null, 2) + "\n",
);
writeFileSync(
  resolve(tripDir, "raw/filtered-out.json"),
  JSON.stringify(result.drop, null, 2) + "\n",
);

console.error(`total:    ${messages.length}`);
console.error(`kept:     ${result.keep.length}`);
console.error(`filtered: ${result.drop.length}`);
console.error("\n--- filtered samples ---");
for (const d of result.drop.slice(0, 10)) {
  console.error(`  ${d.reason}\n    ${d.subject}`);
}
