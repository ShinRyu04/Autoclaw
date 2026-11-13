// Automatic account failover for the autoclaw backend.
//
// Trigger: the ACTIVE account dies upstream — a ban verdict (code 410004
// "User banned") or a session-death verdict (410000 "Please log in"). The lane
// has already told the client the request failed; this module's job is to make
// sure the NEXT request does not fail the same way.
//
// Rotation is deliberately NOT implemented: switching accounts around healthy
// upstreams is a ban risk (device-id correlation) and muddies per-account
// budget accounting. Failover only ever fires on upstream death.
//
// Candidate ranking: managed accounts only (dashboard OAuth entries carry a
// stored refresh token; vault accounts need the desktop app), excluding the
// current active, freshest stored token first. Each candidate is probed with
// the real refresh chain before activation — a banned or expired candidate is
// skipped, not activated. All candidates failing returns null and the lane
// answers exactly as before.
//
// The identity client is injectable so tests run hermetically against a local
// mock — production never overrides it.

import {
  identityPost,
  identityFailure,
  identityError,
} from "./identity-client.js";
import {
  listManagedAccounts,
  getManagedAccount,
  getActiveManagedId,
  setActiveManagedAccount,
  updateManagedTokens,
} from "./account-store.js";

// Body codes that mean the ACTIVE account cannot serve another request.
// 410004 "User banned" is permanent; 410000 "Please log in to continue" is
// session death. Both arrive inside HTTP 200 bodies on the identity API, and
// as 403/401 on the chat proxy.
export const DEATH_CODES = new Set([410000, 410004]);

// Does this upstream body mean the active account is dead?
export function isDeathBody(statusCode, bodyText) {
  const text = String(bodyText || "");
  if (!text) return false;
  // The chat proxy wraps the ban as 403 with the code or the Chinese ban text
  // in the body; session death arrives as 401. A bare status is not enough —
  // 403 also carries the capacity throttle. Live signature for a banned
  // account on /chat/completions: {"error":"账号不可用"}.
  if (statusCode === 403 && /410004|账号已被封禁|已被封禁|账号不可用/.test(text)) return true;
  if (statusCode === 401 && /410000|please log in/i.test(text)) return true;
  // Identity-style JSON bodies: { code: 410004 | 410000, ... }
  try {
    const parsed = JSON.parse(text);
    return DEATH_CODES.has(parsed?.code);
  } catch { return false; }
}

// Refresh one managed account through the dashboard-proven chain:
// /userapi/v1/refresh → agent-refresh on middleware rejection. Resolves with
// the stored account on success; a code-410004 rejection throws a
// BAN-indicated error so callers can distinguish banned from transient.
export async function refreshManagedAccount(account, { post = identityPost } = {}) {
  if (!account?.refreshToken) throw identityError("Sesi akun tidak punya refresh token. Login ulang.", 401);
  const payload = {
    refresh_token: account.refreshToken,
    source_id: "autoclaw",
    device_id: account.deviceId,
  };
  let { body } = await post("/userapi/v1/refresh", payload);
  if (body.code === 400002) ({ body } = await post("/userapi/v1/agent-refresh", payload));
  if (body.code === 410004) {
    throw identityError("Akun diblokir AutoClaw (User banned)", 403);
  }
  if (body.code !== 0) throw identityFailure(body);
  if (!body.data?.access_token) throw identityError("Refresh token ditolak. Login ulang.", 401);
  updateManagedTokens(account.id, {
    accessToken: body.data.access_token,
    refreshToken: body.data.refresh_token || account.refreshToken,
  });
  return getManagedAccount(account.id);
}

// Rank candidates: managed accounts with a refresh token, excluding the
// active id (and anything the caller already knows is dead), freshest token
// first.
function rankCandidates({ excludeIds = new Set() }) {
  const activeId = getActiveManagedId();
  const skip = new Set([...excludeIds]);
  if (activeId) skip.add(activeId);
  return listManagedAccounts()
    .filter((a) => !skip.has(a.id) && getManagedAccount(a.id)?.refreshToken)
    .sort((a, b) => (Number(b.expiresAt) || 0) - (Number(a.expiresAt) || 0));
}

const BAN_SKIP_TTL_MS = 10 * 60 * 1000;
const bannedSkip = new Map(); // id -> until

function markBanned(id) {
  bannedSkip.set(id, Date.now() + BAN_SKIP_TTL_MS);
}

function isBanned(id) {
  const until = bannedSkip.get(id);
  if (until == null) return false;
  if (Date.now() > until) { bannedSkip.delete(id); return false; }
  return true;
}

export function _resetBanCache() {
  bannedSkip.clear();
}

// Try to switch to the healthiest account. Returns { from, to } on success,
// null when nothing could take over. Never throws: failover failure must not
// turn a failed request into a crashed lane.
//
// Both lanes can see a death verdict at the same moment, and a refresh token
// rotates on use — two concurrent probes of the same candidate would leave one
// lane holding a dead refresh token. Calls therefore serialize: the second
// caller waits for the first and, when its own token no longer matches the
// newly active account, simply reports the reuse so the lane reloads.
let _switching = null;

function tokenUserId(token) {
  try {
    const raw = String(token || "").replace(/^Bearer\s+/i, "");
    const part = raw.split(".")[1];
    if (!part) return null;
    const claims = JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
    return claims?.user_id == null || claims.user_id === "" ? null : String(claims.user_id);
  } catch {
    return null;
  }
}

function alreadySwitchedByPeer(currentToken, log, reason) {
  if (!currentToken) return null;
  const activeId = getActiveManagedId();
  if (!activeId) return null;
  const active = getManagedAccount(activeId);
  if (!active) return null;
  const mine = tokenUserId(currentToken);
  const theirs = active.numericUserId || tokenUserId(active.accessToken);
  if (!mine || !theirs || mine === theirs) return null;
  log?.info?.(`failover: another lane already moved to ${activeId} (user ${theirs}) after ${reason} — reloading token`);
  return { from: null, to: activeId, reused: true };
}

export async function maybeFailover(reason, log, { post = identityPost, currentToken = null } = {}) {
  if (_switching) {
    const prior = await _switching.catch(() => null);
    return alreadySwitchedByPeer(currentToken, log, reason) || prior;
  }
  _switching = failoverOnce(reason, log, post).finally(() => { _switching = null; });
  return _switching;
}

async function failoverOnce(reason, log, post) {
  const activeId = getActiveManagedId();
  const candidates = rankCandidates({
    excludeIds: new Set([...bannedSkip.entries()].filter(([, until]) => Date.now() < until).map(([id]) => id)),
  });
  if (candidates.length === 0) {
    log?.warn?.(`failover: no managed candidate available (${reason})`);
    return null;
  }
  for (const candidate of candidates) {
    const raw = getManagedAccount(candidate.id);
    if (!raw?.refreshToken || isBanned(candidate.id)) continue;
    try {
      await refreshManagedAccount(raw, { post });
      if (activeId !== candidate.id) setActiveManagedAccount(candidate.id);
      log?.warn?.(`failover: switched ${activeId || "(none)"} → ${candidate.id}` +
        ` (user ${candidate.numericUserId}) after ${reason}; next request uses the new account`);
      bannedSkip.delete(candidate.id);
      return { from: activeId, to: candidate.id };
    } catch (err) {
      if (err.status === 403) {
        markBanned(candidate.id);
        log?.warn?.(`failover: candidate ${candidate.numericUserId} is banned upstream (410004) — skipped`);
      } else {
        log?.warn?.(`failover: candidate ${candidate.numericUserId} refresh failed: ${err.message}`);
      }
    }
  }
  log?.warn?.(`failover: every candidate failed (${reason}) — staying on the current account`);
  return null;
}
