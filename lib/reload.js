/**
 * Hot configuration reload shared by both entrypoints.
 *
 * Only fields that are safe to change while requests are in flight are applied.
 * Everything else (ports, upstream host, state dir) needs a process restart.
 */

import { loadConfig } from "./core.js";
import { applyConfigFile, readConfigFile } from "./runtime-config.js";

const HOT_FIELDS = [
  "BUDGET_REQUESTS_PER_HOUR",
  "MIN_GAP_MS",
  "MAX_MESSAGES",
  "THROTTLE_RETRIES",
  "THROTTLE_RETRY_MS",
  "UPSTREAM_TIMEOUT_MS",
  "HEARTBEAT_INTERVAL_MS",
  "QUEUE_MAX_DEPTH",
  "QUEUE_WAIT_MS",
  "KEY_WINDOW_MS",
  "PROMPT_ENVELOPE_KB",
  "BACKEND",
  "ZAI_API_KEY",
  "ZAI_BASE_URL",
  "ZAI_DEFAULT_MODEL",
  "ZAI_MODEL_OPUS",
  "ZAI_MODEL_SONNET",
  "ZAI_MODEL_HAIKU",
  "FOREIGN_IDENTITY_GUARD",
  "SYSTEM_QUARANTINE",
  "AUTOCLAW_ACCOUNT_KEY",
];

export function reloadConfig(config, format, { governor = null, queue = null } = {}) {
  applyConfigFile();
  const fresh = loadConfig({ format });

  for (const key of HOT_FIELDS) {
    if (key in fresh) config[key] = fresh[key];
  }
  if (governor) {
    governor.setBudget(config.BUDGET_REQUESTS_PER_HOUR);
    governor.setMinGap(config.MIN_GAP_MS);
  }
  if (queue) {
    queue.configure({ maxDepth: config.QUEUE_MAX_DEPTH, waitTimeoutMs: config.QUEUE_WAIT_MS });
  }

  return {
    ok: true,
    applied: Object.fromEntries(HOT_FIELDS.map((key) => [key, config[key]])),
    file: readConfigFile(),
    restartRequired: ["PORT", "HOST", "UPSTREAM_HOST", "UPSTREAM_PORT", "PROXY_KEY"],
  };
}
