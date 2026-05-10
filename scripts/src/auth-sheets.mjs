#!/usr/bin/env node
import { OAuth2Client } from 'google-auth-library';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { homedir } from 'node:os';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';

const SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/drive.file',
];

const credentialsPath =
  process.env.CREDENTIALS_PATH?.replace('${HOME}', homedir()) ??
  `${homedir()}/.config/gcloud/travel-expenses-oauth.json`;
const tokenPath =
  process.env.TOKEN_PATH?.replace('${HOME}', homedir()) ??
  `${homedir()}/.config/gcloud/triplog-sheets-token.json`;

if (!existsSync(credentialsPath)) {
  console.error(`credentials not found: ${credentialsPath}`);
  process.exit(1);
}

const raw = JSON.parse(readFileSync(credentialsPath, 'utf-8'));
const block = raw.installed ?? raw.web;
if (!block) {
  console.error('expected "installed" or "web" key in credentials json');
  process.exit(1);
}
const { client_id, client_secret } = block;

function openBrowser(url) {
  const opener =
    process.platform === 'darwin'
      ? ['open', [url]]
      : process.platform === 'win32'
        ? ['cmd', ['/c', 'start', '""', url]]
        : ['xdg-open', [url]];
  spawn(opener[0], opener[1], { stdio: 'ignore', detached: true }).unref();
}

const server = createServer();
server.listen(0, '127.0.0.1', async () => {
  const port = server.address().port;
  const redirectUri = `http://127.0.0.1:${port}`;
  const oauth2Client = new OAuth2Client({
    clientId: client_id,
    clientSecret: client_secret,
    redirectUri,
  });

  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: SCOPES,
  });

  console.error(`\nlistening on ${redirectUri}`);
  console.error('opening browser for Google sign-in...');
  console.error(`if it does not open, visit:\n  ${authUrl}\n`);
  openBrowser(authUrl);

  server.on('request', async (req, res) => {
    try {
      const url = new URL(req.url, redirectUri);
      const code = url.searchParams.get('code');
      const err = url.searchParams.get('error');
      if (err) {
        res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end(`OAuth error: ${err}`);
        console.error(`OAuth error: ${err}`);
        server.close();
        process.exit(1);
      }
      if (!code) {
        res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('missing code');
        return;
      }
      const { tokens } = await oauth2Client.getToken(code);
      mkdirSync(dirname(tokenPath), { recursive: true });
      writeFileSync(tokenPath, JSON.stringify(tokens, null, 2), { mode: 0o600 });
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(
        '<!doctype html><meta charset="utf-8"><title>OK</title>' +
          '<h1>認証成功</h1><p>このタブは閉じて構いません。</p>',
      );
      console.error(`\ntoken saved: ${tokenPath}`);
      console.error(`scopes: ${tokens.scope ?? '(none)'}`);
      console.error(
        `refresh_token: ${tokens.refresh_token ? 'present' : 'MISSING (try removing app from https://myaccount.google.com/permissions and rerun)'}`,
      );
      server.close();
      setTimeout(() => process.exit(0), 250);
    } catch (e) {
      console.error('token exchange failed:', e);
      try {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('token exchange failed; see console');
      } catch {}
      server.close();
      process.exit(1);
    }
  });
});
