#!/usr/bin/env node
// Usage: node inject-pdf-text.cjs <json-file> <attachment-filename> <text-file>
const fs = require("fs");
const [, , jsonFile, attFilename, textFile] = process.argv;
const obj = JSON.parse(fs.readFileSync(jsonFile, "utf8"));
const text = fs.readFileSync(textFile, "utf8");
if (!obj.attachments) { console.error("no attachments"); process.exit(1); }
const att = obj.attachments.find((a) => a.filename === attFilename);
if (!att) { console.error("attachment not found:", attFilename); process.exit(1); }
att.textContent = text;
fs.writeFileSync(jsonFile, JSON.stringify(obj, null, 2) + "\n");
console.log(`OK: injected ${text.length} chars into ${attFilename}`);
