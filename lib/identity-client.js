// Shared AutoClaw identity-layer client: the signed and unsigned POST helpers
// plus the login-failure message map. Used by the dashboard (login, refresh,
// credits) and by the failover switcher — one copy of the signing facts so a
// version bump never has to be applied twice.
//
// Distinct from lib/identity.js, which owns the outgoing CLIENT identity
// headers (runtime discovery). This module owns the AutoClaw ACCOUNT identity
// endpoints (userapi / agent-assetmgr signing).
//
// GLMP_IDENTITY_BASE overrides the identity host per call (tests point it at a
// local mock; production leaves it unset).

import crypto from "node:crypto";

export const AUTOCLAW_APP_ID = "100003";
export const AUTOCLAW_APP_KEY = "38d2391985e2369a5fb8227d8e6cd5e5";
export const IDENTITY_BASE = "https://autoglm-api.autoglm.ai";

export function identityBase() {
  const override = (process.env.GLMP_IDENTITY_BASE || "").trim();
  return override || IDENTITY_BASE;
}

export function identityError(message, status = 400) {
  return Object.assign(new Error(message), { status });
}

// The upstream failure-code map for login/refresh endpoints. Callers that need
// the RAW code (failover treats 410004 as a permanent ban) read body.code
// directly — this mapper is for human-facing messages only.
export function identityFailure(body) {
  const messages = {
    400001: "Data login tidak valid",
    400002: "AutoClaw menolak permintaan login (middleware)",
    410000: "Sesi AutoClaw berakhir. Login ulang.",
    410004: "Akun diblokir AutoClaw (User banned)",
    630006: "Nomor HP tidak valid",
    630201: "Kode salah",
    630202: "Kode kedaluwarsa, minta kode baru",
    630203: "Terlalu banyak percobaan, tunggu sebentar",
  };
  const status = body.code === 429 || body.code === 630203 ? 429 : 400;
  return identityError(messages[body.code] || `Login AutoClaw gagal (kode ${body.code})`, status);
}

// Unsigned POST used by the refresh chain — the same shape the dashboard has
// always sent for /userapi/v1/refresh and /userapi/v1/agent-refresh.
export async function identityPost(pathname, payload, { timeoutMs = 15000 } = {}) {
  let res;
  try {
    res = await fetch(`${identityBase()}${pathname}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    throw identityError(`Tidak bisa menghubungi AutoClaw: ${err.message}`, 502);
  }
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); }
  catch { throw identityError("Respons login AutoClaw bukan JSON", 502); }
  if (!body || typeof body.code !== "number") throw identityError("Respons login AutoClaw tidak dikenal", 502);
  return { httpStatus: res.status, body };
}

// X-Auth-Sign = md5(appId & epochSeconds & appKey) with the full client header
// set — mirrors what the AutoClaw desktop app sends on its signed endpoints.
export function signedAutoClawHeaders() {
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

export async function signedAutoClawPost(pathname, payload, { timeoutMs = 20000 } = {}) {
  let res;
  try {
    res = await fetch(`${identityBase()}${pathname}`, {
      method: "POST",
      headers: signedAutoClawHeaders(),
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    throw identityError(`Tidak bisa menghubungi AutoClaw: ${err.message}`, 502);
  }
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); }
  catch { throw identityError("Respons AutoClaw bukan JSON", 502); }
  if (!body || typeof body.code !== "number") throw identityError("Respons AutoClaw tidak dikenal", 502);
  return { httpStatus: res.status, body };
}
