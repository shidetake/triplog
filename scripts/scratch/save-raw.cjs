#!/usr/bin/env node
// Usage: node save-raw.cjs <messageId> <input-text-file> <output-json-file>
// Parses MCP gmail read_email plain-text output and writes RawMessage JSON.
// Body is stripped (HTML→text) when message is HTML so files stay compact;
// the project parsers also stripHtml the body, so this is lossless for them.

const fs = require("fs");
const path = require("path");

function stripHtml(html) {
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
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const [, , messageId, inFile, outFile] = process.argv;
if (!messageId || !inFile || !outFile) {
  console.error("Usage: node save-raw.cjs <messageId> <input-text-file> <output-json-file>");
  process.exit(2);
}

const raw = fs.readFileSync(inFile, "utf8");
const lines = raw.split(/\r?\n/);
let i = 0;
const headers = {};
for (; i < lines.length; i++) {
  const line = lines[i];
  if (line === "") { i++; break; }
  const m = line.match(/^([A-Za-z][A-Za-z ]*?):\s*(.*)$/);
  if (m) headers[m[1]] = m[2];
}
let isHtml = false;
while (i < lines.length && lines[i].startsWith("[Note:")) {
  if (/HTML-formatted/i.test(lines[i])) isHtml = true;
  i++;
}
while (i < lines.length && lines[i] === "") i++;

let attachStart = -1;
for (let k = i; k < lines.length; k++) {
  if (/^Attachments \(\d+\):\s*$/.test(lines[k])) { attachStart = k; break; }
}

let bodyRaw;
const attachments = [];
if (attachStart >= 0) {
  bodyRaw = lines.slice(i, attachStart).join("\n").replace(/\n+$/, "");
  for (let k = attachStart + 1; k < lines.length; k++) {
    const l = lines[k];
    if (!l.startsWith("- ")) continue;
    const m = l.match(/^- (.+?) \(([^,]+),\s*[^,]+,\s*ID:\s*([^)]+)\)\s*$/);
    if (m) {
      attachments.push({ filename: m[1], mimeType: m[2].trim(), attachmentId: m[3].trim() });
    } else {
      const m2 = l.match(/^- (.+?) \(([^)]+)\)\s*$/);
      if (m2) {
        const meta = m2[2];
        const idMatch = meta.match(/ID:\s*([A-Za-z0-9_\-]+)/);
        const mimeMatch = meta.match(/^([^,]+),/);
        attachments.push({
          filename: m2[1],
          mimeType: mimeMatch ? mimeMatch[1].trim() : "application/octet-stream",
          attachmentId: idMatch ? idMatch[1] : "",
        });
      }
    }
  }
} else {
  bodyRaw = lines.slice(i).join("\n").replace(/\n+$/, "");
}

const body = isHtml ? stripHtml(bodyRaw) : bodyRaw;

const rawMsg = {
  messageId,
  from: headers["From"] ?? "",
  subject: headers["Subject"] ?? "",
  date: headers["Date"] ?? "",
  body,
};
if (attachments.length) {
  rawMsg.attachments = attachments.map((a) => ({
    filename: a.filename,
    mimeType: a.mimeType,
  }));
}

fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, JSON.stringify(rawMsg, null, 2) + "\n");

process.stdout.write(JSON.stringify({ messageId, attachments }) + "\n");
