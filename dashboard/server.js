/**
 * Autoclaw dashboard.
 *
 * Loopback-only operations panel for the two proxy entrypoints. It reads live
 * state from their /status endpoints (operator key), owns the shared keys.json
 * and config.json, and never returns a bearer token, a client key, or the Z.ai
 * API key to the browser.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";

import {
  configFilePath, keysFilePath, projectRoot, readConfigFile, writeConfigPatch,
} from "../lib/runtime-config.js";
import { getModelCatalog, loadConfig } from "../lib/core.js";
import { getAutoClawConfigDirs, extractAutoClawVaultToken, isJwtExpired } from "../lib/vault.js";
import {
  getActiveManagedId,
  getManagedAccount,
  listManagedAccounts,
  publicManagedAccount,
  removeManagedAccount,
  setActiveManagedAccount,
  updateManagedDisplayName,
  updateManagedTokens,
  upsertManagedAccount,
} from "../lib/account-store.js";
import { generateKey, maskKey, readKeys, writeKeys } from "../lib/keystore.js";
import * as keyusage from "../lib/keyusage.js";

const ROOT = projectRoot();
const PUBLIC_DIR = path.join(ROOT, "dashboard", "public");
const LOG_DIR = path.join(ROOT, "logs");
const DASHBOARD_HOST = process.env.DASHBOARD_HOST || "127.0.0.1";
const DASHBOARD_PORT = parseInt(process.env.DASHBOARD_PORT || "18793", 10) || 18793;
const OPENAI_PORT = parseInt(process.env.OPENAI_PORT || "18791", 10) || 18791;
const ANTHROPIC_PORT = parseInt(process.env.ANTHROPIC_PORT || "18792", 10) || 18792;
const CREDITS_URL = "https://autoglm-api.autoglm.ai/agent-assetmgr/api/v2/wallets?biz_app_id=autoclaw";
const IDENTITY_BASE = "https://autoglm-api.autoglm.ai";
const CREDITS_TTL_MS = 5 * 60 * 1000;
const creditsCache = new Map();

const CHECKIN_TASKS = [
  { id: "daily_signin", label: "Check-in harian" },
  { id: "daily_inspiration_center", label: "Inspiration Center" },
  { id: "newbie_cloud_lobster", label: "Cloud Lobster" },
  { id: "newbie_local_lobster", label: "Local Lobster" },
];

const AUTOCLAW_APP_ID = "100003";
const AUTOCLAW_APP_KEY = "38d2391985e2369a5fb8227d8e6cd5e5";
const OAUTH_CALLBACK_PORTS = [18432, 19654, 19723, 53699];
const oauthSessions = new Map();
const health = { running: false, startedAt: null, finishedAt: null, results: [], error: "" };
let captchaConfigCache = { at: 0, data: null };
let docsCache = { at: 0, data: null };

const fileConfig = readConfigFile();
const PROXY_KEY = (process.env.PROXY_KEY || fileConfig.PROXY_KEY || "akuganteng").trim();

const SETTINGS = {
  GLMP_BACKEND: { type: "enum", values: ["autoclaw", "zai"] },
  ZAI_API_KEY: { type: "secret", max: 400 },
  ZAI_BASE_URL: { type: "string", max: 400 },
  ZAI_DEFAULT_MODEL: { type: "string", max: 120 },
  ZAI_MODEL_OPUS: { type: "string", max: 120 },
  ZAI_MODEL_SONNET: { type: "string", max: 120 },
  ZAI_MODEL_HAIKU: { type: "string", max: 120 },
  BUDGET_REQUESTS_PER_HOUR: { type: "int", min: 0, max: 100000 },
  MIN_GAP_MS: { type: "int", min: 0, max: 60000 },
  GLMP_QUEUE_MAX_DEPTH: { type: "int", min: 1, max: 1000 },
  GLMP_QUEUE_WAIT_MS: { type: "int", min: 0, max: 3600000 },
  MAX_MESSAGES: { type: "int", min: 1, max: 100000 },
  UPSTREAM_TIMEOUT_MS: { type: "int", min: 1000, max: 600000 },
  GLMP_THROTTLE_RETRIES: { type: "int", min: 0, max: 10 },
  GLMP_THROTTLE_RETRY_MS: { type: "int", min: 0, max: 60000 },
  HEARTBEAT_INTERVAL_MS: { type: "int", min: 0, max: 86400000 },
  GLMP_KEY_WINDOW_HOURS: { type: "number", min: 0.1, max: 168 },
};

function stateConfig() {
  const base = process.env.OPENCLAW_STATE_DIR || path.join(os.homedir(), ".openclaw-autoclaw");
  const state = process.env.PROXY_STATE_DIR || path.join(base, "proxy-state");
  const hours = Number(process.env.GLMP_KEY_WINDOW_HOURS ?? readConfigFile().GLMP_KEY_WINDOW_HOURS ?? 1);
  return {
    STATE_DIR: state,
    KEY_WINDOW_MS: (Number.isFinite(hours) && hours > 0 ? hours : 1) * 3600 * 1000,
    KEYS_FILE: keysFilePath(),
  };
}

function json(res, status, payload, extraHeaders = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    ...extraHeaders,
  });
  res.end(body);
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 128 * 1024) {
        reject(Object.assign(new Error("Body too large"), { status: 413 }));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!raw.trim()) return resolve({});
      try { resolve(JSON.parse(raw)); }
      catch { reject(Object.assign(new Error("Invalid JSON"), { status: 400 })); }
    });
    req.on("error", reject);
  });
}

function requireMutation(req) {
  if (req.headers["x-dashboard"] !== "1") {
    throw Object.assign(new Error("Missing X-Dashboard header"), { status: 403 });
  }
}

function fetchStatus(port) {
  return new Promise((resolve) => {
    const req = http.get({
      host: "127.0.0.1",
      port,
      path: "/status",
      headers: { Authorization: `Bearer ${PROXY_KEY}` },
      timeout: 2500,
    }, (res) => {
      let raw = "";
      res.on("data", (c) => { raw += c; });
      res.on("end", () => {
        if (res.statusCode !== 200) {
          resolve({ ok: false, error: `HTTP ${res.statusCode}` });
          return;
        }
        try { resolve({ ok: true, data: JSON.parse(raw) }); }
        catch { resolve({ ok: false, error: "Respons bukan JSON" }); }
      });
    });
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", (err) => resolve({ ok: false, error: err.message }));
  });
}

let watchdogCache = { at: 0, value: null };
function watchdogState() {
  if (Date.now() - watchdogCache.at < 30000) return Promise.resolve(watchdogCache.value);
  return new Promise((resolve) => {
    execFile("schtasks", ["/query", "/TN", "Autoclaw-Watchdog", "/FO", "LIST"], {
      windowsHide: true,
      timeout: 5000,
    }, (err, stdout) => {
      let value = null;
      if (!err && stdout) {
        const match = stdout.match(/^\s*(?:Status|State)\s*:\s*(.+)$/im);
        value = match ? match[1].trim() : stdout.split(/\r?\n/)[0] || null;
      }
      watchdogCache = { at: Date.now(), value };
      resolve(value);
    });
  });
}

function listLogFiles() {
  try {
    return fs.readdirSync(LOG_DIR)
      .filter((name) => /\.(log|err|out)$/i.test(name))
      .map((name) => {
        const stat = fs.statSync(path.join(LOG_DIR, name));
        return { name, size: stat.size, mtime: stat.mtime.toISOString() };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return [];
  }
}

function tailLog(name, lines) {
  const safe = listLogFiles().some((f) => f.name === name);
  if (!safe) throw Object.assign(new Error("Log file not found"), { status: 404 });
  const file = path.join(LOG_DIR, name);
  const stat = fs.statSync(file);
  const maxBytes = 512 * 1024;
  const start = Math.max(0, stat.size - maxBytes);
  const fd = fs.openSync(file, "r");
  try {
    const buffer = Buffer.alloc(stat.size - start);
    fs.readSync(fd, buffer, 0, buffer.length, start);
    const all = buffer.toString("utf8").replace(/\u001b\[[0-9;]*m/g, "").split(/\r?\n/);
    if (start > 0) all.shift();
    return all.slice(-Math.max(1, Math.min(2000, lines))).join("\n");
  } finally {
    fs.closeSync(fd);
  }
}

function keyId(key) {
  return crypto.createHash("sha256").update(String(key)).digest("hex").slice(0, 12);
}

function publicKeys() {
  const cfg = stateConfig();
  return readKeys(cfg).map((record) => ({
    id: keyId(record.key),
    name: record.name,
    keyMasked: maskKey(record.key),
    model: record.model,
    requestsPerHour: record.requestsPerHour,
    enabled: record.enabled,
    createdAt: record.createdAt,
    usage: keyusage.snapshot(cfg, record.key, record.requestsPerHour, cfg.KEY_WINDOW_MS),
  }));
}

function findKey(id) {
  const cfg = stateConfig();
  const keys = readKeys(cfg);
  const record = keys.find((k) => keyId(k.key) === id);
  return { cfg, keys, record };
}

function validateSetting(name, value) {
  const rule = SETTINGS[name];
  if (!rule) throw Object.assign(new Error(`Setting tidak diizinkan: ${name}`), { status: 400 });
  if (rule.type === "secret") {
    const str = String(value ?? "");
    if (str.length > rule.max) throw Object.assign(new Error(`${name} terlalu panjang`), { status: 400 });
    return str;
  }
  if (rule.type === "enum") {
    const str = String(value ?? "");
    if (!rule.values.includes(str)) throw Object.assign(new Error(`${name} harus salah satu dari ${rule.values.join(", ")}`), { status: 400 });
    return str;
  }
  if (rule.type === "string") {
    const str = String(value ?? "").trim();
    if (str.length > rule.max) throw Object.assign(new Error(`${name} terlalu panjang`), { status: 400 });
    if (name === "ZAI_BASE_URL" && str) {
      try { new URL(str); } catch { throw Object.assign(new Error("ZAI_BASE_URL bukan URL valid"), { status: 400 }); }
    }
    return str;
  }
  const num = Number(value);
  if (!Number.isFinite(num) || num < rule.min || num > rule.max) {
    throw Object.assign(new Error(`${name} harus angka ${rule.min}..${rule.max}`), { status: 400 });
  }
  return rule.type === "int" ? Math.round(num) : num;
}

async function reloadProxies() {
  const results = {};
  for (const [name, port] of [["openai", OPENAI_PORT], ["anthropic", ANTHROPIC_PORT]]) {
    results[name] = await new Promise((resolve) => {
      const req = http.request({
        host: "127.0.0.1",
        port,
        path: "/admin/reload",
        method: "POST",
        timeout: 4000,
        headers: {
          Authorization: `Bearer ${PROXY_KEY}`,
          "Content-Length": 0,
        },
      }, (res) => {
        let raw = "";
        res.on("data", (c) => { raw += c; });
        res.on("end", () => resolve({ ok: res.statusCode === 200, status: res.statusCode, body: raw.slice(0, 400) }));
      });
      req.on("timeout", () => req.destroy(new Error("timeout")));
      req.on("error", (err) => resolve({ ok: false, error: err.message }));
      req.end();
    });
  }
  return results;
}

function listAutoClawAccounts() {
  const accounts = [];
  for (const root of getAutoClawConfigDirs()) {
    const accountsDir = path.join(root, "accounts");
    let entries;
    try { entries = fs.readdirSync(accountsDir, { withFileTypes: true }); }
    catch { continue; }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const dir = path.join(accountsDir, entry.name);
      const encFile = path.join(dir, "account-credentials.enc");
      const profileFile = path.join(dir, "account-profile.json");
      let stat = null;
      try { stat = fs.statSync(encFile); } catch { /* tanpa kredensial */ }
      let profile = null;
      try {
        const parsed = JSON.parse(fs.readFileSync(profileFile, "utf8"));
        profile = parsed?.profile || null;
      } catch { /* profil opsional */ }
      accounts.push({
        key: entry.name,
        displayName: profile?.displayName || null,
        email: profile?.email || null,
        numericUserId: profile?.numericUserId == null ? null : String(profile.numericUserId),
        accountId: profile?.accountId || null,
        lastLoginAt: profile?.lastLoginAt || null,
        isGuest: profile?.isGuest === true,
        hasCredentials: Boolean(stat),
        mtimeMs: stat ? stat.mtimeMs : null,
        root: path.basename(root),
      });
    }
  }
  return accounts.sort((a, b) => (b.mtimeMs || 0) - (a.mtimeMs || 0));
}

function accountError(message, status = 400) {
  return Object.assign(new Error(message), { status });
}

async function identityRequest(pathname, payload) {
  let res;
  try {
    res = await fetch(`${IDENTITY_BASE}${pathname}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15000),
    });
  } catch (err) {
    throw accountError(`Tidak bisa menghubungi AutoClaw: ${err.message}`, 502);
  }
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); }
  catch { throw accountError("Respons login AutoClaw bukan JSON", 502); }
  if (!body || typeof body.code !== "number") throw accountError("Respons login AutoClaw tidak dikenal", 502);
  return { httpStatus: res.status, body };
}

function identityFailure(body) {
  const messages = {
    400001: "Data login tidak valid",
    400002: "AutoClaw menolak permintaan login (middleware)",
    630006: "Nomor HP tidak valid",
    630201: "Kode salah",
    630202: "Kode kedaluwarsa, minta kode baru",
    630203: "Terlalu banyak percobaan, tunggu sebentar",
  };
  const status = body.code === 429 || body.code === 630203 ? 429 : 400;
  return accountError(messages[body.code] || `Login AutoClaw gagal (kode ${body.code})`, status);
}

function signedAutoClawHeaders() {
  const now = String(Math.floor(Date.now() / 1000));
  const authSign = crypto.createHash("md5")
    .update(`${AUTOCLAW_APP_ID}&${now}&${AUTOCLAW_APP_KEY}`)
    .digest("hex");
  return {
    "Content-Type": "application/json",
    Accept: "*/*",
    "X-Auth-Appid": AUTOCLAW_APP_ID,
    "X-Auth-TimeStamp": now,
    "X-Auth-Sign": authSign,
    "X-Tm": process.platform === "win32" ? "win" : "linux",
    "X-Version": "1.17.9",
    "X-Product": "autoclaw",
    "X-Channel": "official",
    "X-Lang": "en",
    "X-Client-Type": "pc",
    "X-Trace-Id": crypto.randomUUID(),
    "User-Agent": "AutoClaw/1.17.9",
  };
}

async function signedAutoClawPost(pathname, payload) {
  let res;
  try {
    res = await fetch(`${IDENTITY_BASE}${pathname}`, {
      method: "POST",
      headers: signedAutoClawHeaders(),
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(20000),
    });
  } catch (err) {
    throw accountError(`Tidak bisa menghubungi AutoClaw: ${err.message}`, 502);
  }
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); }
  catch { throw accountError("Respons AutoClaw bukan JSON", 502); }
  if (!body || typeof body.code !== "number") throw accountError("Respons AutoClaw tidak dikenal", 502);
  return { httpStatus: res.status, body };
}

async function zaiCaptchaConfig(force = false) {
  if (!force && captchaConfigCache.data && Date.now() - captchaConfigCache.at < 30 * 60 * 1000) {
    return captchaConfigCache.data;
  }
  const { body } = await signedAutoClawPost("/userapi/overseasv1/oauth-captcha-config", {});
  if (body.code !== 0 || !body.data) {
    throw accountError(body.msg || `AutoClaw menolak konfigurasi captcha (kode ${body.code})`, 502);
  }
  const data = {
    enabled: body.data.enabled === true,
    region: String(body.data.region || "ga"),
    prefix: String(body.data.prefix || ""),
    sceneId: String(body.data.scene_id || ""),
    supplier: String(body.data.captcha_supplier || "aliyun"),
  };
  captchaConfigCache = { at: Date.now(), data };
  return data;
}

function zaiOAuthError(body) {
  const messages = {
    400001: "Data OAuth tidak valid",
    400002: "Verifikasi captcha ditolak. Ulangi verifikasi.",
    400003: "Sesi OAuth kedaluwarsa. Ulangi login.",
    630014: "Verifikasi captcha tidak valid atau kedaluwarsa. Ulangi verifikasi.",
  };
  return accountError(messages[body.code] || `Login Z.ai gagal (kode ${body.code})`, 400);
}

function listenLocal(port) {
  return new Promise((resolve, reject) => {
    const server = http.createServer();
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", reject);
      resolve(server);
    });
  });
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[char]));
}

function oauthResultPage(ok, title, detail) {
  const tone = ok ? "#86c9a1" : "#e69696";
  return `<!doctype html>
<html lang="id">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} · Autoclaw</title>
<style>
html { color-scheme: dark; }
body { margin: 0; min-height: 100dvh; display: grid; place-items: center; background: #0e1110; color: #e8ebe9; font: 15px/1.55 "Segoe UI", system-ui, sans-serif; }
main { width: min(440px, calc(100vw - 2rem)); border: 1px solid #2b322e; border-radius: 8px; background: #171b19; padding: 1.4rem; }
p { margin: 0 0 1rem; color: #a6afaa; }
h1 { margin: 0 0 0.6rem; font-size: 1.15rem; color: ${tone}; }
button { font: 500 0.86rem "Segoe UI", system-ui, sans-serif; color: #1d130c; background: #d08a55; border: 1px solid #d08a55; border-radius: 6px; min-height: 36px; padding: 0.4rem 0.8rem; cursor: pointer; }
button:focus-visible { outline: 2px solid #d08a55; outline-offset: 2px; }
code { font-family: "Cascadia Mono", Consolas, monospace; background: #1d2220; padding: 0.08em 0.34em; border-radius: 4px; }
</style>
</head>
<body>
<main>
<h1>${escapeHtml(title)}</h1>
<p>${detail}</p>
<button type="button" onclick="window.close()">Tutup tab</button>
</main>
<script>setTimeout(function () { window.close(); }, 1800);</script>
</body>
</html>`;
}

async function finishZaiOAuth(code, state, navigateUri, deviceId) {
  const { body } = await signedAutoClawPost("/userapi/overseasv1/zai-oauth-login", {
    code,
    state,
    navigate_uri: navigateUri,
    device_id: deviceId,
    source_id: "autoclaw",
  });
  if (body.code !== 0) throw zaiOAuthError(body);
  const data = body.data;
  if (!data?.access_token || !data?.refresh_token || data?.user_id == null) {
    throw accountError("AutoClaw tidak mengembalikan token akun Z.ai", 502);
  }
  const account = upsertManagedAccount({
    provider: "zai",
    numericUserId: data.user_id,
    displayName: data.user_name || data.name || data.email || null,
    phone: data.user_phone || null,
    email: data.email || data.user_email || null,
    deviceId,
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
  });
  creditsCache.clear();
  return account;
}

async function startZaiOAuth({ verifyParam, navigateUri, deviceId }) {
  if (verifyParam.length > 20000) throw accountError("Parameter captcha terlalu panjang", 400);
  if (!verifyParam) {
    const captcha = await zaiCaptchaConfig();
    if (captcha.enabled) throw accountError("Selesaikan verifikasi captcha dulu", 400);
  }

  let server = null;
  let port = null;
  for (const candidate of OAUTH_CALLBACK_PORTS) {
    try {
      server = await listenLocal(candidate);
      port = candidate;
      break;
    } catch { /* coba port berikutnya */ }
  }
  if (!server) throw accountError("Semua port callback OAuth sedang dipakai. Tutup tab login lain lalu coba lagi.", 409);

  const callbackUri = `http://localhost:${port}/auth/callback-zai`;
  const sessionId = crypto.randomBytes(16).toString("hex");

  let closed = false;
  const closeServer = () => {
    if (closed) return;
    closed = true;
    for (const [key, session] of oauthSessions) {
      if (session.sessionId === sessionId) oauthSessions.delete(key);
    }
    try { server.close(); } catch { /* already closed */ }
  };
  const timer = setTimeout(closeServer, 10 * 60 * 1000);
  timer.unref();

  server.on("request", async (req, res) => {
    const requestUrl = new URL(req.url, callbackUri);
    if (requestUrl.pathname !== "/auth/callback-zai") {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not found");
      return;
    }
    const code = requestUrl.searchParams.get("code") || "";
    const state = requestUrl.searchParams.get("state") || "";
    const session = oauthSessions.get(state);
    const fail = (status, title, detail) => {
      res.writeHead(status, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
      res.end(oauthResultPage(false, title, detail));
    };
    if (req.method !== "GET") {
      fail(405, "Metode tidak didukung", "Callback OAuth hanya menerima GET.");
      return;
    }
    if (!code) {
      fail(400, "Login Z.ai gagal", "Callback tidak membawa kode OAuth. Ulangi login dari dashboard.");
      return;
    }
    if (!session || session.sessionId !== sessionId) {
      fail(400, "Sesi tidak cocok", "Sesi OAuth tidak dikenal atau sudah kedaluwarsa. Ulangi login dari dashboard.");
      return;
    }
    try {
      const account = await finishZaiOAuth(code, state, session.navigateUri, session.deviceId);
      oauthSessions.delete(state);
      clearTimeout(timer);
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
      res.end(oauthResultPage(true, "Akun Z.ai terhubung", `Akun <strong>${escapeHtml(account.displayName || account.key)}</strong> tersimpan di dashboard. Kembali ke dashboard untuk memakainya.`));
    } catch (err) {
      oauthSessions.delete(state);
      clearTimeout(timer);
      fail(400, "Login Z.ai gagal", escapeHtml(err.message || "Tidak bisa menyimpan akun."));
    } finally {
      setTimeout(closeServer, 300).unref();
    }
  });

  try {
    const payload = {
      source_id: "autoclaw",
      navigate_uri: callbackUri,
      device_id: deviceId,
    };
    if (verifyParam) payload.ali_captcha_verify_param = verifyParam;
    const { body } = await signedAutoClawPost("/userapi/overseasv1/zai-oauth-url", payload);
    if (body.code !== 0 || !body.data) throw zaiOAuthError(body);
    const oauthUrl = body.data.oauth_url || body.data.url;
    const state = body.data.state;
    if (!oauthUrl || !state) throw accountError("AutoClaw tidak mengembalikan URL OAuth", 502);
    oauthSessions.set(state, { sessionId, navigateUri: callbackUri, deviceId, createdAt: Date.now() });
    return { url: oauthUrl, port };
  } catch (err) {
    clearTimeout(timer);
    closeServer();
    throw err;
  }
}

async function refreshManagedAccount(account) {
  if (!account?.refreshToken) throw accountError("Sesi akun tidak punya refresh token. Login ulang.", 401);
  const payload = {
    refresh_token: account.refreshToken,
    source_id: "autoclaw",
    device_id: account.deviceId,
  };
  let { body } = await identityRequest("/userapi/v1/refresh", payload);
  if (body.code === 400002) ({ body } = await identityRequest("/userapi/v1/agent-refresh", payload));
  if (body.code !== 0) throw identityFailure(body);
  if (!body.data?.access_token) throw accountError("Refresh token ditolak. Login ulang.", 401);
  updateManagedTokens(account.id, {
    accessToken: body.data.access_token,
    refreshToken: body.data.refresh_token || account.refreshToken,
  });
  return getManagedAccount(account.id);
}

async function completeAutoClawTask(token, taskId) {
  const headers = signedAutoClawHeaders();
  headers.authorization = token;
  delete headers.Accept;
  let res;
  try {
    res = await fetch(`${IDENTITY_BASE}/autoclaw-proxy/proxy/autoclaw-task-complete`, {
      method: "POST",
      headers,
      body: JSON.stringify({ task_id: taskId }),
      signal: AbortSignal.timeout(20000),
    });
  } catch (err) {
    throw new Error(`Tidak bisa menghubungi AutoClaw: ${err.message}`);
  }
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); }
  catch { throw new Error(`Respons AutoClaw bukan JSON (${res.status})`); }
  if (body.code != null && body.code !== 0) {
    throw new Error(body.msg || `AutoClaw menolak task (kode ${body.code})`);
  }
  const data = body.data;
  if (!data) throw new Error(body.msg || `AutoClaw tidak mengembalikan hasil task (${res.status})`);
  if (data.already_completed === true) return { points: 0, already: true };
  if (data.success !== true) throw new Error(body.msg || "AutoClaw menolak task");
  return { points: Number(data.reward_points) || 0, already: false };
}

async function checkinToken(account) {
  if (account.source === "dashboard") {
    let current = getManagedAccount(account.key);
    if (!current) throw new Error("Akun dashboard tidak ditemukan");
    current = await ensureManagedFresh(current, 60 * 1000);
    if (!current.accessToken) throw new Error("Token akun dashboard tidak tersedia");
    return current.accessToken;
  }
  const vault = extractAutoClawVaultToken({
    IS_AUTOCLAW2: true,
    AUTOCLAW_ACCOUNT_KEY: account.key,
  }, null);
  if (!vault) throw new Error("Token vault tidak terbaca");
  if (isJwtExpired(vault.token)) throw new Error("Token vault kedaluwarsa");
  return vault.token;
}

async function runCheckinAll() {
  const { accounts } = dashboardAccounts();
  if (accounts.length === 0) throw accountError("Belum ada akun AutoClaw yang bisa dipakai", 409);
  const summary = { accounts: [], claimed: 0, already: 0, failed: 0 };
  for (const account of accounts) {
    const view = publicAccount(account);
    const item = {
      key: view.key,
      name: view.displayName || (view.numericUserId ? `Akun ${view.numericUserId}` : "Akun AutoClaw"),
      claimed: 0,
      already: 0,
      failed: 0,
      points: 0,
      errors: [],
    };
    let token;
    try {
      token = await checkinToken(account);
    } catch (err) {
      item.failed = CHECKIN_TASKS.length;
      item.errors.push(err.message);
      summary.accounts.push(item);
      summary.failed += item.failed;
      continue;
    }
    for (const task of CHECKIN_TASKS) {
      try {
        const result = await completeAutoClawTask(token, task.id);
        if (result.already) item.already += 1;
        else {
          item.claimed += 1;
          item.points += result.points;
        }
      } catch (err) {
        item.failed += 1;
        item.errors.push(`${task.label}: ${err.message}`);
      }
    }
    summary.accounts.push(item);
    summary.claimed += item.claimed;
    summary.already += item.already;
    summary.failed += item.failed;
  }
  creditsCache.clear();
  return summary;
}

async function ensureManagedFresh(account, minMs = 5 * 60 * 1000) {
  if (account.expiresAt && account.expiresAt > Date.now() + minMs) return account;
  try {
    return await refreshManagedAccount(account);
  } catch (err) {
    if (account.expiresAt && account.expiresAt > Date.now()) return account;
    throw err;
  }
}

async function fetchCreditBalance(token) {
  const res = await fetch(CREDITS_URL, {
    headers: { Authorization: token, Accept: "application/json" },
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { status: res.status });
  const body = await res.json();
  const total = Number(body?.data?.total_balance);
  if (body?.code !== 0 || !Number.isFinite(total)) throw new Error("format saldo tidak dikenal");
  const daily = Number((body.data.wallets || []).find((w) => w?.public_wallet_type === "daily")?.balance);
  return {
    ok: true,
    totalPoints: total,
    dailyPoints: Number.isFinite(daily) ? daily : null,
    updatedAt: new Date().toISOString(),
  };
}

async function readAccountCredits(account, force = false) {
  if (!account.hasCredentials) return { ok: false, error: "perlu login" };
  const cacheKey = `${account.source || "vault"}:${account.key}:${account.mtimeMs || account.expiresAt || 0}`;
  const cached = creditsCache.get(cacheKey);
  if (!force && cached && Date.now() - cached.at < CREDITS_TTL_MS) return cached.value;

  let value;
  try {
    if (account.source === "dashboard") {
      let current = getManagedAccount(account.key);
      if (!current) {
        value = { ok: false, error: "akun tidak ditemukan" };
      } else {
        current = await ensureManagedFresh(current, 60 * 1000);
        try {
          value = await fetchCreditBalance(current.accessToken);
        } catch (err) {
          if (err.status !== 401) throw err;
          current = await refreshManagedAccount(current);
          value = await fetchCreditBalance(current.accessToken);
        }
      }
    } else {
      const vault = extractAutoClawVaultToken({
        IS_AUTOCLAW2: true,
        AUTOCLAW_ACCOUNT_KEY: account.key,
      }, null);
      if (!vault) value = { ok: false, error: "token tidak terbaca" };
      else if (isJwtExpired(vault.token)) value = { ok: false, error: "token kedaluwarsa" };
      else value = await fetchCreditBalance(vault.token);
    }
  } catch (err) {
    value = { ok: false, error: err.message || "saldo tidak terbaca" };
  }
  creditsCache.set(cacheKey, { at: Date.now(), value });
  return value;
}

async function attachAccountCredits(accounts, force = false) {
  return Promise.all(accounts.map(async (account) => ({
    ...account,
    credits: await readAccountCredits(account, force),
  })));
}

function publicAccount(account) {
  const rawName = String(account.displayName || "").trim();
  const contactLike = !rawName
    || rawName === "None"
    || rawName.includes("@")
    || /^\+?\d[\d\s().-]{5,}$/.test(rawName);
  return {
    key: account.key,
    source: account.source || "vault",
    displayName: contactLike ? null : rawName,
    numericUserId: account.numericUserId == null ? null : String(account.numericUserId),
    accountId: account.accountId || null,
    lastLoginAt: account.lastLoginAt || null,
    expiresAt: account.expiresAt || null,
    isGuest: account.isGuest === true,
    hasCredentials: account.hasCredentials !== false,
    credits: account.credits || null,
  };
}

function dashboardAccounts() {
  const managed = listManagedAccounts();
  const managedIds = new Set(managed.map((account) => String(account.numericUserId)));
  const vault = listAutoClawAccounts()
    .filter((account) => !managedIds.has(String(account.numericUserId)))
    .map((account) => ({ ...account, source: "vault" }));
  const activeManagedId = getActiveManagedId();
  return {
    accounts: [...managed, ...vault].filter((account) => account.hasCredentials !== false),
    activeManagedId: managed.some((account) => account.key === activeManagedId) ? activeManagedId : null,
    configuredKey: readConfigFile().GLMP_AUTOCLAW_ACCOUNT || null,
  };
}

function apiDocsPayload() {
  if (docsCache.data && Date.now() - docsCache.at < 60 * 1000) return docsCache.data;
  const file = readConfigFile();
  let catalog = null;
  try { catalog = getModelCatalog(loadConfig({ format: "openai" })); }
  catch { catalog = null; }
  const models = (catalog?.models || []).map((model) => ({
    id: model.id,
    name: model.name || model.id,
    contextWindow: model.contextWindow || null,
    maxTokens: model.maxTokens || null,
  }));
  const data = {
    generatedAt: new Date().toISOString(),
    baseUrl: {
      openai: `http://127.0.0.1:${OPENAI_PORT}/v1`,
      anthropic: `http://127.0.0.1:${ANTHROPIC_PORT}`,
    },
    auth: {
      openai: "Authorization: Bearer <kunci>",
      anthropic: "x-api-key: <kunci> atau Authorization: Bearer <kunci>",
    },
    endpoints: [
      { method: "POST", path: "/v1/chat/completions", base: "openai", purpose: "Chat completion, streaming dan non-streaming." },
      { method: "GET", path: "/v1/models", base: "openai", purpose: "Daftar model dalam format OpenAI." },
      { method: "POST", path: "/v1/messages", base: "anthropic", purpose: "Messages API Anthropic, termasuk SSE." },
      { method: "POST", path: "/v1/messages/count_tokens", base: "anthropic", purpose: "Stub hitung token, selalu mengembalikan 0." },
      { method: "GET", path: "/v1/models", base: "anthropic", purpose: "Daftar model dalam format Anthropic." },
      { method: "GET", path: "/healthz", base: "keduanya", purpose: "Status token upstream." },
    ],
    models,
    modelSource: catalog?.source ? path.basename(catalog.source) : (catalog?.fallback ? "fallback" : null),
    aliases: {
      opus: file.ZAI_MODEL_OPUS || "zai_glm-5.3",
      sonnet: file.ZAI_MODEL_SONNET || "zai_glm-5.3",
      haiku: file.ZAI_MODEL_HAIKU || "zai_glm-5.3-flash",
    },
    docsUrl: `http://127.0.0.1:${DASHBOARD_PORT}/api-docs`,
  };
  docsCache = { at: Date.now(), data };
  return data;
}

async function activeAccountIds() {
  const [openai, anthropic] = await Promise.all([
    fetchStatus(OPENAI_PORT),
    fetchStatus(ANTHROPIC_PORT),
  ]);
  return new Set(
    [openai, anthropic]
      .filter((lane) => lane.ok)
      .map((lane) => lane.data?.token?.userId)
      .filter((id) => id != null)
      .map(String),
  );
}

function healthAccount(account, activeIds, checkedAt = null) {
  const credits = account.credits || null;
  const healthy = credits?.ok === true;
  return {
    ...publicAccount(account),
    credits,
    status: checkedAt ? (healthy ? "ok" : "err") : "pending",
    message: checkedAt
      ? (healthy ? "Token dan saldo terbaca" : credits?.error || "Pemeriksaan gagal")
      : "Belum diperiksa",
    checkedAt,
    active: account.numericUserId != null && activeIds.has(String(account.numericUserId)),
  };
}

async function healthSnapshot() {
  const { accounts } = dashboardAccounts();
  const activeIds = await activeAccountIds();
  if (health.results.length > 0) {
    const current = new Map(accounts.map((account) => [account.key, account]));
    return {
      running: health.running,
      startedAt: health.startedAt,
      finishedAt: health.finishedAt,
      error: health.error,
      results: health.results
        .filter((result) => current.has(result.key))
        .map((result) => healthAccount(
          { ...current.get(result.key), credits: result.credits },
          activeIds,
          result.checkedAt,
        )),
    };
  }
  return {
    running: health.running,
    startedAt: health.startedAt,
    finishedAt: health.finishedAt,
    error: health.error,
    results: accounts.map((account) => healthAccount(account, activeIds)),
  };
}

async function runHealthCheck() {
  if (health.running) return healthSnapshot();
  health.running = true;
  health.startedAt = new Date().toISOString();
  health.error = "";
  try {
    const { accounts } = dashboardAccounts();
    const activeIds = await activeAccountIds();
    const checked = await attachAccountCredits(accounts, true);
    const checkedAt = new Date().toISOString();
    health.results = checked.map((account) => healthAccount(account, activeIds, checkedAt));
    health.finishedAt = checkedAt;
  } catch (err) {
    health.error = err.message || "Pemeriksaan akun gagal";
    health.finishedAt = new Date().toISOString();
  } finally {
    health.running = false;
  }
  return healthSnapshot();
}

async function apiStatus() {
  const [openai, anthropic, watchdog] = await Promise.all([
    fetchStatus(OPENAI_PORT),
    fetchStatus(ANTHROPIC_PORT),
    watchdogState(),
  ]);
  const file = readConfigFile();
  const secretConfigured = Boolean((process.env.ZAI_API_KEY || file.ZAI_API_KEY || "").trim());

  const base = openai.ok ? openai.data : anthropic.ok ? anthropic.data : null;
  const accounts = listAutoClawAccounts().filter((account) => account.hasCredentials !== false);
  const activeIds = new Set(
    [openai, anthropic]
      .filter((lane) => lane.ok)
      .map((lane) => lane.data?.token?.userId)
      .filter((id) => id != null),
  );
  const managedId = getActiveManagedId();
  const managedAccount = managedId ? getManagedAccount(managedId) : null;
  const activeManaged = managedAccount && activeIds.has(String(managedAccount.numericUserId))
    ? publicManagedAccount(managedAccount)
    : null;
  const activeVault = accounts.find((account) =>
    account.numericUserId != null && activeIds.has(String(account.numericUserId))) || null;
  const activeAccount = activeManaged || activeVault;

  return {
    generatedAt: new Date().toISOString(),
    ports: { openai: OPENAI_PORT, anthropic: ANTHROPIC_PORT, dashboard: DASHBOARD_PORT },
    proxies: {
      openai: openai.ok ? openai.data : { error: openai.error },
      anthropic: anthropic.ok ? anthropic.data : { error: anthropic.error },
    },
    watchdog: { task: watchdog },
    config: {
      file: configFilePath(),
      keysFile: keysFilePath(),
      backend: base?.backend || file.GLMP_BACKEND || "autoclaw",
      zaiKeyConfigured: secretConfigured,
      zaiBaseUrl: base?.backend === "zai" ? (file.ZAI_BASE_URL || null) : (file.ZAI_BASE_URL || null),
      accountKey: file.GLMP_AUTOCLAW_ACCOUNT || null,
      managedAccountId: managedId || null,
      activeAccount: activeAccount ? publicAccount(activeAccount) : null,
      effective: base?.config || null,
      fileValues: Object.fromEntries(
        Object.entries(file).map(([k, v]) => [k, SETTINGS[k]?.type === "secret" ? "" : v])
      ),
    },
    keys: publicKeys(),
    logs: listLogFiles(),
  };
}

const STATIC_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

const SPA_ROUTES = new Set([
  "/", "/keys", "/requests", "/settings", "/logs", "/accounts", "/dashboard",
  "/upstream", "/api-docs", "/health",
]);

const OAUTH_PAGE_CSP = [
  "default-src 'self'",
  "script-src 'self' https://o.alicdn.com https://g.alicdn.com",
  "style-src 'self' 'unsafe-inline' https://o.alicdn.com https://g.alicdn.com",
  "img-src 'self' data: https://*.alicdn.com https://*.aliyun.com https://*.aliyuncs.com",
  "font-src 'self' data: https://*.alicdn.com https://*.aliyun.com https://*.aliyuncs.com",
  "connect-src 'self' data: https://*.alicdn.com https://*.aliyun.com https://*.aliyuncs.com",
  "frame-src https://*.alicdn.com https://*.aliyun.com https://*.aliyuncs.com",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
].join("; ");

function serveOAuthPage(res) {
  const file = path.join(PUBLIC_DIR, "oauth-zai.html");
  let data;
  try { data = fs.readFileSync(file); }
  catch { return json(res, 500, { error: "Halaman OAuth tidak ditemukan" }); }
  res.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Content-Security-Policy": OAUTH_PAGE_CSP,
  });
  res.end(data);
}

function serveStatic(res, pathname) {
  const clean = pathname.replace(/\/+$/, "") || "/";
  const rel = clean === "/" ? "index.html" : clean.replace(/^\/+/, "");
  const requestFile = path.resolve(PUBLIC_DIR, rel);
  if (!requestFile.startsWith(PUBLIC_DIR + path.sep) && requestFile !== PUBLIC_DIR) {
    return json(res, 403, { error: "Forbidden" });
  }
  let file = requestFile;
  let data;
  try { data = fs.readFileSync(file); }
  catch {
    if (!SPA_ROUTES.has(clean) || path.extname(clean)) {
      return json(res, 404, { error: "Not found" });
    }
    file = path.join(PUBLIC_DIR, "index.html");
    try { data = fs.readFileSync(file); }
    catch { return json(res, 500, { error: "Dashboard index.html tidak ditemukan" }); }
  }
  res.writeHead(200, {
    "Content-Type": STATIC_TYPES[path.extname(file).toLowerCase()] || "application/octet-stream",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
  });
  res.end(data);
}

async function handle(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || "127.0.0.1"}`);
  const pathname = url.pathname;

  if (pathname === "/api/status" && req.method === "GET") {
    return json(res, 200, await apiStatus());
  }

  if (pathname === "/api/docs" && req.method === "GET") {
    return json(res, 200, apiDocsPayload());
  }

  if (pathname === "/api/health" && req.method === "GET") {
    return json(res, 200, await healthSnapshot());
  }

  if (pathname === "/api/health/run" && req.method === "POST") {
    requireMutation(req);
    return json(res, 200, await runHealthCheck());
  }

  if (pathname === "/api/oauth/zai/config" && req.method === "GET") {
    return json(res, 200, await zaiCaptchaConfig());
  }

  if (pathname === "/api/oauth/zai/start" && req.method === "POST") {
    requireMutation(req);
    const body = await readJsonBody(req);
    const result = await startZaiOAuth({
      verifyParam: String(body.verifyParam || "").trim(),
      deviceId: `oauth-dashboard-${crypto.randomUUID()}`,
    });
    return json(res, 200, { ok: true, url: result.url });
  }

  if (pathname === "/api/logs" && req.method === "GET") {
    const name = url.searchParams.get("name") || "";
    const lines = parseInt(url.searchParams.get("lines") || "300", 10) || 300;
    return json(res, 200, { name, text: tailLog(name, lines) });
  }

  if (pathname === "/api/config" && req.method === "GET") {
    const file = readConfigFile();
    return json(res, 200, {
      file: configFilePath(),
      values: Object.fromEntries(
        Object.entries(file).map(([k, v]) => [k, SETTINGS[k]?.type === "secret" ? "" : v])
      ),
      zaiKeyConfigured: Boolean((process.env.ZAI_API_KEY || file.ZAI_API_KEY || "").trim()),
    });
  }

  if (pathname === "/api/config" && req.method === "PUT") {
    requireMutation(req);
    const body = await readJsonBody(req);
    const patch = {};
    for (const [name, value] of Object.entries(body)) {
      if (value === "" && name !== "ZAI_API_KEY") { patch[name] = ""; continue; }
      if (name === "ZAI_API_KEY" && value === "") continue;
      patch[name] = validateSetting(name, value);
    }
    if (Object.keys(patch).length === 0) {
      return json(res, 400, { error: "Tidak ada setting yang dikirim" });
    }
    writeConfigPatch(patch);
    const reload = await reloadProxies();
    return json(res, 200, { ok: true, saved: Object.keys(patch), reload });
  }

  if (pathname === "/api/keys" && req.method === "GET") {
    return json(res, 200, { keys: publicKeys() });
  }

  if (pathname === "/api/accounts" && req.method === "GET") {
    const { accounts: baseAccounts, activeManagedId, configuredKey } = dashboardAccounts();
    const accounts = await attachAccountCredits(
      baseAccounts,
      url.searchParams.get("refresh") === "1",
    );
    const [openai, anthropic] = await Promise.all([
      fetchStatus(OPENAI_PORT),
      fetchStatus(ANTHROPIC_PORT),
    ]);
    const activeIds = new Set(
      [openai, anthropic]
        .filter((lane) => lane.ok)
        .map((lane) => lane.data?.token?.userId)
        .filter((id) => id != null),
    );
    return json(res, 200, {
      accounts: accounts.map((account) => ({
        ...publicAccount(account),
        active: account.numericUserId != null && activeIds.has(String(account.numericUserId)),
      })),
      configuredKey,
      managedActiveId: activeManagedId,
      backend: openai.ok ? openai.data?.backend : anthropic.ok ? anthropic.data?.backend : null,
    });
  }

  if (pathname === "/api/accounts/checkin" && req.method === "POST") {
    requireMutation(req);
    return json(res, 200, await runCheckinAll());
  }

  if (pathname === "/api/accounts/active" && req.method === "POST") {
    requireMutation(req);
    const body = await readJsonBody(req);
    const key = String(body.key || "").trim();
    let managedActiveId = null;
    if (key) {
      const managed = getManagedAccount(key);
      if (managed) {
        await ensureManagedFresh(managed, 5 * 60 * 1000);
        setActiveManagedAccount(managed.id);
        writeConfigPatch({ GLMP_AUTOCLAW_ACCOUNT: null });
        managedActiveId = managed.id;
      } else {
        const account = listAutoClawAccounts().find((item) => item.key === key);
        if (!account) return json(res, 404, { error: "Akun tidak ditemukan" });
        if (!account.hasCredentials) {
          return json(res, 409, { error: "Akun ini belum punya kredensial. Login dulu di AutoClaw." });
        }
        setActiveManagedAccount(null);
        writeConfigPatch({ GLMP_AUTOCLAW_ACCOUNT: key });
      }
    } else {
      setActiveManagedAccount(null);
      writeConfigPatch({ GLMP_AUTOCLAW_ACCOUNT: null });
    }
    const reload = await reloadProxies();
    return json(res, 200, {
      ok: true,
      configuredKey: managedActiveId ? null : (key || null),
      managedActiveId,
      reload,
    });
  }

  const managedMatch = pathname.match(/^\/api\/accounts\/(m_[a-f0-9]{16})$/);
  if (managedMatch && req.method === "PATCH") {
    requireMutation(req);
    const id = managedMatch[1];
    if (!getManagedAccount(id)) return json(res, 404, { error: "Akun tidak ditemukan" });
    const body = await readJsonBody(req);
    const name = String(body.name || "").trim();
    if (!name || name.length > 60) return json(res, 400, { error: "Nama wajib, maksimal 60 karakter" });
    if (name.includes("@") || /^\+?\d[\d\s().-]{5,}$/.test(name)) {
      return json(res, 400, { error: "Nama tidak boleh email atau nomor telepon" });
    }
    return json(res, 200, { ok: true, account: publicAccount(updateManagedDisplayName(id, name)) });
  }

  if (managedMatch && req.method === "DELETE") {
    requireMutation(req);
    const id = managedMatch[1];
    if (!getManagedAccount(id)) return json(res, 404, { error: "Akun tidak ditemukan" });
    const wasActive = getActiveManagedId() === id;
    removeManagedAccount(id);
    if (wasActive) await reloadProxies();
    return json(res, 200, { ok: true, activeCleared: wasActive });
  }

  if (pathname === "/api/keys" && req.method === "POST") {
    requireMutation(req);
    const body = await readJsonBody(req);
    const name = String(body.name || "").trim();
    if (!name || name.length > 60) return json(res, 400, { error: "Nama kunci wajib, maksimal 60 karakter" });
    const model = body.model ? String(body.model).trim().slice(0, 120) : null;
    const rate = body.requestsPerHour === "" || body.requestsPerHour === undefined || body.requestsPerHour === null
      ? 0 : Number(body.requestsPerHour);
    if (!Number.isFinite(rate) || rate < 0 || rate > 100000) {
      return json(res, 400, { error: "Kuota harus angka 0..100000" });
    }
    const cfg = stateConfig();
    const keys = readKeys(cfg);
    const record = {
      key: generateKey(),
      name,
      model: model || null,
      requestsPerHour: Math.round(rate),
      enabled: true,
      createdAt: new Date().toISOString(),
    };
    keys.push(record);
    writeKeys(cfg, keys);
    return json(res, 201, {
      ok: true,
      key: record.key,
      record: {
        id: keyId(record.key), name: record.name, keyMasked: maskKey(record.key),
        model: record.model, requestsPerHour: record.requestsPerHour,
        enabled: record.enabled, createdAt: record.createdAt,
      },
    });
  }

  const keyMatch = pathname.match(/^\/api\/keys\/([a-f0-9]{12})(\/reset)?$/);
  if (keyMatch) {
    const [, id, resetSuffix] = keyMatch;
    const { cfg, keys, record } = findKey(id);
    if (!record) return json(res, 404, { error: "Kunci tidak ditemukan" });

    if (resetSuffix && req.method === "POST") {
      requireMutation(req);
      keyusage.reset(cfg, record.key);
      return json(res, 200, { ok: true });
    }

    if (req.method === "PATCH") {
      requireMutation(req);
      const body = await readJsonBody(req);
      if (body.name !== undefined) {
        const name = String(body.name).trim();
        if (!name || name.length > 60) return json(res, 400, { error: "Nama tidak valid" });
        record.name = name;
      }
      if (body.model !== undefined) {
        record.model = body.model ? String(body.model).trim().slice(0, 120) : null;
      }
      if (body.requestsPerHour !== undefined) {
        const rate = Number(body.requestsPerHour);
        if (!Number.isFinite(rate) || rate < 0 || rate > 100000) {
          return json(res, 400, { error: "Kuota tidak valid" });
        }
        record.requestsPerHour = Math.round(rate);
      }
      if (body.enabled !== undefined) record.enabled = Boolean(body.enabled);
      writeKeys(cfg, keys);
      return json(res, 200, { ok: true });
    }

    if (req.method === "DELETE") {
      requireMutation(req);
      writeKeys(cfg, keys.filter((k) => k.key !== record.key));
      keyusage.reset(cfg, record.key);
      return json(res, 200, { ok: true });
    }
  }

  if (pathname.startsWith("/api/")) return json(res, 404, { error: "Not found" });
  if (req.method !== "GET" && req.method !== "HEAD") return json(res, 405, { error: "Method not allowed" });
  if (pathname === "/oauth/zai") return serveOAuthPage(res);
  return serveStatic(res, pathname);
}

const server = http.createServer((req, res) => {
  handle(req, res).catch((err) => {
    const status = err?.status || 500;
    if (!res.headersSent) json(res, status, { error: err?.message || "Internal error" });
    else { try { res.end(); } catch { /* closed */ } }
  });
});

server.listen(DASHBOARD_PORT, DASHBOARD_HOST, () => {
  console.log(`Autoclaw dashboard: http://${DASHBOARD_HOST}:${DASHBOARD_PORT}`);
  console.log(`  proxies: openai=${OPENAI_PORT} anthropic=${ANTHROPIC_PORT}`);
  console.log(`  config : ${configFilePath()}`);
  console.log(`  keys   : ${keysFilePath()}`);
});

async function keepActiveManagedTokenFresh() {
  try {
    const id = getActiveManagedId();
    if (!id) return;
    const account = getManagedAccount(id);
    if (account) await ensureManagedFresh(account, 30 * 60 * 1000);
  } catch (err) {
    console.warn(`[accounts] refresh akun dashboard gagal: ${err.message}`);
  }
}

setTimeout(keepActiveManagedTokenFresh, 5000).unref();
setInterval(keepActiveManagedTokenFresh, 10 * 60 * 1000).unref();
