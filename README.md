<p align="center">
  <img src="dashboard/public/Autoclaw.png" alt="Autoclaw" width="160">
</p>

<h1 align="center">AutoClaw / Z.ai Gateway</h1>

<p align="center">
  Proxy lokal OpenAI- dan Anthropic-compatible.
</p>

Dua backend:

- **autoclaw** (default) — memakai credit AutoClaw lewat vault-nya; AutoClaw harus hidup.
- **zai** — memanggil `api.z.ai` langsung dengan `ZAI_API_KEY`, tanpa vault maupun identity shim AutoClaw.

Source proxy di-vendor di `vendor/glmproxy` supaya aman dari `npm install` dan bisa
dipatch. Dashboard operasi berjalan terpisah di `dashboard/`.

## Arsitektur

```
klien (opencode/omp) ──► 127.0.0.1:18791  OpenAI    ┐
                     ──► 127.0.0.1:18792  Anthropic ┤─► AutoClaw / Z.ai
dashboard 127.0.0.1:18793 ── baca /status, tulis config.json + keys.json
```

- Antrean dan governor berjalan **per proses**. Dua lane memakai akun AutoClaw
  yang dipilih di dashboard, jadi budget 300 request/jam efektif berlaku untuk
  gabungan keduanya.
- Dashboard hanya membaca state lewat `/status`; ia tidak meneruskan traffic model.

## Start / Stop

```cmd
:: pastikan semua hidup (AutoClaw bila perlu, 18791, 18792, 18793)
cscript //nologo D:\ToolsAI\glmproxy\start-proxy-hidden.vbs
:: atau versi berjendela
D:\ToolsAI\glmproxy\start-proxy.cmd
```

```powershell
# status watchdog
Get-ScheduledTask -TaskName 'Autoclaw-Watchdog' | Select TaskName,State
Start-ScheduledTask -TaskName 'Autoclaw-Watchdog'

# stop (proxy + dashboard saja, node lain jangan ikut)
Get-NetTCPConnection -LocalPort 18791,18792,18793 -State Listen |
  ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }
```

Scheduled Task **`Autoclaw-Watchdog`** jalan tiap 2 menit: menyalakan AutoClaw
(hanya bila backend `autoclaw`), lalu mengisi port yang mati. Log: `logs\watchdog.log`.

Script npm:

```cmd
npm start              :: watchdog
npm run start:openai   :: hanya lane OpenAI (foreground)
npm run start:anthropic
npm run dashboard      :: dashboard di 18793
npm run check          :: syntax check semua file yang dipatch
```

## Endpoint + Key

| Format | URL | Key |
|---|---|---|
| OpenAI (`/v1/chat/completions`) | `http://127.0.0.1:18791/v1` | `akuganteng` (operator) |
| Anthropic (`/v1/messages`) | `http://127.0.0.1:18792` | `akuganteng` (operator) |
| Dashboard | `http://127.0.0.1:18793` | loopback, tanpa login |
| Status OpenAI | `http://127.0.0.1:18791/status` | operator |
| Stats per key | `http://127.0.0.1:18791/stats` | key klien itu sendiri |

`PROXY_KEY` = kunci operator: selalu diterima dan **tidak** terkena kuota per key
(governor akun tetap berlaku). Kunci klien ada di `keys.json`.

`/healthz` juga memerlukan key (middleware auth berlaku untuk semua route).

### Header tambahan

| Header | Nilai | Efek |
|---|---|---|
| `X-Queue-Priority` | `interactive`, `normal` (default), `background` | request `interactive` menyalip antrean `background`/`normal` |
| `Authorization` | `Bearer <key>` | operator atau kunci klien |
| `x-api-key` | `<key>` | alternatif untuk Anthropic |

### Route admin

| Route | Keterangan |
|---|---|
| `GET /status` | snapshot lengkap; token/secret disamarkan, daftar kunci hanya untuk operator |
| `GET /stats` | pemakaian key pemanggil: window, limit, total, token, status terakhir |
| `POST /admin/reload` | baca ulang `config.json` tanpa restart (operator) |

### Dashboard

Menu **Upstream** memuat kapasitas governor dan status kedua jalur. **Health**
menguji token dan saldo semua akun AutoClaw. **Dokumentasi API** menampilkan base
URL, endpoint, dan katalog model aktif.

**Tambah akun** hanya memakai **Login dengan Z.ai**. Login Z.ai membuka halaman
captcha Aliyun, meminta URL OAuth bertanda tangan ke AutoClaw, lalu menangkap
callback di salah satu port loopback resmi (`18432`, `19654`, `19723`, `53699`).
Token hasil tukar kode disimpan terenkripsi di
`proxy-state/managed-accounts.enc`; browser tidak pernah menerima token.

## config.json

Semua setting bisa lewat environment (menang) atau `config.json`. File ditulis
dashboard secara atomik lalu di-reload ke kedua lane. Contoh lengkap:
`config.example.json`. Field yang bisa diubah saat runtime:

`GLMP_BACKEND`, `ZAI_API_KEY`, `ZAI_BASE_URL`, `ZAI_DEFAULT_MODEL`,
`ZAI_MODEL_OPUS`, `ZAI_MODEL_SONNET`, `ZAI_MODEL_HAIKU`,
`BUDGET_REQUESTS_PER_HOUR`, `MIN_GAP_MS`, `GLMP_QUEUE_MAX_DEPTH`,
`GLMP_QUEUE_WAIT_MS`, `MAX_MESSAGES`, `UPSTREAM_TIMEOUT_MS`,
`GLMP_THROTTLE_RETRIES`, `GLMP_THROTTLE_RETRY_MS`, `HEARTBEAT_INTERVAL_MS`,
`GLMP_KEY_WINDOW_HOURS`, `GLMP_AUTOCLAW_ACCOUNT`. `GLMP_AUTOCLAW_ACCOUNT` berisi
nama folder akun di vault AutoClaw; kosong berarti memakai vault terbaru.

Butuh restart: `PORT`, `HOST`, `UPSTREAM_HOST`, `UPSTREAM_PORT`, `PROXY_KEY`.

Nama environment asli yang dipakai kode: `GLMP_MIN_GAP_MS` dibaca sebagai
`MIN_GAP_MS`, `GLMP_THROTTLE_RETRIES` → `THROTTLE_RETRIES`, dst. `config.json`
memakai nama environment agar konsisten dengan dokumentasi lama.

## Backend Z.ai

```powershell
$env:GLMP_BACKEND = 'zai'
$env:ZAI_API_KEY  = '...'
```

- `ZAI_API_KEY` saja (tanpa `GLMP_BACKEND`) otomatis memilih backend `zai`.
- `GLMP_BACKEND=autoclaw` memaksa AutoClaw walau `ZAI_API_KEY` terisi.
- Pada backend `zai`, watcher token/identity/shape AutoClaw dan prompt shaping
  dilewati. `ZAI_BASE_URL` default `https://api.z.ai/api/paas/v4/chat/completions`.
- Tanpa key: `/healthz` = `no_token`, request model = `503 no_api_key`
  (bukan crash).
- Pemetaan tier Anthropic: `ZAI_MODEL_OPUS`, `ZAI_MODEL_SONNET` (default
  `zaicoding_glm-5.3`), `ZAI_MODEL_HAIKU` (default `zai_glm-5.3-flash`).

## Kunci klien + kuota

`keys.json` (dibuat/diubah lewat dashboard):

```json
{
  "keys": [
    {
      "key": "pk_<32 hex>",
      "name": "laptop-2",
      "model": "zai_glm-5.3-flash",
      "requestsPerHour": 60,
      "enabled": true,
      "createdAt": "2026-11-09T00:00:00.000Z"
    }
  ]
}
```

- `model` = pin model untuk key itu (request dengan model lain ditolak/dipetakan
  sesuai lane); `null` = bebas.
- `requestsPerHour` = 0 berarti tanpa batas per key.
- Kuota memakai sliding window `GLMP_KEY_WINDOW_HOURS` (default 1 jam), dihitung
  saat request diterima — termasuk request yang nanti gagal di upstream.
- Habis kuota: HTTP `429`, body `key_quota_exceeded`, header `Retry-After` dalam
  detik. Governor akun bisa juga menghasilkan `429 budget_exceeded`.
- Pemakaian disimpan di `keys-usage.json` di state dir; `reset` lewat dashboard
  menghapus hitungan key tersebut.
- Perubahan `keys.json` otomatis terbaca (mtime), tanpa restart.

## Antrean

AutoClaw hanya mengizinkan satu generasi aktif. `InFlightQueue` global:

- prioritas `interactive` > `normal` > `background`, FIFO di dalam prioritas;
- `GLMP_QUEUE_MAX_DEPTH` (default 50): penuh → `429 queue_overflow`;
- `GLMP_QUEUE_WAIT_MS` (default 0 = tanpa batas): menunggu terlalu lama →
  `503 queue_timeout`.

## Dashboard

`http://127.0.0.1:18793` — hanya loopback (`DASHBOARD_HOST` bisa mengubah bind,
tapi jangan diekspos ke LAN). Halaman: Ringkasan (`/`), Akun (`/accounts`),
Kunci (`/keys`), Request (`/requests`), Pengaturan (`/settings`), Log (`/logs`).
Semua rute memakai History API dengan fallback server, jadi refresh langsung
tetap bekerja.

- Ringkasan: kartu total akun, akun aktif, total poin, request, token, estimasi
  biaya, daftar akun dengan check-in semua, delapan request terakhir, tekanan
  kuota kunci;
- Akun: akun dashboard hasil OAuth Z.ai dan akun vault AutoClaw yang punya
  kredensial, saldo/poin tiap akun, akun aktif, tombol jadikan aktif, ubah nama,
  hapus akun dashboard, salin link/ID. ID panjang dipendekkan di tampilan tapi
  nilai penuh tetap tersalin lewat tombol Salin ID;
- Kunci: kuota, total, terakhir dipakai; tambah/nonaktifkan/reset/hapus; nilai
  kunci hanya tampil sekali saat dibuat;
- Request: aliran kedua lane, strip outcome, filter semua/sukses/rate limit/error;
- Pengaturan: form ditulis ke `config.json`, lalu `/admin/reload` kedua lane;
- Log: tail berkas di `logs\`, pilihan ikuti ujung;
- Bahasa: tombol ID/EN di sidebar; pilihan disimpan di browser dan berlaku untuk
  label, pesan status, serta format angka/tanggal.

Akun aktif disimpan sebagai `GLMP_AUTOCLAW_ACCOUNT` di `config.json` (akun
vault) atau sebagai `activeId` di store dashboard, lalu dipakai kedua lane
setelah reload. Tombol **Tambah akun** membuka OAuth Z.ai dengan captcha
Aliyun; akun vault tanpa kredensial tidak ditampilkan di daftar. Ringkasan
menampilkan total akun, akun aktif, total poin, request, token, dan aksi
check-in semua akun.

Akun dashboard memakai token OAuth Z.ai sendiri dan tidak memerlukan aplikasi
AutoClaw desktop; akun vault tetap memerlukan AutoClaw karena tokennya dibaca
dari vault lokal. Akun dashboard disimpan terpisah dari vault di
`proxy-state\managed-accounts.enc`. Di Windows file dienkripsi dengan DPAPI
CurrentUser; di POSIX dipakai AES-256-GCM dengan kunci
`proxy-state\managed-accounts.key` (mode 0600). Token tidak pernah dikirim ke
browser. Dashboard me-refresh token akun aktif tiap 10 menit dan tidak
fallback ke akun lain saat token akun dashboard kedaluwarsa. Memilih akun
dashboard mengosongkan `GLMP_AUTOCLAW_ACCOUNT`; memilih akun vault
mengosongkan pilihan dashboard. Saldo dibaca dari endpoint wallets AutoClaw
dan di-cache 5 menit. Footer kiri bawah menampilkan akun yang benar-benar
dipakai token lane saat ini.

Keamanan:

- server tidak pernah mengembalikan bearer token, client key asli, atau
  `ZAI_API_KEY`; key klien disamarkan (`pk_abcd...wxyz`);
- `config.json` menyimpan `ZAI_API_KEY` sebagai teks biasa (lokal, sudah
  di-gitignore). Lindungi file itu seperti kredensial lain;
- `proxy-state\` berisi token akun dashboard terenkripsi. Jangan menyalin atau
  meng-commit folder itu;
- dashboard menganggap semua proses lokal tepercaya: siapa pun yang bisa
  membuka `127.0.0.1:18793` bisa mengubah setting. Jangan bind ke LAN;
- semua mutasi (`PUT`/`POST`/`PATCH`/`DELETE`) wajib header `X-Dashboard: 1`
  (mencegah CSRF dari halaman lain);
- CSP `default-src 'self'`, tanpa inline script/style;
- dashboard memakai `PROXY_KEY` (env, atau `config.json`, fallback `akuganteng`)
  untuk membaca `/status`. Ganti `PROXY_KEY` di ketiga proses bila perlu.

## Pengaman yang jangan diubah tanpa alasan

- Budget akun: **300 request/jam** (`BUDGET_REQUESTS_PER_HOUR`) + jeda min 250 ms.
- AutoClaw hanya satu generasi aktif; jangan paksa paralel.
- Kode error AutoClaw: `403` + `410004` = ban permanen; `403` + `810002` =
  throttle (retry otomatis).
- `GLMP_IDENTITY_VERSION=2.0.3` dipin; naikkan kalau AutoClaw update.
- Jangan mengubah vault DPAPI AutoClaw, prompt quarantine, atau identity shaping.

## File

- `vendor\glmproxy\` — source proxy (jangan diedit lewat `node_modules`)
- `dashboard\server.js`, `dashboard\public\` — panel operasi
- `proxy-state\` — store akun dashboard terenkripsi (runtime, tidak di-commit)
- `watchdog.ps1` — penjaga AutoClaw + 3 port (dipanggil Scheduled Task)
- `start-proxy.cmd`, `start-proxy-hidden.vbs`, `start-openai.cmd`,
  `start-anthropic.cmd` — semua delegasi ke watchdog
- `config.example.json` — contoh konfigurasi runtime
- `logs\openai.log`, `logs\anthropic.log`, `logs\dashboard.log`,
  `logs\watchdog.log`
