/**
 * Operational status and per-key stats handlers shared by both entrypoints.
 *
 * Only local state and token *claims* are exposed; the bearer token and client
 * keys are never returned.
 */

import { sendJSON, VERSION } from "./core.js";
import { maskId } from "./keystore.js";

function safeToken(getToken) {
  return (async () => {
    try {
      const token = await getToken();
      return { ok: true, error: null, token };
    } catch (err) {
      return { ok: false, error: String(err?.message || err), token: null };
    }
  })();
}

export function makeStatusHandler({ config, format, governor, getToken, getModels, queue, metrics, auth }) {
  return async function handleStatus(req, res) {
    const tokenState = await safeToken(getToken);

    let account = null;
    try {
      account = governor.accountInfo(null, tokenState.token);
    } catch (err) {
      account = { ...governor.state(), error: String(err?.message || err) };
    }

    const q = {
      active: queue.activeCount,
      waiting: queue.waitingCount,
      maxDepth: queue.maxDepth,
      waitTimeoutMs: queue.waitTimeoutMs,
    };

    const m = metrics.snapshot({ recentLimit: 80 });
    const recent = m.recent.map((r) => ({ ...r, key: maskId(r.key) }));
    const byKey = {};
    for (const [id, n] of Object.entries(m.byKey)) byKey[maskId(id)] = n;
    const usage = auth.usageFor(req.auth);

    const payload = {
      format,
      port: config.PORT,
      host: config.HOST,
      version: VERSION,
      backend: config.BACKEND,
      pid: process.pid,
      uptimeMs: Math.round(process.uptime() * 1000),
      token: {
        ok: tokenState.ok,
        error: tokenState.error,
        userId: account?.userId ?? null,
        isGuest: account?.isGuest ?? null,
        exp: account?.exp ?? null,
        lifetimeSeconds: account?.lifetimeSeconds ?? null,
        source: account?.source ?? null,
      },
      governor: {
        state: account?.state,
        key: account?.key ?? null,
        budget: account?.budget ?? null,
        windowRequests: account?.windowRequests ?? 0,
        pctBudget: account?.pctBudget ?? null,
        nextWindowAt: account?.nextWindowAt ?? null,
        retryAfterMs: account?.retryAfterMs ?? 0,
        backoffLevel: account?.backoffLevel ?? 0,
        estimatedTokens: account?.estimatedTokens ?? 0,
        estimatedCredits: account?.estimatedCredits ?? null,
      },
      queue: q,
      models: getModels(),
      config: {
        budgetRequestsPerHour: config.BUDGET_REQUESTS_PER_HOUR,
        minGapMs: config.MIN_GAP_MS,
        queueMaxDepth: config.QUEUE_MAX_DEPTH,
        queueWaitMs: config.QUEUE_WAIT_MS,
        maxMessages: Number.isFinite(config.MAX_MESSAGES) ? config.MAX_MESSAGES : null,
        upstreamTimeoutMs: config.UPSTREAM_TIMEOUT_MS,
        throttleRetries: config.THROTTLE_RETRIES,
        heartbeatIntervalMs: config.HEARTBEAT_INTERVAL_MS,
        governorPersist: config.GOVERNOR_PERSIST,
        keyCount: (auth.listKeys().keys || []).length,
        backend: config.BACKEND,
      },
      metrics: {
        startedAt: m.startedAt,
        uptimeMs: m.uptimeMs,
        total: m.total,
        tokens: m.tokens,
        avgLatencyMs: m.avgLatencyMs,
        byStatus: m.byStatus,
        byModel: m.byModel,
        byKey,
        byError: m.byError,
      },
      recent,
      client: usage,
    };

    if (req.auth?.admin) {
      payload.keys = auth.listKeys();
    }

    sendJSON(res, payload);
  };
}

export function makeStatsHandler({ governor, getToken, auth }) {
  return async function handleStats(req, res) {
    let tokenState;
    try {
      tokenState = await safeToken(getToken);
    } catch {
      tokenState = { ok: false, error: "token check failed" };
    }
    let account = null;
    try { account = governor.accountInfo(null, tokenState.token); } catch { account = governor.state(); }

    sendJSON(res, {
      key: auth.maskId(req.auth?.id),
      name: req.auth?.name || null,
      admin: Boolean(req.auth?.admin),
      model: req.auth?.model || null,
      requestsPerHour: req.auth?.requestsPerHour || 0,
      usage: auth.usageFor(req.auth),
      account: {
        state: account?.state,
        budget: account?.budget,
        windowRequests: account?.windowRequests,
        pctBudget: account?.pctBudget,
        nextWindowAt: account?.nextWindowAt,
        retryAfterMs: account?.retryAfterMs,
      },
      token: tokenState,
    });
  };
}
