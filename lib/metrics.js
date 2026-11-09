/**
 * Per-process request metrics: counters plus a small in-memory ring.
 *
 * The dashboard aggregates these across the two entrypoints. Nothing here is
 * persisted: it is observability for a running process, not billing data (the
 * per-key lifetime counters in keyusage.js are the persisted record).
 */

const MAX_RECENT = 300;

export function createMetrics() {
  const startedAt = Date.now();
  const byStatus = {};
  const byModel = {};
  const byKey = {};
  const byError = {};
  let total = 0;
  let tokens = 0;
  let latencySum = 0;
  const recent = [];

  function record({ key = "operator", model = null, status = 0, error = null, latencyMs = 0, stream = false, queueWaitMs = 0, tokens: used = 0 } = {}) {
    total += 1;
    const s = String(status);
    byStatus[s] = (byStatus[s] || 0) + 1;
    if (model) byModel[model] = (byModel[model] || 0) + 1;
    byKey[key] = (byKey[key] || 0) + 1;
    if (error) byError[error] = (byError[error] || 0) + 1;
    if (Number.isFinite(latencyMs) && latencyMs >= 0) latencySum += latencyMs;
    if (Number.isFinite(used) && used > 0) tokens += used;
    recent.push({
      ts: new Date().toISOString(),
      key,
      model,
      status,
      error,
      latencyMs: Number.isFinite(latencyMs) ? Math.max(0, Math.round(latencyMs)) : 0,
      stream: Boolean(stream),
      queueWaitMs: Number.isFinite(queueWaitMs) ? Math.max(0, Math.round(queueWaitMs)) : 0,
      tokens: Number.isFinite(used) ? used : 0,
    });
    if (recent.length > MAX_RECENT) recent.splice(0, recent.length - MAX_RECENT);
  }

  function snapshot({ recentLimit = 60 } = {}) {
    const limit = Math.max(0, Math.min(MAX_RECENT, Number(recentLimit) || 0));
    return {
      startedAt: new Date(startedAt).toISOString(),
      uptimeMs: Date.now() - startedAt,
      total,
      tokens,
      avgLatencyMs: total > 0 ? Math.round(latencySum / total) : 0,
      byStatus: { ...byStatus },
      byModel: { ...byModel },
      byKey: { ...byKey },
      byError: { ...byError },
      recent: limit ? recent.slice(-limit) : [],
    };
  }

  return { record, snapshot };
}
