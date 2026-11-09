/**
 * Client API keys (keys.json).
 *
 * PROXY_KEY remains the operator key and is always accepted. Additional keys
 * live in keys.json next to config.json so both proxy processes and the
 * dashboard read the same file; the proxy reloads it when the mtime changes.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { keysFilePath } from "./runtime-config.js";

export function submitPath(config = null) {
  return (config && config.KEYS_FILE) || keysFilePath();
}

export function readKeys(config = null) {
  const file = submitPath(config);
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    const list = Array.isArray(parsed) ? parsed : parsed?.keys;
    if (!Array.isArray(list)) return [];
    return list
      .filter((k) => k && typeof k.key === "string" && k.key.length > 0)
      .map((k) => ({
        key: k.key,
        name: typeof k.name === "string" ? k.name : "key",
        model: typeof k.model === "string" && k.model ? k.model : null,
        requestsPerHour: Number.isFinite(Number(k.requestsPerHour)) ? Math.max(0, Math.floor(Number(k.requestsPerHour))) : 0,
        enabled: k.enabled !== false,
        createdAt: typeof k.createdAt === "string" ? k.createdAt : null,
      }));
  } catch {
    return [];
  }
}

export function writeKeys(config, keys) {
  const file = submitPath(config);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${Date.now()}.${crypto.randomUUID().slice(0, 8)}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ keys }, null, 2) + "\n", "utf8");
  fs.renameSync(tmp, file);
  return keys;
}

export function generateKey() {
  return `pk_${crypto.randomBytes(16).toString("hex")}`;
}

export function maskKey(key) {
  const raw = String(key || "");
  if (raw.length <= 12) return raw;
  return `${raw.slice(0, 8)}...${raw.slice(-4)}`;
}

export function maskId(id) {
  const raw = String(id || "");
  if (raw === "operator") return raw;
  if (raw.length <= 10) return raw;
  return `${raw.slice(0, 6)}...${raw.slice(-4)}`;
}
