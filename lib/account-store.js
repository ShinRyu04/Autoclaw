import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const STATE_DIR = process.env.GLMP_STATE_DIR || path.join(ROOT, "proxy-state");
const STORE_FILE = process.env.GLMP_MANAGED_STORE || path.join(STATE_DIR, "managed-accounts.enc");
const KEY_FILE = path.join(STATE_DIR, "managed-accounts.key");
const ACTIVE_TOKEN_SKEW_MS = 2 * 60 * 1000;

let cache = null;

function emptyStore() {
  return { version: 1, activeId: null, accounts: [] };
}

function runPowerShell(script, input) {
  const res = spawnSync("powershell.exe", [
    "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script,
  ], {
    env: { ...process.env, GLMP_DPAPI_INPUT: input },
    timeout: 15000,
    maxBuffer: 8 * 1024 * 1024,
    windowsHide: true,
  });
  if (res.error) throw res.error;
  if (res.status !== 0) throw new Error((res.stderr || "").toString("utf8").trim() || "DPAPI gagal");
  return (res.stdout || "").toString("utf8").trim();
}

function dpapiProtect(text) {
  return runPowerShell(
    "Add-Type -AssemblyName System.Security; " +
    "$bytes=[Convert]::FromBase64String($env:GLMP_DPAPI_INPUT);" +
    "$protected=[Security.Cryptography.ProtectedData]::Protect($bytes,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser);" +
    "[Console]::Out.Write([Convert]::ToBase64String($protected))",
    Buffer.from(text, "utf8").toString("base64"),
  );
}

function dpapiUnprotect(text) {
  return runPowerShell(
    "Add-Type -AssemblyName System.Security; " +
    "$bytes=[Convert]::FromBase64String($env:GLMP_DPAPI_INPUT);" +
    "$plain=[Security.Cryptography.ProtectedData]::Unprotect($bytes,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser);" +
    "[Console]::Out.Write([Text.Encoding]::UTF8.GetString($plain))",
    String(text),
  );
}

function aesKey() {
  if (!fs.existsSync(KEY_FILE)) {
    fs.mkdirSync(path.dirname(KEY_FILE), { recursive: true, mode: 0o700 });
    fs.writeFileSync(KEY_FILE, crypto.randomBytes(32), { mode: 0o600 });
    try { fs.chmodSync(KEY_FILE, 0o600); } catch {}
  }
  return fs.readFileSync(KEY_FILE);
}

function protect(text) {
  if (process.platform === "win32") return { alg: "dpapi", data: dpapiProtect(text) };
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", aesKey(), iv);
  const data = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  return { alg: "aes-256-gcm", iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), data: data.toString("base64") };
}

function unprotect(envelope) {
  if (envelope.alg === "dpapi") return dpapiUnprotect(envelope.data);
  if (envelope.alg === "aes-256-gcm") {
    const decipher = crypto.createDecipheriv("aes-256-gcm", aesKey(), Buffer.from(envelope.iv, "base64"));
    decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(envelope.data, "base64")), decipher.final()]).toString("utf8");
  }
  throw new Error("format penyimpanan akun tidak dikenal");
}

function parseStore(raw) {
  const parsed = JSON.parse(raw);
  if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.accounts)) throw new Error("isi penyimpanan akun rusak");
  return {
    version: 1,
    activeId: typeof parsed.activeId === "string" ? parsed.activeId : null,
    accounts: parsed.accounts.filter((a) => a && typeof a.id === "string" && typeof a.accessToken === "string"),
  };
}

export function loadStore() {
  let stat;
  try { stat = fs.statSync(STORE_FILE); } catch { cache = emptyStore(); return cache; }
  if (cache && cache.mtimeMs === stat.mtimeMs) return cache.store;
  const envelope = JSON.parse(fs.readFileSync(STORE_FILE, "utf8"));
  const store = normalizeManagedIdentity(parseStore(unprotect(envelope)));
  cache = { mtimeMs: stat.mtimeMs, store };
  return store;
}

export function saveStore(store) {
  const next = normalizeManagedIdentity(parseStore(JSON.stringify(store)));
  fs.mkdirSync(path.dirname(STORE_FILE), { recursive: true, mode: 0o700 });
  const envelope = protect(JSON.stringify(next));
  const tmp = `${STORE_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(envelope), { mode: 0o600 });
  fs.renameSync(tmp, STORE_FILE);
  try { fs.chmodSync(STORE_FILE, 0o600); } catch {}
  const stat = fs.statSync(STORE_FILE);
  cache = { mtimeMs: stat.mtimeMs, store: next };
  return next;
}

function tokenClaims(token) {
  try {
    const raw = String(token).replace(/^Bearer\s+/i, "");
    return JSON.parse(Buffer.from(raw.split(".")[1], "base64url").toString("utf8"));
  } catch { return null; }
}

function tokenExpiry(token) {
  const payload = tokenClaims(token);
  return Number.isFinite(payload?.exp) ? payload.exp * 1000 : null;
}

function tokenNumericUserId(token) {
  const payload = tokenClaims(token);
  return payload?.user_id == null || payload.user_id === "" ? null : String(payload.user_id);
}

function normalizeManagedIdentity(store) {
  const renamed = new Map();
  for (const account of store.accounts) {
    const userId = tokenNumericUserId(account.accessToken);
    if (userId) account.numericUserId = userId;
    const nextId = managedId(account.numericUserId || account.accountId || account.phone, account.provider);
    if (account.id !== nextId) {
      renamed.set(account.id, nextId);
      account.id = nextId;
    }
  }
  if (store.activeId && renamed.has(store.activeId)) store.activeId = renamed.get(store.activeId);
  return store;
}

export function normalizeToken(token) {
  const value = String(token || "").trim();
  if (!value) return "";
  return /^Bearer\s+/i.test(value) ? value : `Bearer ${value}`;
}

export function managedId(accountId, provider = "phone") {
  return `m_${crypto.createHash("sha256").update(`${provider}:${String(accountId)}`).digest("hex").slice(0, 16)}`;
}

export function publicManagedAccount(account) {
  return {
    key: account.id,
    id: account.id,
    source: "dashboard",
    provider: account.provider,
    displayName: account.displayName || "Akun dashboard",
    numericUserId: account.numericUserId || null,
    hasCredentials: true,
    lastLoginAt: account.lastLoginAt || null,
    expiresAt: account.expiresAt || null,
    active: false,
  };
}

export function listManagedAccounts() {
  return loadStore().accounts.map(publicManagedAccount);
}

export function getActiveManagedId() {
  return loadStore().activeId;
}

export function getManagedAccount(id) {
  return loadStore().accounts.find((a) => a.id === id) || null;
}

export function findManagedByNumericId(numericUserId) {
  return loadStore().accounts.find((a) => String(a.numericUserId) === String(numericUserId)) || null;
}

export function setActiveManagedAccount(id) {
  const store = loadStore();
  store.activeId = id || null;
  return saveStore(store);
}

export function upsertManagedAccount(input) {
  const store = loadStore();
  const numericUserId = tokenNumericUserId(input.accessToken)
    || (input.numericUserId == null || input.numericUserId === "" ? null : String(input.numericUserId));
  const id = managedId(numericUserId || input.accountId || input.phone, input.provider);
  const now = new Date().toISOString();
  const existing = store.accounts.find((a) => a.id === id);
  const account = {
    id,
    provider: input.provider || "phone",
    numericUserId,
    displayName: input.displayName || null,
    phone: input.phone || null,
    email: input.email || null,
    deviceId: input.deviceId,
    accessToken: normalizeToken(input.accessToken),
    refreshToken: input.refreshToken || null,
    expiresAt: input.expiresAt || tokenExpiry(input.accessToken),
    createdAt: existing?.createdAt || now,
    lastLoginAt: now,
  };
  if (existing) Object.assign(existing, account);
  else store.accounts.push(account);
  saveStore(store);
  return publicManagedAccount(account);
}

export function updateManagedDisplayName(id, displayName) {
  const store = loadStore();
  const account = store.accounts.find((a) => a.id === id);
  if (!account) throw new Error("akun tidak ditemukan");
  account.displayName = String(displayName || "").trim() || null;
  saveStore(store);
  return publicManagedAccount(account);
}

export function updateManagedTokens(id, { accessToken, refreshToken }) {
  const store = loadStore();
  const account = store.accounts.find((a) => a.id === id);
  if (!account) throw new Error("akun tidak ditemukan");
  account.accessToken = normalizeToken(accessToken);
  if (refreshToken) account.refreshToken = refreshToken;
  account.expiresAt = tokenExpiry(account.accessToken);
  account.lastLoginAt = account.lastLoginAt || new Date().toISOString();
  saveStore(store);
  return account;
}

export function removeManagedAccount(id) {
  const store = loadStore();
  store.accounts = store.accounts.filter((a) => a.id !== id);
  if (store.activeId === id) store.activeId = null;
  saveStore(store);
}

export function activeManagedToken() {
  const store = loadStore();
  if (!store.activeId) return null;
  const account = store.accounts.find((a) => a.id === store.activeId);
  if (!account) throw new Error("akun dashboard yang dipilih tidak ditemukan");
  if (account.expiresAt && account.expiresAt <= Date.now() + ACTIVE_TOKEN_SKEW_MS) {
    throw new Error("token akun dashboard kedaluwarsa; buka dashboard untuk refresh");
  }
  return account.accessToken;
}

export { STORE_FILE };
