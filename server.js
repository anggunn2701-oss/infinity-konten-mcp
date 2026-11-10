#!/usr/bin/env node
/* Infinity Konten MCP, remote: MCP over HTTPS (Streamable HTTP, JSON responses) for Grok, Muse and other
   AI clients. The tools themselves live in the website repository (mcp/core.js); this server clones that
   repository and loads them from the clone, so tools are maintained in one place.

   Environment:
     MCP_TOKEN      required. Clients send "Authorization: Bearer <MCP_TOKEN>",
                    or use the URL /mcp/<MCP_TOKEN> when they cannot set headers.
     GITHUB_TOKEN   required in production: fine-grained token with Contents read/write on GITHUB_REPO only.
                    The server clones the repo, edits content/*.json, builds, and publish pushes to GitHub
                    (the website service on Railway then redeploys by itself).
     GITHUB_REPO    default anggunn2701-oss/bimbel-infinity-website
     GIT_BRANCH     default main
     PORT           set by Railway
   Without GITHUB_TOKEN it uses the website folder in SITE_DIR (for testing) and publish is disabled. */
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const PORT = Number(process.env.PORT) || 8787;
const MCP_TOKEN = process.env.MCP_TOKEN || '';
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || '';
const REPO = process.env.GITHUB_REPO || 'anggunn2701-oss/bimbel-infinity-website';
const BRANCH = process.env.GIT_BRANCH || 'main';
const REMOTE = !!GITHUB_TOKEN;
const MAX_BODY = 2 * 1024 * 1024;

if (MCP_TOKEN.length < 24) {
  console.error('MCP_TOKEN wajib diisi (minimal 24 karakter acak).');
  process.exit(1);
}

/* ---------- working copy ---------- */
const redact = (s) => String(s).split(GITHUB_TOKEN || '\u0000').join('***').split(MCP_TOKEN).join('***');
if (REMOTE) {
  // git authenticates with a header from the environment: the token never lands in a URL, file or log line
  const basic = Buffer.from(`x-access-token:${GITHUB_TOKEN}`).toString('base64');
  Object.assign(process.env, {
    GIT_TERMINAL_PROMPT: '0',
    GIT_CONFIG_COUNT: '3',
    GIT_CONFIG_KEY_0: 'http.https://github.com/.extraheader', GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${basic}`,
    GIT_CONFIG_KEY_1: 'user.name', GIT_CONFIG_VALUE_1: process.env.GIT_AUTHOR_NAME || 'Infinity Konten MCP',
    GIT_CONFIG_KEY_2: 'user.email', GIT_CONFIG_VALUE_2: process.env.GIT_AUTHOR_EMAIL || '354822107+anggunn2701-oss@users.noreply.github.com',
  });
  const dir = process.env.WORKDIR || path.join(os.tmpdir(), 'infinity-site');
  fs.rmSync(dir, { recursive: true, force: true });
  console.log(`Clone ${REPO}#${BRANCH} ...`);
  execFileSync('git', ['clone', '--depth', '50', '--branch', BRANCH, `https://github.com/${REPO}.git`, dir], { stdio: 'inherit' });
  process.env.INFINITY_SITE_ROOT = dir;
}
if (!REMOTE) {
  if (!process.env.SITE_DIR) {
    console.error('GITHUB_TOKEN belum diisi. Di Railway tambahkan variabel GITHUB_TOKEN: fine-grained token GitHub dengan akses ke repo ' + REPO + ', permission Contents: Read and write. (SITE_DIR hanya untuk tes lokal tanpa GitHub.)');
    process.exit(1);
  }
  process.env.INFINITY_SITE_ROOT = path.resolve(process.env.SITE_DIR);
}
const { handleMessage, git } = require(path.join(process.env.INFINITY_SITE_ROOT, 'mcp', 'core.js'));

/* Before each tool call: stay in step with GitHub. Never discard unpublished drafts. */
const READ_ONLY = new Set(['site_overview', 'list_posts', 'get_post', 'get_homepage', 'list_testimonial_videos', 'list_alumni', 'review_changes']);
function beforeCall(name) {
  if (name === 'publish' && !REMOTE) throw new Error('Publish dimatikan di mode lokal (tanpa GITHUB_TOKEN).');
  if (!REMOTE) return;
  try {
    if (name === 'publish') { git('pull', '--rebase', '--autostash', 'origin', BRANCH); return; }
    if (!git('status', '--porcelain').trim()) git('pull', '--ff-only', 'origin', BRANCH);
  } catch (e) {
    if (!READ_ONLY.has(name)) throw new Error(`Gagal sinkron dengan GitHub: ${redact(e.stderr || e.message)}`);
  }
}

/* ---------- HTTP ---------- */
const tokenOk = (given) => {
  const a = Buffer.from(String(given || '')), b = Buffer.from(MCP_TOKEN);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, Accept, Mcp-Session-Id, MCP-Protocol-Version',
  'Access-Control-Expose-Headers': 'Mcp-Session-Id',
};
const json = (res, status, body, extra = {}) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...CORS, ...extra });
  res.end(body === undefined ? undefined : JSON.stringify(body));
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (req.method === 'OPTIONS') { res.writeHead(204, CORS); return res.end(); }
  if (url.pathname === '/healthz') return json(res, 200, { ok: true, mode: REMOTE ? 'github' : 'local' });
  if (url.pathname === '/') return json(res, 200, { name: 'infinity-konten', mcp_endpoint: '/mcp', auth: 'Authorization: Bearer <MCP_TOKEN>' });

  const m = url.pathname.match(/^\/mcp(?:\/([^/]+))?\/?$/);
  if (!m) return json(res, 404, { error: 'not found' });
  const bearer = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!tokenOk(m[1] || bearer)) return json(res, 401, { error: 'unauthorized' }, { 'WWW-Authenticate': 'Bearer' });

  if (req.method === 'GET') return json(res, 405, { error: 'SSE stream tidak dipakai; kirim POST.' }, { Allow: 'POST, DELETE' });
  if (req.method === 'DELETE') { res.writeHead(204, CORS); return res.end(); }
  if (req.method !== 'POST') return json(res, 405, { error: 'method not allowed' });

  let size = 0; const chunks = [];
  req.on('data', (c) => { size += c.length; if (size > MAX_BODY) { req.destroy(); } else chunks.push(c); });
  req.on('end', () => {
    let msg;
    try { msg = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return json(res, 400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }); }
    const batch = Array.isArray(msg) ? msg : [msg];
    const out = [];
    let sessionHeader = {};
    for (const one of batch) {
      if (one && one.method === 'tools/call') console.log(`${new Date().toISOString()} tool ${one.params && one.params.name}`);
      const r = handleMessage(one, { beforeCall });
      if (r) {
        if (r.result && r.result.content) r.result.content.forEach((c) => { if (c.text) c.text = redact(c.text); });
        if (r.error) r.error.message = redact(r.error.message);
        out.push(r);
      }
      if (one && one.method === 'initialize') sessionHeader = { 'Mcp-Session-Id': crypto.randomUUID() };
    }
    if (!out.length) { res.writeHead(202, CORS); return res.end(); }   // notifications only
    json(res, 200, Array.isArray(msg) ? out : out[0], sessionHeader);
  });
});

server.listen(PORT, () => console.log(`Infinity Konten MCP (${REMOTE ? `GitHub ${REPO}` : 'lokal'}) di port ${PORT}, endpoint /mcp`));
