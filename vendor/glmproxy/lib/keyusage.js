/**
 * Per-key request quota and lifetime counters.
 *
 * Stored in the proxy state dir so both entrypoints share one rolling window.
 * Every mutation is an exclusive-lock read-modify-write: the two proxies run as
 * separate processes and an unlocked write would silently drop the other's
 * usage (the same failure mode the request-ring logger documents).
 */

import fs from "node:fs";
import path from "node:path";

import { readJsonSafe, stateDir, writeJsonAtomic } from "./state.js";

export const KEY_USAGE_FILE = "keys-usage.json";
export const DEFAULT_KEY_WINDOW_MS = 60 * 60 * 1000;

function fileOf(config) {
  return path.join(stateDir(config), KEY_USAGE_FILE);
}

function lockFile(config) {
  return `${fileOf(config)}.lock`;
}

function sleep(ms) {
  try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); }
  catch { const end = Date.now() + ms; while (Date.now() < end) { /* spin */ } }
}

function acquire(config, deadlineMs = 1500) {
  const lock = lockFile(config);
  const deadline = Date.now() + deadlineMs;
  for (;;) {
    try {
      fs.writeFileSync(lock, String(process.pid), { flag: "wx" });
      return true;
    } catch {
      try {
        if (Date.now() - fs.statSync(lock).mtimeMs > 3000) { fs.unlinkSync(lock); continue; }
      } catch { /* lock vanished between stat and unlink */ }
      if (Date.now() > deadline) return false;
      sleep(20);
    }
  }
}

function release(config) {
  try { fs.unlinkSync(lockFile(config)); } catch { /* already gone */ }
}

function read(config) {
  const data = readJsonSafe(fileOf(config), null);
  if (!data || typeof data !== "object") return { version: 1, keys: {} };
  if (!data.keys || typeof data.keys !== "object") data.keys = {};
  return data;
}

function recordOf(data, keyId) {
  let rec = data.keys[keyId];
  if (!rec || typeof rec !== "object") {
    rec = {
      timestamps: [],
      totalRequests: 0,
      success: 0,
      errors: 0,
      tokens: 0,
      lastUsed: null,
      lastModel: null,
      lastStatus: null,
    };
    data.keys[keyId] = rec;
  }
  if (!Array.isArray(rec.timestamps)) rec.timestamps = [];
  return rec;
}

function prune(rec, now, windowMs) {
  const cutoff = now - windowMs;
  while (rec.timestamps.length && rec.timestamps[0] <= cutoff) rec.timestamps.shift();
}

export function consume(config, keyId, limit, windowMs = DEFAULT_KEY_WINDOW_MS) {
  const now = Date.now();
  const locked = acquire(config);
  try {
    const data = read(config);
    const rec = recordOf(data, keyId);
    prune(rec, now, windowMs);

    const max = Number(limit) > 0 ? Math.floor(Number(limit)) : 0;
    if (max > 0 && rec.timestamps.length >= max) {
      return {
        ok: false,
        used: rec.timestamps.length,
        limit: max,
        retryAfterMs: Math.max(0, rec.timestamps[0] + windowMs - now),
      };
    }

    rec.timestamps.push(now);
    rec.totalRequests += 1;
    rec.lastUsed = new Date(now).toISOString();
    writeJsonAtomic(fileOf(config), data);
    return { ok: true, used: rec.timestamps.length, limit: max, retryAfterMs: 0 };
  } finally {
    if (locked) release(config);
  }
}

export function record(config, keyId, { status = 0, tokens = 0, model = null } = {}) {
  const locked = acquire(config);
  try {
    const data = read(config);
    const rec = recordOf(data, keyId);
    if (status >= 200 && status < 400) rec.success += 1;
    else rec.errors += 1;
    if (Number.isFinite(tokens) && tokens > 0) rec.tokens += Math.floor(tokens);
    rec.lastStatus = status;
    if (model) rec.lastModel = model;
    rec.lastUsed = new Date().toISOString();
    writeJsonAtomic(fileOf(config), data);
  } finally {
    if (locked) release(config);
  }
}

export function snapshot(config, keyId, limit = 0, windowMs = DEFAULT_KEY_WINDOW_MS) {
  const now = Date.now();
  const data = read(config);
  const rec = data.keys[keyId];
  if (!rec) {
    return {
      used: 0, limit: Number(limit) || 0, remaining: Number(limit) || null,
      windowMs, totalRequests: 0, success: 0, errors: 0, tokens: 0,
      lastUsed: null, lastModel: null, lastStatus: null,
    };
  }
  const timestamps = Array.isArray(rec.timestamps) ? rec.timestamps.filter((t) => t > now - windowMs) : [];
  const max = Number(limit) > 0 ? Math.floor(Number(limit)) : 0;
  return {
    used: timestamps.length,
    limit: max,
    remaining: max > 0 ? Math.max(0, max - timestamps.length) : null,
    windowResetAt: timestamps.length ? new Date(timestamps[0] + windowMs).toISOString() : null,
    windowMs,
    totalRequests: rec.totalRequests || 0,
    success: rec.success || 0,
    errors: rec.errors || 0,
    tokens: rec.tokens || 0,
    lastUsed: rec.lastUsed || null,
    lastModel: rec.lastModel || null,
    lastStatus: rec.lastStatus ?? null,
  };
}

export function all(config, windowMs = DEFAULT_KEY_WINDOW_MS) {
  const data = read(config);
  const out = {};
  for (const id of Object.keys(data.keys)) out[id] = snapshot(config, id, 0, windowMs);
  return out;
}

export function reset(config, keyId) {
  const locked = acquire(config);
  try {
    const data = read(config);
    if (keyId) delete data.keys[keyId];
    else data.keys = {};
    writeJsonAtomic(fileOf(config), data);
    return true;
  } finally {
    if (locked) release(config);
  }
}

export function addTokens(config, keyId, count) {
  const n = Number(count);
  if (!Number.isFinite(n) || n <= 0) return;
  const locked = acquire(config);
  try {
    const data = read(config);
    const rec = recordOf(data, keyId);
    rec.tokens += Math.floor(n);
    writeJsonAtomic(fileOf(config), data);
  } finally {
    if (locked) release(config);
  }
}
