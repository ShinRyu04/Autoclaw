<p align="center">
  <img src="dashboard/public/autoclaw-readme.png" alt="Autoclaw" width="180">
</p>

<h1 align="center">Autoclaw</h1>

<p align="center">
  Local OpenAI- and Anthropic-compatible gateway with a bilingual operations dashboard.
</p>

<p align="center">
  <a href="https://github.com/ShinRyu04/Autoclaw/releases/latest"><img src="https://img.shields.io/github/v/release/ShinRyu04/Autoclaw?label=release" alt="Latest release"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-green" alt="MIT license"></a>
  <a href="package.json"><img src="https://img.shields.io/badge/node-%3E%3D20-informational" alt="Node.js 20 or newer"></a>
</p>

Autoclaw puts a stable OpenAI- and Anthropic-compatible HTTP face in front of
AutoClaw credits or the Z.ai API. Two Node.js lanes serve the model traffic,
and a separate dashboard process handles accounts, client keys, live requests,
health checks and logs.

The proxy source lives at the repository root (`bin/`, `lib/`, `openai.js`,
`anthropic.js`), based on GLMproxy 3.3.x with the patches required by the
dashboard. The dashboard lives in `dashboard/` and talks to the lanes only over
loopback HTTP; it never relays model traffic.

Nothing here bypasses billing. The `autoclaw` backend uses the account the
AutoClaw desktop app already owns. The `zai` backend calls the public Z.ai
API with your own key.

## Features

- **Two backends** — `autoclaw` reads AutoClaw vault or dashboard OAuth
  credentials; `zai` calls `api.z.ai` directly with `ZAI_API_KEY`.
- **Two wire formats** — `POST /v1/chat/completions` on port `18791` and
  `POST /v1/messages` on port `18792`, plus `/v1/models`, `/status`, `/stats`
  and `/healthz`.
- **Shared account governor** — one active AutoClaw generation at a time,
  300 requests/hour by default, a 250 ms minimum dispatch gap, and persisted
  window state across restarts.
- **Queue priorities** — `interactive`, `normal` and `background`, FIFO inside
  each priority, with depth and wait limits.
- **Per-key quotas** — client keys can pin a model, cap requests per sliding
  hour, be disabled, reset or deleted. The operator key is never metered as a
  client key.
- **Operations dashboard** — overview, accounts, keys, request stream,
  upstream capacity, account health, model/API reference, settings and logs.
  A compact ID/EN switch translates labels, dynamic status text, native
  dialogs and number/date formats; the choice is stored per browser.
- **Account manager** — dashboard accounts from Z.ai OAuth (Aliyun captcha) and
  vault accounts backed by AutoClaw credentials, with credits, active-account
  selection, rename, delete, check-in and token refresh.
- **Runtime settings** — most limits are written to `config.json` and reloaded
  into both lanes through `/admin/reload`; the dashboard does this without a
  restart.
- **Operational hardening** — dashboard mutations require `X-Dashboard: 1`,
  responses use a strict CSP, secrets are masked, and a Windows watchdog keeps
  AutoClaw and all three ports alive.
- **No build step** — plain Node.js ESM and static HTML/CSS/JS. `npm run check`
  syntax-checks every patched file.

## Requirements

- Windows 10 or 11 for the bundled watchdog and Task Scheduler integration.
  The lanes and dashboard run on Linux and macOS too; only the Watchdog and
  AutoClaw auto-launch are Windows-specific. AutoClaw vault decryption supports
  Windows DPAPI, Linux Secret Service and the macOS Keychain; install the
  AutoClaw desktop app separately on those systems.
- Node.js 20 or newer.
- AutoClaw desktop for vault-backed accounts. Dashboard OAuth accounts do not
  need the desktop app; the `zai` backend does not either.
- A `ZAI_API_KEY` when using the `zai` backend.

## Quick Start

```cmd
git clone https://github.com/ShinRyu04/Autoclaw.git
cd Autoclaw
npm run check
copy config.example.json config.json
```

A fresh clone has no `config.json`, `keys.json`, or logs. Edit `config.json`
for your backend, then set a private operator key:

```cmd
set GLMP_BACKEND=zai
set ZAI_API_KEY=your-zai-key
set PROXY_KEY=choose-a-strong-key
npm start
```

`npm start` runs `watchdog.ps1`. On the `zai` backend it does not need
AutoClaw. On the `autoclaw` backend it starts AutoClaw when the executable is
available (set `AUTOCLAW_EXE` if it is not at the default path), then fills any
missing lane or dashboard port. Open `http://127.0.0.1:18793` for the
dashboard.

For a windowed launcher, run `start-proxy.cmd`. For a hidden launcher, run:

```cmd
cscript //nologo start-proxy-hidden.vbs
```

The watchdog is Windows-only. On macOS, Linux, or a manual Windows setup, run
the three processes in separate terminals:

```sh
export GLMP_BACKEND=zai
export ZAI_API_KEY=your-zai-key
export PROXY_KEY=choose-a-strong-key
npm run start:openai
```

```sh
export GLMP_BACKEND=zai
export ZAI_API_KEY=your-zai-key
export PROXY_KEY=choose-a-strong-key
npm run start:anthropic
```

```sh
export PROXY_KEY=choose-a-strong-key
npm run dashboard
```

Use the same `PROXY_KEY` in all three terminals. There are no runtime npm
dependencies, so `npm install` is not required. The default operator key is
`akuganteng` when `PROXY_KEY` is unset; set it before exposing any port. The
lanes and dashboard read the same value. The `autoclaw` backend additionally
needs the AutoClaw desktop app and its vault on Windows.

## Ports and Endpoints

| Service | URL | Credential |
|---|---|---|
| OpenAI lane | `http://127.0.0.1:18791/v1` | operator or client key |
| Anthropic lane | `http://127.0.0.1:18792` | operator or client key |
| Dashboard | `http://127.0.0.1:18793` | loopback only, no login |
| OpenAI status | `http://127.0.0.1:18791/status` | operator key |
| Per-key stats | `http://127.0.0.1:18791/stats` | that client key |
| Health | `http://127.0.0.1:18791/healthz` | operator or client key |

### Model routes

| Route | Dialect | Notes |
|---|---|---|
| `POST /v1/chat/completions` | OpenAI | streaming and non-streaming, tools, model mapping |
| `POST /v1/messages` | Anthropic | streaming and non-streaming, tools, system blocks |
| `GET /v1/models` | both | active model catalog for the current backend |
| `GET /status` | — | full runtime snapshot; secrets masked |
| `GET /stats` | — | usage for the calling key: window, limit, totals, tokens, last status |
| `GET /healthz` | — | credential and lane health |

### Admin routes

| Route | Method | Purpose |
|---|---|---|
| `/admin/reload` | `POST` | re-read `config.json` and `keys.json` in both lanes |
| `/status` | `GET` | operator-only status snapshot |
| `/stats` | `GET` | caller-scoped quota and usage |

Admin mutations require the operator key. On the dashboard side, every
mutation also requires `X-Dashboard: 1`.

## Integrations

The examples use the default operator key `akuganteng`. Replace it with your
own `PROXY_KEY` before exposing either port.

### Claude Code CLI and Anthropic API

Add this to `~/.claude/settings.json` (on Windows,
`%USERPROFILE%\.claude\settings.json`):

```json
{
  "env": {
    "ANTHROPIC_BASE_URL": "http://127.0.0.1:18792",
    "ANTHROPIC_AUTH_TOKEN": "akuganteng"
  }
}
```

Or let the proxy write the settings: run `node bin/cli.js`, choose the
Anthropic surface, then choose **Launch Claude Code with <model>**. The launcher
writes a settings file into the proxy state directory, passes it through
`claude --settings` when the client supports it, waits for `/healthz`, and
hands the terminal to the interactive client. The gateway stays up when Claude
Code exits. Set `GLMP_CLAUDE_BIN` when `claude` is not on `PATH`.

Claude Agent SDK and direct `/v1/messages` calls support streaming SSE,
thinking blocks and tool use without restrictions.

Claude Code CLI interactive and print mode work on AutoClaw 2.x through the
identity guard. Claude Code names itself in its system prompt, and the upstream
gate rejects foreign harness signatures with a bare `406`; the guard
(`GLMP_FOREIGN_IDENTITY_GUARD`, on by default) rewrites those phrases before
forwarding. With the guard off, the unmodified prompt is rejected on 2.x. The
system quarantine (`GLMP_SYSTEM_QUARANTINE`, on by default) catches that `406`,
moves the harness text to user scope and retries immediately.

Upstream 4.x requires the account JWT in **both** `Authorization` and
`X-Authorization` (same value). `X-Authorization` alone is answered with a bare
`406`; `Authorization` alone with `401 {"error":"Invalid token"}`. The proxy
sends both on every chat completion.

```sh
claude -p "Explain the codebase architecture"
```

Anthropic SDK:

```python
from anthropic import Anthropic

client = Anthropic(
    base_url="http://127.0.0.1:18792",
    api_key="akuganteng",
)
message = client.messages.create(
    model="zaicoding_glm-5.3",
    max_tokens=1024,
    messages=[{"role": "user", "content": "hello"}],
)
print(message.content[0].text)
```

### OpenCode

Add a custom provider to the OpenCode configuration:

```json
{
  "provider": {
    "autoclaw": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "Autoclaw",
      "options": {
        "baseURL": "http://127.0.0.1:18791/v1",
        "apiKey": "akuganteng"
      },
      "models": {
        "zai_auto": { "name": "Autoclaw Auto" },
        "zai_auto-fast": { "name": "Autoclaw Auto-Fast" },
        "zaicoding_glm-5.3": { "name": "Autoclaw GLM-5.3" },
        "zai_glm-5.3-flash": { "name": "Autoclaw GLM-5.3 Flash" },
        "zai_glm-5.3-flashx-legal": { "name": "Autoclaw GLM-5.3 FlashX-Legal" }
      }
    }
  }
}
```

### Cursor, Continue and other OpenAI-compatible clients

Point the client at `http://127.0.0.1:18791/v1` with the operator or a client
key. Clients that probe `/v1/models` discover the active catalog automatically.

For a custom model in a UI:

| Field | Value |
|---|---|
| API format | OpenAI Chat Completions |
| URL | `http://127.0.0.1:18791/v1` |
| Model ID | `zai_auto` or any ID from `GET /v1/models` |
| API key | `akuganteng` or a client key |

### Python

Streaming with the OpenAI SDK:

```python
from openai import OpenAI

client = OpenAI(
    base_url="http://127.0.0.1:18791/v1",
    api_key="akuganteng",
)

with client.chat.completions.stream(
    model="zai_auto",
    messages=[{"role": "user", "content": "Hello!"}],
) as stream:
    for text in stream.text_stream:
        print(text, end="", flush=True)
```

Non-streaming:

```python
response = client.chat.completions.create(
    model="zaicoding_glm-5.3",
    messages=[{"role": "user", "content": "hello"}],
)
print(response.choices[0].message.content)
```

### JavaScript

```javascript
import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "http://127.0.0.1:18791/v1",
  apiKey:  "akuganteng",
});

const stream = await client.chat.completions.create({
  model:    "zai_auto",
  messages: [{ role: "user", content: "Hello!" }],
  stream:   true,
});

for await (const chunk of stream) {
  process.stdout.write(chunk.choices[0]?.delta?.content ?? "");
}
```

### curl

```sh
curl -s http://127.0.0.1:18791/v1/chat/completions \
  -H 'content-type: application/json' \
  -H 'authorization: Bearer akuganteng' \
  -d '{"model":"zai_auto","messages":[{"role":"user","content":"ping"}]}'
```

### Request headers

| Header | Value | Effect |
|---|---|---|
| `Authorization` | `Bearer <key>` | operator or client key |
| `x-api-key` | `<key>` | Anthropic-style alternative |
| `X-Queue-Priority` | `interactive`, `normal`, `background` | interactive bypasses background and normal work |

The operator key is accepted on every inference route and does not consume a
client-key quota. Client keys are created in the dashboard and stored in
`keys.json`.

## Dashboard

`http://127.0.0.1:18793` is loopback-only by default. `DASHBOARD_HOST` can
change the bind address, but do not expose it to a LAN without your own
authentication layer.

| Page | What it shows |
|---|---|
| Overview | account, point, request, token and cost totals; recent requests; key-quota pressure |
| Accounts | OAuth and vault accounts, credits, active account, rename, delete, check-in, copy ID |
| Keys | per-key quota, model pin, usage, enable/disable, reset and delete |
| Requests | both lanes, outcome strip, filters for success, rate limit and error |
| Upstream | governor capacity, effective limits and lane state |
| Health | token and credit checks across every AutoClaw account |
| API docs | base URLs, endpoints, headers and the active model catalog |
| Settings | runtime fields written to `config.json`, then reloaded into both lanes |
| Logs | tails from `logs/`, with follow mode |

The sidebar language switch toggles Indonesian and English. Labels, dynamic
status messages, prompts, confirms, dates and numbers follow the selected
language. Model IDs, key values and log bodies are never translated.

Dashboard APIs:

| Route | Method | Purpose |
|---|---|---|
| `/api/status` | `GET` | dashboard summary and lane snapshots |
| `/api/docs` | `GET` | API documentation payload |
| `/api/health` | `GET` | cached account health |
| `/api/health/run` | `POST` | run a fresh account health check |
| `/api/accounts` | `GET` | dashboard and vault accounts with credits |
| `/api/accounts/active` | `POST` | select the active account |
| `/api/accounts/checkin` | `POST` | check in every account |
| `/api/accounts/m_<id>` | `PATCH`, `DELETE` | rename or remove a dashboard account |
| `/api/keys` | `GET`, `POST` | list or create client keys |
| `/api/keys/:id` | `PATCH`, `DELETE` | edit or delete a key |
| `/api/keys/:id/reset` | `POST` | reset one key's usage |
| `/api/config` | `GET`, `PUT` | read or patch runtime settings |
| `/api/logs?name=&lines=` | `GET` | tail a log file |
| `/api/oauth/zai/config` | `GET` | OAuth/captcha configuration |
| `/api/oauth/zai/start` | `POST` | start a Z.ai OAuth login |

## Backends

### autoclaw

The default. The lane reads credentials from the AutoClaw vault or from an
account connected through the dashboard. The selected account is shared by
both lanes, so the hourly account budget covers the sum of their traffic.

Set a specific vault account with `GLMP_AUTOCLAW_ACCOUNT`; an empty value uses
the newest vault. Selecting a dashboard account clears the vault selection;
selecting a vault account clears the dashboard selection.

### zai

Direct Z.ai API access, with no vault, no AutoClaw identity shim and no
desktop app requirement:

```powershell
$env:GLMP_BACKEND = 'zai'
$env:ZAI_API_KEY  = '...'
```

- Setting `ZAI_API_KEY` without `GLMP_BACKEND` selects the `zai` backend.
- `GLMP_BACKEND=autoclaw` forces AutoClaw even when a Z.ai key exists.
- Without a key, `/healthz` returns `no_token` and model requests return
  `503 no_api_key`.
- Anthropic tiers map through `ZAI_MODEL_OPUS`, `ZAI_MODEL_SONNET`
  (default `zaicoding_glm-5.3`) and `ZAI_MODEL_HAIKU`
  (default `zai_glm-5.3-flash`).
- `ZAI_BASE_URL` defaults to
  `https://api.z.ai/api/paas/v4/chat/completions`.

## Configuration

Settings resolve from the environment first, then `config.json`. The dashboard
writes atomic updates to `config.json` and reloads both lanes. A full example
is in `config.example.json`.

Runtime fields:

| Variable | Default | Purpose |
|---|---|---|
| `GLMP_BACKEND` | `autoclaw` | backend selection: `autoclaw` or `zai` |
| `ZAI_API_KEY` | empty | Z.ai API credential |
| `ZAI_BASE_URL` | `https://api.z.ai/api/paas/v4/chat/completions` | Z.ai chat endpoint |
| `ZAI_DEFAULT_MODEL` | `zaicoding_glm-5.3` | default model for the zai backend |
| `ZAI_MODEL_OPUS` | `zaicoding_glm-5.3` | Anthropic opus-tier mapping |
| `ZAI_MODEL_SONNET` | `zaicoding_glm-5.3` | Anthropic sonnet-tier mapping |
| `ZAI_MODEL_HAIKU` | `zai_glm-5.3-flash` | Anthropic haiku-tier mapping |
| `BUDGET_REQUESTS_PER_HOUR` | `300` | account budget; `0` disables pacing |
| `MIN_GAP_MS` / `GLMP_MIN_GAP_MS` | `250` | minimum gap between upstream dispatches |
| `GLMP_QUEUE_MAX_DEPTH` | `50` | queue depth before `429 queue_overflow` |
| `GLMP_QUEUE_WAIT_MS` | `0` | maximum queue wait; `0` means no limit |
| `MAX_MESSAGES` | `0` | message cap per request; `0` means unlimited |
| `UPSTREAM_TIMEOUT_MS` | `300000` in this repo | per-attempt upstream deadline |
| `GLMP_THROTTLE_RETRIES` | `3` | in-request retries for upstream throttles |
| `GLMP_THROTTLE_RETRY_MS` | `4000` | base retry delay, jittered and increased per attempt |
| `HEARTBEAT_INTERVAL_MS` | `300000` | companion traffic cadence; `0` disables |
| `GLMP_KEY_WINDOW_HOURS` | `1` | sliding window for per-key quotas |
| `GLMP_AUTOCLAW_ACCOUNT` | empty | vault account directory name; empty uses the newest |

Restart-only fields:

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | per lane | lane listen port |
| `HOST` | `127.0.0.1` | lane bind address |
| `PROXY_KEY` | `akuganteng` | operator key |
| `UPSTREAM_HOST` | `autoglm-api.autoglm.ai` | upstream host |
| `UPSTREAM_PORT` | `443` | upstream port |
| `GLMP_IDENTITY_VERSION` | `2.0.3` | pinned AutoClaw identity version |
| `GLMP_CONFIG_PATH` | `<root>/config.json` | config file path |
| `GLMP_KEYS_FILE` | `<root>/keys.json` | client key file path |
| `GLMP_HOME` | repository root | project root override |
| `GLMP_STATE_DIR` / `PROXY_STATE_DIR` | `proxy-state/` or the AutoClaw state directory | runtime state location |
| `OPENCLAW_STATE_DIR` | `%USERPROFILE%\.openclaw-autoclaw` | AutoClaw application state directory |
| `AUTOCLAW_EXE` | `D:\Desktop\AutoClaw2\AutoClaw2.exe` | watchdog path to the AutoClaw desktop executable |
| `DASHBOARD_HOST` | `127.0.0.1` | dashboard bind address |
| `DASHBOARD_PORT` | `18793` | dashboard port |
| `OPENAI_PORT` | `18791` | dashboard health target for the OpenAI lane |
| `ANTHROPIC_PORT` | `18792` | dashboard health target for the Anthropic lane |

Advanced vendor fields such as `GLMP_QUEUE=0`, `GOVERNOR_PERSIST=0`,
`PROMPT_ENVELOPE_KB`, `TOOL_SHAPE_BLOCKLIST`,
`GLMP_FOREIGN_IDENTITY_GUARD=0` and `GLMP_SYSTEM_QUARANTINE=0` are read from
the environment. Leave them at defaults unless you are diagnosing upstream
shape or pacing behavior.

## Client Keys and Quotas

Client keys are created in the dashboard and stored in `keys.json`:

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

- `model` pins a key to one model. `null` leaves model choice open.
- `requestsPerHour` is a sliding-window quota. `0` means unlimited.
- The window is `GLMP_KEY_WINDOW_HOURS`, default one hour. A request counts when
  it is accepted, including requests that later fail upstream.
- Exhaustion returns HTTP `429` with `key_quota_exceeded` and a `Retry-After`
  header. The account governor can also return `429 budget_exceeded`.
- Usage lives in `keys-usage.json` inside the state directory. Reset clears
  only that key.
- Key values are shown once at creation and masked afterward.
- `keys.json` changes are picked up by modification time; no restart needed.

## Queue and Governor

AutoClaw permits one active generation at a time. The in-process queue accepts
work in this order:

1. `interactive`
2. `normal`
3. `background`

Within one priority the order is FIFO. Two limits bound the queue:

- `GLMP_QUEUE_MAX_DEPTH` returns `429 queue_overflow` when full.
- `GLMP_QUEUE_WAIT_MS` returns `503 queue_timeout` after the wait limit.
  `0` waits indefinitely.

The account governor is separate from per-key quotas. It counts requests per
account, enforces the hourly budget and the minimum dispatch gap, and persists
its window so a restart cannot grant a fresh budget mid-hour.

## Accounts and Storage

Dashboard accounts come from **Login with Z.ai**. The flow opens the Aliyun
captcha page, requests a signed OAuth URL through AutoClaw, and catches the
callback on one of the official loopback ports: `18432`, `19654`, `19723` or
`53699`. The exchanged token is stored in
`proxy-state/managed-accounts.enc`; the browser never receives it.

- On Windows the store is encrypted with DPAPI for the current user.
- On POSIX it uses AES-256-GCM with `proxy-state/managed-accounts.key`
  (mode `0600`).
- Dashboard accounts refresh their own Z.ai OAuth token every ten minutes. A
  refresh hiccup alone never switches accounts.
- **Automatic failover on account death**: when the upstream answers with a
  ban verdict (code `410004`, the `账号已被封禁` ban text, or the live
  `403 {"error":"账号不可用"}` refusal) or session death (`410000`), the
  gateway immediately probes the other dashboard accounts —
  freshest stored token first — through the normal refresh chain, activates
  the first healthy one, and drops the token cache so the next request runs
  on the new account. Accounts that fail the probe (banned) are skipped for
  ten minutes. If every candidate fails, the request is answered exactly as
  before and the gateway stays on the current account. Rotation on healthy
  accounts is deliberately not implemented — switching upstream identities
  for non-death reasons is a ban risk.
- Vault accounts are read from AutoClaw and disappear from the list when they
  have no credentials.
- Credits are read from the AutoClaw wallets endpoint and cached for five
  minutes.
- The dashboard footer shows the account the active lane is actually using.

## Start, Stop and Watchdog

Windows launchers all delegate to `watchdog.ps1`:

```cmd
start-proxy.cmd
cscript //nologo start-proxy-hidden.vbs
```

The watchdog can be run on demand with either launcher. This checkout also
registers it as the `Autoclaw-Watchdog` scheduled task every two minutes. Its
action starts AutoClaw when the `autoclaw` backend needs it, then starts any
missing process on ports `18791`, `18792` and `18793`. Logs go to
`logs/watchdog.log`. The task is optional; the launchers work from any
checkout path.

Manual control:

```powershell
Get-ScheduledTask -TaskName 'Autoclaw-Watchdog' | Select-Object TaskName,State
Start-ScheduledTask -TaskName 'Autoclaw-Watchdog'
```

```powershell
# Stop only the three project processes.
Get-NetTCPConnection -LocalPort 18791,18792,18793 -State Listen |
  ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }
```

The watchdog pins `GLMP_CONFIG_PATH` and `GLMP_KEYS_FILE` to this checkout and
drops an inherited `GLMP_HOME` that points somewhere else. This prevents a
second copy of the project, or an old shell environment, from feeding the
dashboard a stale `config.json`.

## Files

| Path | Purpose |
|---|---|
| `bin/cli.js` | proxy CLI and launcher |
| `lib/` | proxy core, queue, governor, vault, accounts and keys |
| `openai.js`, `anthropic.js` | OpenAI- and Anthropic-compatible lane entrypoints |
| `dashboard/server.js` | dashboard HTTP server, account store, key API, logs |
| `dashboard/public/` | dashboard SPA, styles, i18n, OAuth page and artwork |
| `config.example.json` | runtime configuration example |
| `keys.json` | client keys (runtime, ignored by git) |
| `config.json` | active runtime configuration (ignored by git) |
| `proxy-state/` | encrypted dashboard accounts and governor state (ignored) |
| `keys-usage.json` | per-key quota counters (ignored) |
| `logs/` | lane, dashboard and watchdog logs (ignored) |
| `watchdog.ps1` | process and AutoClaw supervisor |
| `start-proxy.cmd`, `start-proxy-hidden.vbs` | Windows launchers |
| `start-openai.cmd`, `start-anthropic.cmd` | single-lane launchers |
| `run-ps-hidden.vbs` | hidden PowerShell launcher used by the watchdog |
| `tests/` | upstream unit, pen-test, vault, secret-service and queue suites |
| `.github/workflows/` | CI and release workflows |
| `BAN-RISK-AND-LIMITS.md` | upstream account-risk notes, read before heavy use |

## Security

- Model routes accept only the operator key or a client key. Keep the ports on
  loopback unless you put an authenticated reverse proxy in front.
- The dashboard trusts any local process that can open it. Do not bind
  `DASHBOARD_HOST` to a LAN interface.
- Every dashboard mutation requires `X-Dashboard: 1`, which blocks form-based
  cross-site requests.
- The dashboard sends `Content-Security-Policy: default-src 'self'` and uses no
  inline scripts or styles.
- Bearer tokens, client key values and `ZAI_API_KEY` are never returned in API
  responses. Keys are masked after creation.
- `config.json` stores `ZAI_API_KEY` as plain text. Treat it as a credential.
- `proxy-state/` contains encrypted account tokens. Never copy it between
  machines or commit it; DPAPI ciphertext is bound to the current Windows user.
- Rotate `PROXY_KEY` in both lanes and the dashboard together.
- Read [`BAN-RISK-AND-LIMITS.md`](BAN-RISK-AND-LIMITS.md) before running large
  batches; the governor exists because upstream bans are permanent.

## Troubleshooting

**`Failed to fetch` or a stale config path on the dashboard**

The dashboard reports its active config file at `GET /api/status` under
`config.path`. It must point at this checkout. Start the process through
`watchdog.ps1`, or clear inherited `GLMP_HOME`, `GLMP_CONFIG_PATH` and
`GLMP_KEYS_FILE` before launching Node directly.

**`no_token` / `503 no_api_key`**

The selected backend has no usable credential. Connect an account for
`autoclaw`, or set `ZAI_API_KEY` for `zai`.

**`502 upstream_connection_failed` with `ECONNREFUSED 127.0.0.1:1`**

A parent shell or test harness exported `UPSTREAM_PORT=1`. Unset
`UPSTREAM_PORT`, `UPSTREAM_HOST`, `UPSTREAM_BASE` and `UPSTREAM_PATH` before
starting the gateway. A real environment variable wins over `config.json`, so
editing the config file will not mask it.

**`401 invalid_api_key` even though the dashboard key is correct**

The lane inherited `PROXY_KEY` from its parent environment; test harnesses often
export `PROXY_KEY=testkey`. Start the launcher from Explorer, or set
`PROXY_KEY` explicitly for the process that starts the watchdog.

**AutoClaw login is rejected or the vault is empty**

Vault accounts require access to the AutoClaw vault of the current OS user:
DPAPI on Windows, Secret Service on Linux, or the login Keychain on macOS.
Dashboard OAuth accounts bypass the vault and work without the desktop app.

**`429 budget_exceeded`**

The account governor has reached the hourly budget. Wait for the window or
raise `BUDGET_REQUESTS_PER_HOUR` deliberately. Do not disable pacing on an
account you cannot afford to lose.

**`429 key_quota_exceeded`**

That client key reached its own window limit. Raise `requestsPerHour`, reset
the key in the dashboard, or use a different key.

**`503 queue_timeout` or `429 queue_overflow`**

Raise `GLMP_QUEUE_MAX_DEPTH` or `GLMP_QUEUE_WAIT_MS`, or send fewer background
requests. AutoClaw still permits only one active generation.

**A port is already in use**

Find the owner with `Get-NetTCPConnection -LocalPort <port> -State Listen` and
stop only that process. Do not kill unrelated Node processes by name.

**The dashboard still shows old labels or artwork**

Hard refresh with `Ctrl+F5`. Static assets are served from
`dashboard/public/`.

## Development

```cmd
npm run check
npm test
```

`npm run check` runs `node --check` over every proxy module and every dashboard
script. `npm test` runs the upstream taxonomy smoke test. The remaining suites
in `tests/` are kept from upstream for reference; some need a live AutoClaw
vault or account, so run them individually with the same environment the
upstream project expects. `npm run test:live` runs the network pen-tests and
catalog refresh. Changes to lane behavior should also be verified live before
release. CI runs syntax checks and the taxonomy suite on Linux, Windows and
macOS.

## Releases

The latest release is **v1.1.2**:

- [Release notes and downloads](https://github.com/ShinRyu04/Autoclaw/releases/tag/v1.1.2)
- [All releases](https://github.com/ShinRyu04/Autoclaw/releases)

Release archives are compiled executables (Node.js SEA), one set per platform
and architecture for Windows, Linux, and macOS (x64 and arm64):
`autoclaw-openai`, `autoclaw-anthropic`, `autoclaw-dashboard`. No Node.js
install or source tree is needed. Windows users run `start-autoclaw.cmd`;
Linux and macOS users run `./start-autoclaw.sh`. `package.json`,
`fallback-models.json` and `dashboard/public/` ship alongside the binaries
because the lanes read them at runtime. Each release also ships a
`SHA256SUMS` file. The archives are portable, not installers; AutoClaw vault
accounts still need the AutoClaw desktop app for the current OS user.

Building locally (native host only, needs `npm ci` first):

```sh
node scripts/package-release.mjs --platform windows --arch x64 --compiled
node scripts/package-release.mjs --platform linux --arch arm64 --compiled
```

Drop `--compiled` to produce the older source-plus-Node-runtime bundle.

To update an existing checkout:

```cmd
git pull
npm run check
```

Restart the lanes and dashboard after pulling. Runtime files (`config.json`,
`keys.json`, `proxy-state/`, `logs/`) are not part of the release and are left
in place.

## Credits

The upstream proxy is [eequaled/GLMproxy](https://github.com/eequaled/GLMproxy),
MIT licensed. This repository carries version 3.3.x with local patches and
adds the operations dashboard, bilingual interface, client-key management,
account manager, watchdog and Windows launch scripts.

Maintained by [ShinRyu04](https://github.com/ShinRyu04).

## License

MIT. See [LICENSE](LICENSE).
