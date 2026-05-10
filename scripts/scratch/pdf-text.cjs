#!/usr/bin/env node
// Usage: node pdf-text.cjs <pdf-path> <output-text-path>
const fs = require("fs");
const pdf = require("pdf-parse");
const [, , inP, outP] = process.argv;
if (!inP || !outP) { console.error("Usage: node pdf-text.cjs <pdf> <txt>"); process.exit(2); }
const buf = fs.readFileSync(inP);
pdf(buf).then((r) => { fs.writeFileSync(outP, r.text); console.log(`OK: ${outP} (${r.text.length} chars)`); }).catch((e) => { console.error("ERR:", e.message); process.exit(1); });
