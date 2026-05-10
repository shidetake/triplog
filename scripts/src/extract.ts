import { readFileSync, readdirSync, writeFileSync, statSync } from "node:fs";
import { resolve, join } from "node:path";
import type { RawExpense, RawMessage } from "./types.ts";
import { detectSource } from "./parsers/route.ts";
import { parseSonyBankAuth, parseSonyBankConfirm } from "./parsers/sony-bank.ts";
import { parseToast } from "./parsers/toast.ts";
import { parseSquare } from "./parsers/square.ts";
import { parseUber } from "./parsers/uber.ts";
import { parseMarriottFolio } from "./parsers/marriott-folio.ts";

function usage(): never {
  console.error("Usage: extract <slug>");
  console.error("  Reads:  trips/<slug>/raw/*.json");
  console.error("  Writes: trips/<slug>/raw/extracted.json");
  console.error("          trips/<slug>/raw/needs-agent.json");
  process.exit(2);
}

const slug = process.argv[2];
if (!slug) usage();

const projectRoot = resolve(process.cwd(), "..");
const tripDir = resolve(projectRoot, "trips", slug);
const rawDir = resolve(tripDir, "raw");

const messages: RawMessage[] = [];
for (const f of readdirSync(rawDir)) {
  if (!f.endsWith(".json")) continue;
  if (f === "extracted.json" || f === "needs-agent.json" || f === "filtered-out.json") continue;
  const fp = join(rawDir, f);
  if (!statSync(fp).isFile()) continue;
  try {
    const m = JSON.parse(readFileSync(fp, "utf8"));
    if (m.messageId) messages.push(m);
  } catch (e) {
    console.error(`skip (parse err): ${f}: ${(e as Error).message}`);
  }
}
console.error(`loaded ${messages.length} raw messages`);

const expenses: RawExpense[] = [];
const needsAgent: Array<{ messageId: string; from: string; subject: string; reason: string }> = [];
const counts: Record<string, number> = {};

for (const msg of messages) {
  const kind = detectSource(msg);
  counts[kind] = (counts[kind] ?? 0) + 1;
  let result: ReturnType<typeof parseSonyBankAuth>;
  switch (kind) {
    case "sony-bank-auth":    result = parseSonyBankAuth(msg); break;
    case "sony-bank-confirm": result = parseSonyBankConfirm(msg); break;
    case "toast":             result = parseToast(msg); break;
    case "square":            result = parseSquare(msg); break;
    case "uber":              result = parseUber(msg); break;
    case "marriott-folio":    result = parseMarriottFolio(msg); break;
    default:
      needsAgent.push({ messageId: msg.messageId, from: msg.from, subject: msg.subject, reason: `kind:${kind}` });
      continue;
  }
  if (!result.ok) {
    needsAgent.push({ messageId: msg.messageId, from: msg.from, subject: msg.subject, reason: result.reason });
    continue;
  }

  const e = result.expense;
  // Handle marriott folio fan-out
  if (e.notes?.startsWith("__FANOUT__:")) {
    const fan = JSON.parse(e.notes.slice("__FANOUT__:".length)) as RawExpense[];
    delete e.notes;
    expenses.push(e);
    expenses.push(...fan);
  } else {
    expenses.push(e);
  }
}

writeFileSync(resolve(rawDir, "extracted.json"), JSON.stringify(expenses, null, 2) + "\n");
writeFileSync(resolve(rawDir, "needs-agent.json"), JSON.stringify(needsAgent, null, 2) + "\n");

console.error("\n=== source distribution ===");
for (const [k, n] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
  console.error(`  ${k}: ${n}`);
}
console.error(`\nparsed: ${expenses.length}`);
console.error(`needs-agent: ${needsAgent.length}`);
