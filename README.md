# Infinity Konten MCP (remote)

MCP server lewat HTTPS untuk mengedit isi website **Bimbel Infinity** (https://bimbelinfinity.com) dari Grok, Muse, dan bot AI lain.

- Transport: **MCP Streamable HTTP** (balasan JSON, tanpa SSE).
- Saat start, server meng-clone repo website (`anggunn2701-oss/bimbel-infinity-website`) dan memakai tools dari `mcp/core.js` di repo itu. Tools cukup dirawat di repo website; service ini tinggal di-restart untuk memakai versi terbaru.
- Tools mengedit `content/*.json`, membangun ulang situs, dan `publish` mem-push ke GitHub; service website di Railway deploy ulang sendiri.

## Deploy di Railway

1. **Token GitHub**: GitHub → Settings → Developer settings → Personal access tokens → **Fine-grained token**.
   - Repository access: *Only select repositories* → `bimbel-infinity-website` (repo website, bukan repo ini).
   - Permissions → Repository → **Contents: Read and write**.
2. **Token MCP**: string acak panjang, "kata sandi" untuk bot:
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```
3. Railway → project website → **+ New → GitHub Repo → `infinity-konten-mcp`**. Railway membaca `railway.json` (Dockerfile, health check `/healthz`).
4. **Variables**:
   | Nama | Isi |
   |---|---|
   | `MCP_TOKEN` | token MCP (wajib, minimal 24 karakter) |
   | `GITHUB_TOKEN` | token GitHub (wajib) |
   | `GITHUB_REPO` | opsional, default `anggunn2701-oss/bimbel-infinity-website` |
   | `GIT_BRANCH` | opsional, default `main` |
5. **Settings → Networking → Generate Domain**, atau custom domain `mcp.bimbelinfinity.com` (CNAME di Cloudflare, DNS only).
6. Cek `https://<domain>/healthz` → `{"ok":true,"mode":"github"}`.

## Menyambungkan bot

- **Server URL**: `https://<domain>/mcp`
- **Header**: `Authorization: Bearer <MCP_TOKEN>`
- Bot yang hanya menerima URL: `https://<domain>/mcp/<MCP_TOKEN>` (rahasiakan seperti kata sandi).

Tes dari terminal:
```bash
curl -s https://<domain>/mcp -H "Authorization: Bearer <MCP_TOKEN>" -H "Content-Type: application/json" -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

Alur untuk bot: `site_overview` → edit (`save_post`, `update_hero`, `set_homepage_faq`, `update_program`, `save_testimonial_video`, `update_alumni`, …) → `build_site` → `review_changes` → `publish` dengan `confirm: true`.

## Menjalankan lokal (tes)

```bash
SITE_DIR=../path/ke/website MCP_TOKEN=<token-tes> node server.js
```
Tanpa `GITHUB_TOKEN`, server memakai folder website lokal dan `publish` dimatikan.

## Keamanan

- Siapa pun yang memegang `MCP_TOKEN` bisa mengubah dan menerbitkan isi website. Ganti di Railway kapan saja.
- Token GitHub dibatasi ke repo website dan izin Contents; dipakai lewat header git dari environment, tidak pernah ditulis ke URL, file, atau log; balasan tool disensor dari kedua token.
- Draf yang belum di-publish tersimpan di container dan hilang saat restart.
- Setiap publish adalah commit biasa di repo website, jadi bisa di-revert.
