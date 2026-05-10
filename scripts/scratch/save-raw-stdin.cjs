#!/usr/bin/env node
// Read MCP gmail read_email plain-text output from STDIN.
// Usage: node save-raw-stdin.cjs <messageId> <output-json-file>
// Stdout: JSON line with messageId + attachment metadata for download.

const fs = require("fs");
const path = require("path");

const [, , messageId, outFile] = process.argv;
if (!messageId || !outFile) {
  console.error("Usage: node save-raw-stdin.cjs <messageId> <output-json-file>");
  process.exit(2);
}

let raw = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (c) => (raw += c));
process.stdin.on("end", () => {
  const lines = raw.split(/\r?\n/);
  let i = 0;
  const headers = {};
  for (; i < lines.length; i++) {
    const line = lines[i];
    if (line === "") { i++; break; }
    const m = line.match(/^([A-Za-z][A-Za-z ]*?):\s*(.*)$/);
    if (m) headers[m[1]] = m[2];
  }
  while (i < lines.length && lines[i].startsWith("[Note:")) i++;
  while (i < lines.length && lines[i] === "") i++;

  let attachStart = -1;
  for (let k = i; k < lines.length; k++) {
    if (/^Attachments \(\d+\):\s*$/.test(lines[k])) {
      attachStart = k;
      break;
    }
  }

  let body;
  const attachments = [];
  if (attachStart >= 0) {
    body = lines.slice(i, attachStart).join("\n").replace(/\n+$/, "");
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
    body = lines.slice(i).join("\n").replace(/\n+$/, "");
  }

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
});
