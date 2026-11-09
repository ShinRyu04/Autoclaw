/**
 * Client authentication plus per-key quota.
 *
 * PROXY_KEY is the operator key: always accepted, always unbounded by per-key
 * quota (the account governor still applies). Additional keys come from
 * keys.json and may carry a model pin and an hourly request limit.
 */

import fs from "node:fs";

import { readKeys, maskKey, maskId } from "./keystore.js";
import * as keyusage from "./keyusage.js";

function extractKey(req) {
  const header = req.headers["authorization"] || req.headers["x-api-key"] || "";
  return header.startsWith("Bearer ") ? header.slice(7) : header;
}

export function createAuth(config, log = null) {
  const file = config.KEYS_FILE;
  let stamp = 0;
  let cache = [];

  function keys() {
    try {
      const mtime = fs.statSync(file).mtimeMs;
      if (mtime !== stamp) {
        cache = readKeys(config);
        stamp = mtime;
      }
    } catch {
      // Missing file: keep the previous list only if it came from a real file,
      // otherwise an operator deleting keys.json must actually drop the keys.
      if (stamp !== 0) {
        cache = [];
        stamp = 0;
      }
    }
    return cache;
  }

  function authenticate(req) {
    const raw = extractKey(req);
    if (!raw) {
      if (!config.PROXY_KEY) return { id: "operator", name: "Operator", admin: true, model: null, requestsPerHour: 0 };
      return null;
    }
    if (config.PROXY_KEY && raw === config.PROXY_KEY) {
      return { id: "operator", name: "Operator", admin: true, model: null, requestsPerHour: 0 };
    }
    const record = keys().find((k) => k.key === raw && k.enabled !== false);
    if (!record) return null;
    return {
      id: record.key,
      name: record.name,
      admin: false,
      model: record.model,
      requestsPerHour: record.requestsPerHour,
    };
  }

  function consumeQuota(auth) {
    if (!auth) return { ok: true };
    const limit = auth.admin ? 0 : auth.requestsPerHour;
    return keyusage.consume(config, auth.id, limit, config.KEY_WINDOW_MS);
  }

  function recordUsage(auth, info) {
    if (!auth) return;
    try { keyusage.record(config, auth.id, info); }
    catch (err) { log?.warn?.(`auth: could not record key usage (${err.message})`); }
  }

  function addTokens(auth, count) {
    if (!auth) return;
    try { keyusage.addTokens(config, auth.id, count); }
    catch (err) { log?.warn?.(`auth: could not record key tokens (${err.message})`); }
  }

  function usageFor(auth) {
    if (!auth) return null;
    return keyusage.snapshot(config, auth.id, auth.admin ? 0 : auth.requestsPerHour, config.KEY_WINDOW_MS);
  }

  function listKeys() {
    const usage = keyusage.all(config, config.KEY_WINDOW_MS);
    const live = keys().map((k) => ({
      key: maskKey(k.key),
      name: k.name,
      model: k.model,
      requestsPerHour: k.requestsPerHour,
      enabled: k.enabled,
      createdAt: k.createdAt,
      usage: keyusage.snapshot(config, k.key, k.requestsPerHour, config.KEY_WINDOW_MS),
    }));
    const operator = usage.operator || null;
    return { keys: live, operator: operator ? { name: "Operator", usage: operator } : null };
  }

  return {
    authenticate,
    consumeQuota,
    recordUsage,
    addTokens,
    usageFor,
    listKeys,
    maskId,
    reload: () => { stamp = 0; keys(); },
  };
}

export { maskKey, maskId };
