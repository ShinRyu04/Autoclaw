/**
 * Runtime configuration file (config.json).
 *
 * The proxy historically read only environment variables. This layer keeps
 * that contract (env always wins) while letting the dashboard persist settings
 * without a restart: values from config.json are injected into process.env,
 * and a reload removes exactly the keys this module injected before re-reading
 * the file, so an operator-set variable is never clobbered.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const injected = new Set();

export function projectRoot() {
  const override = (process.env.GLMP_HOME || "").trim();
  if (override) return path.resolve(override);
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
}

export function configFilePath() {
  return (process.env.GLMP_CONFIG_PATH || "").trim() || path.join(projectRoot(), "config.json");
}

export function keysFilePath() {
  return (process.env.GLMP_KEYS_FILE || "").trim() || path.join(projectRoot(), "keys.json");
}

function normalizeValue(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "boolean") return value ? "1" : "0";
  return String(value);
}

// Never throws: a missing or malformed file simply means "no overrides".
export function readConfigFile() {
  try {
    const raw = fs.readFileSync(configFilePath(), "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed;
  } catch {
    return {};
  }
}

/**
 * Inject config.json values that are not already set in the environment.
 * Re-entrant: previous injections are removed first, so a reload sees the new
 * file instead of the values it injected on the previous call.
 */
export function applyConfigFile() {
  for (const key of injected) delete process.env[key];
  injected.clear();

  const file = readConfigFile();
  for (const [key, value] of Object.entries(file)) {
    if (!/^[A-Z][A-Z0-9_]*$/.test(key)) continue; // env-style keys only
    if (process.env[key] !== undefined) continue; // real env wins
    process.env[key] = normalizeValue(value);
    injected.add(key);
  }
  return file;
}

export function writeConfigPatch(patch) {
  const current = readConfigFile();
  const next = { ...current, ...patch };
  for (const [key, value] of Object.entries(next)) {
    if (value === null || value === undefined || value === "") delete next[key];
  }
  const file = configFilePath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${Date.now()}.${crypto.randomUUID().slice(0, 8)}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2) + "\n", "utf8");
  fs.renameSync(tmp, file);
  return next;
}
