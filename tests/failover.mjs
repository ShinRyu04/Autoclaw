// Hermetic tests for the account-failover module.
//
// No network, no real store: the managed store is pointed at a throwaway
// state dir (GLMP_STATE_DIR) BEFORE the store module loads — account-store.js
// freezes its paths at import time, so static imports here would write the
// fixtures into the real proxy-state store. The identity client is injected as
// a mock `post` — the same seam production never overrides.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { check, summary } from "./_helpers.mjs";

// ---- hermetic store ---------------------------------------------------------

const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "glm-failover-"));
const prevStateDir = process.env.GLMP_STATE_DIR;
const prevStore = process.env.GLMP_MANAGED_STORE;
process.env.GLMP_STATE_DIR = stateDir;
process.env.GLMP_MANAGED_STORE = path.join(stateDir, "managed-accounts.enc");

// Only NOW may the store (and failover, which imports it) be loaded.
const {
  DEATH_CODES, isDeathBody, refreshManagedAccount, maybeFailover, _resetBanCache,
} = await import("../lib/failover.js");
const {
  upsertManagedAccount, getActiveManagedId, setActiveManagedAccount, getManagedAccount,
} = await import("../lib/account-store.js");

// A real-enough JWT so tokenNumericUserId/tokenExpiry derive identity + exp.
function jwt(numericUserId, expInSec) {
  const claims = { user_id: String(numericUserId), exp: expInSec, iat: expInSec - 3600 };
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${b64({ alg: "none" })}.${b64(claims)}.sig`;
}

// Deterministic ids: managedId hashes the numeric user id.
function idOf(userId) {
  return upsertManagedAccount({
    accessToken: jwt(userId, Math.floor(Date.now() / 1000) + 3600),
    refreshToken: `rt-${userId}`,
    deviceId: `dev-${userId}`,
    numericUserId: String(userId),
  }).id;
}

const now = Math.floor(Date.now() / 1000);

// Four managed accounts. Active dies; candidates ranked by freshest token.
const ACTIVE = idOf(1001);   // becomes active, then dies
const YOUNG = idOf(1002);    // freshest token → first candidate
const MID = idOf(1003);
const BANNED = idOf(1004);   // candidate that answers 410004
const OLDER = idOf(1005);    // older token → last candidate

// Re-stamp expiresAt directly so ranking does not depend on jwt exp ordering
// collisions: YOUNG > MID > BANNED > OLDER.
function stampExpires(id, ms) {
  const raw = getManagedAccount(id);
  raw.expiresAt = ms;
  // updateManagedTokens keeps refreshToken; write expiresAt through the store's
  // own path by re-upserting with an explicit token carrying the right exp.
  const claims = JSON.parse(Buffer.from(raw.accessToken.split(".")[1], "base64url").toString("utf8"));
  claims.exp = Math.floor(ms / 1000);
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const token = `${b64({ alg: "none" })}.${b64(claims)}.sig`;
  upsertManagedAccount({
    accessToken: token, refreshToken: raw.refreshToken, deviceId: raw.deviceId,
    numericUserId: raw.numericUserId, id,
  });
}

const t = Date.now();
stampExpires(YOUNG, t + 4_000_000);
stampExpires(MID, t + 3_000_000);
stampExpires(BANNED, t + 2_000_000);
stampExpires(OLDER, t + 1_000_000);
setActiveManagedAccount(ACTIVE);

// ---- mock identity ----------------------------------------------------------

// post(pathname, payload) → { httpStatus, body }. Scripted per path + refresh
// token so each scenario wires only the accounts it cares about.
function makePost(script) {
  const calls = [];
  const post = async (pathname, payload) => {
    calls.push({ pathname, refresh_token: payload?.refresh_token });
    const responder = script[pathname]?.[payload?.refresh_token];
    if (!responder) throw new Error(`mock post: no script for ${pathname} ${payload?.refresh_token}`);
    return responder();
  };
  post.calls = calls;
  return post;
}

const okTokens = (userId) => () => ({
  httpStatus: 200,
  body: { code: 0, data: { access_token: jwt(userId, now + 7200), refresh_token: `rt-${userId}-new` } },
});

try {
  // ---- isDeathBody shapes ---------------------------------------------------

  check("isDeathBody: JSON body code 410004 at HTTP 200", () => {
    assert.equal(isDeathBody(200, JSON.stringify({ code: 410004, msg: "User banned" })), true);
  });

  check("isDeathBody: JSON body code 410000 at HTTP 200", () => {
    assert.equal(isDeathBody(200, JSON.stringify({ code: 410000, msg: "Please log in to continue" })), true);
  });

  check("isDeathBody: 403 + ban text", () => {
    assert.equal(isDeathBody(403, "upstream said 账号已被封禁"), true);
    assert.equal(isDeathBody(403, 'wrapped {"code":410004}'), true);
    // Live signature of a banned account on /chat/completions.
    assert.equal(isDeathBody(403, '{"error":"账号不可用"}'), true);
  });

  check("isDeathBody: 401 + please log in", () => {
    assert.equal(isDeathBody(401, "please log in to continue"), true);
  });

  check("isDeathBody: bare 403/401 without death codes is NOT death (throttle)", () => {
    assert.equal(isDeathBody(403, JSON.stringify({ code: 810002 })), false);
    assert.equal(isDeathBody(401, "unauthorized"), false);
  });

  check("isDeathBody: empty/other bodies false", () => {
    assert.equal(isDeathBody(500, ""), false);
    assert.equal(isDeathBody(200, "not json"), false);
  });

  check("DEATH_CODES is exactly 410000 + 410004", () => {
    assert.deepEqual([...DEATH_CODES].sort(), [410000, 410004]);
  });

  // ---- refreshManagedAccount --------------------------------------------------

  check("refreshManagedAccount: refresh → agent-refresh on 400002, tokens stored", async () => {
    const post = makePost({
      "/userapi/v1/refresh": { [`rt-${MID}`]: () => ({ httpStatus: 200, body: { code: 400002 } }) },
      "/userapi/v1/agent-refresh": { [`rt-${MID}`]: okTokens(Number(getManagedAccount(MID).numericUserId)) },
    });
    const refreshed = await refreshManagedAccount(getManagedAccount(MID), { post });
    assert.deepEqual(post.calls.map((c) => c.pathname),
      ["/userapi/v1/refresh", "/userapi/v1/agent-refresh"]);
    assert.ok(refreshed.accessToken.includes("sig"));
    assert.equal(getManagedAccount(MID).refreshToken, `rt-${MID}-new`);
  });

  check("refreshManagedAccount: 410004 throws status 403", async () => {
    const post = makePost({
      "/userapi/v1/refresh": { [`rt-${BANNED}`]: () => ({ httpStatus: 200, body: { code: 410004, msg: "User banned" } }) },
    });
    await assert.rejects(
      () => refreshManagedAccount(getManagedAccount(BANNED), { post }),
      (err) => err.status === 403,
    );
  });

  // ---- maybeFailover ----------------------------------------------------------

  check("maybeFailover: skips banned candidate, activates next healthiest, returns {from,to}", async () => {
    _resetBanCache();
    setActiveManagedAccount(ACTIVE);
    const post = makePost({
      "/userapi/v1/refresh": {
        [`rt-${YOUNG}`]: () => ({ httpStatus: 200, body: { code: 410004, msg: "User banned" } }),
        [`rt-${MID}`]: okTokens(Number(getManagedAccount(MID).numericUserId)),
      },
    });
    const logs = [];
    const log = { warn: (m) => logs.push(String(m)), info: () => {} };
    const result = await maybeFailover("test-ban", log, { post });
    assert.deepEqual(result, { from: ACTIVE, to: MID });
    assert.equal(getActiveManagedId(), MID);
    assert.ok(logs.some((m) => m.includes("1004") && m.includes("banned")));
    assert.ok(logs.some((m) => m.includes("switched")));
  });

  check("maybeFailover: banned candidate stays skipped on immediate retry (10-min cache)", async () => {
    // YOUNG answered 410004 above; even with a healthy script it must not be
    // probed again within the TTL.
    setActiveManagedAccount(OLDER);
    const post = makePost({
      "/userapi/v1/refresh": {
        [`rt-${YOUNG}`]: okTokens(Number(getManagedAccount(YOUNG).numericUserId)),
        [`rt-${MID}`]: okTokens(Number(getManagedAccount(MID).numericUserId)),
      },
    });
    const result = await maybeFailover("test-skip", { warn: () => {}, info: () => {} }, { post });
    assert.equal(result.to, MID); // not YOUNG, despite freshest token
    assert.deepEqual(post.calls.map((c) => c.refresh_token).filter((rt) => rt === `rt-${YOUNG}`), []);
  });

  check("maybeFailover: excludes the currently active account", async () => {
    setActiveManagedAccount(MID);
    const post = makePost({
      "/userapi/v1/refresh": { [`rt-${MID}`]: okTokens(Number(getManagedAccount(MID).numericUserId)) },
    });
    const result = await maybeFailover("test-self", { warn: () => {}, info: () => {} }, { post });
    // MID is active → excluded; YOUNG banned-cached → skipped; BANNED probe → 410004; OLDER next.
    assert.equal(result.to, OLDER);
  });

  check("maybeFailover: all candidates fail → null, active unchanged, never throws", async () => {
    _resetBanCache();
    setActiveManagedAccount(ACTIVE);
    const post = makePost({
      "/userapi/v1/refresh": {
        [`rt-${YOUNG}`]: () => ({ httpStatus: 200, body: { code: 410004, msg: "User banned" } }),
        [`rt-${MID}`]: () => ({ httpStatus: 200, body: { code: 410004, msg: "User banned" } }),
        [`rt-${BANNED}`]: () => ({ httpStatus: 200, body: { code: 410004, msg: "User banned" } }),
        [`rt-${OLDER}`]: () => ({ httpStatus: 200, body: { code: 410000, msg: "Please log in" } }),
      },
    });
    const result = await maybeFailover("test-all-dead", { warn: () => {}, info: () => {} }, { post });
    assert.equal(result, null);
    assert.equal(getActiveManagedId(), ACTIVE);
  });

  check("maybeFailover: no candidates at all → null", async () => {
    // Fresh store: only ACTIVE exists.
    const soloDir = fs.mkdtempSync(path.join(os.tmpdir(), "glm-failover-solo-"));
    process.env.GLMP_STATE_DIR = soloDir;
    setActiveManagedAccount(ACTIVE);
    try {
      const result = await maybeFailover("test-solo", { warn: () => {}, info: () => {} }, {
        post: makePost({}),
      });
      assert.equal(result, null);
    } finally {
      process.env.GLMP_STATE_DIR = stateDir;
      fs.rmSync(soloDir, { recursive: true, force: true });
    }
  });

  check("refreshManagedAccount: success updates expiresAt from the new token", async () => {
    _resetBanCache();
    setActiveManagedAccount(ACTIVE);
    const future = now + 90_000;
    const claims = { user_id: "1003", exp: future, iat: now };
    const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
    const freshToken = `${b64({ alg: "none" })}.${b64(claims)}.sig`;
    const post = makePost({
      "/userapi/v1/refresh": { [`rt-${MID}-new`]: () => ({ httpStatus: 200, body: { code: 0, data: { access_token: freshToken } } }) },
    });
    await refreshManagedAccount(getManagedAccount(MID), { post });
    assert.equal(getManagedAccount(MID).expiresAt, future * 1000);
  });

  check("maybeFailover: concurrent calls probe once and the peer reuses the switch", async () => {
    _resetBanCache();
    setActiveManagedAccount(ACTIVE);
    let openGate;
    const gate = new Promise((r) => { openGate = r; });
    const calls = [];
    // Only MID is healthy; the probe is held open until both callers are in.
    const post = async (pathname, payload) => {
      await gate;
      calls.push({ pathname, refresh_token: payload?.refresh_token });
      if (pathname !== "/userapi/v1/refresh" || payload?.refresh_token !== "rt-1003") {
        throw new Error(`mock post: unexpected ${pathname} ${payload?.refresh_token}`);
      }
      return okTokens(1003)();
    };
    const logs = [];
    const log = { warn: (m) => logs.push(String(m)), info: (m) => logs.push(String(m)) };
    const dead = jwt(1001, now + 3600);
    const first = maybeFailover("peer-a", log, { post, currentToken: dead });
    const second = maybeFailover("peer-b", log, { post, currentToken: dead });
    openGate();
    const [a, b] = await Promise.all([first, second]);
    assert.equal(getActiveManagedId(), MID);
    // One probe only: the refresh token rotated once, as the identity API does.
    assert.equal(calls.length, 1);
    assert.deepEqual(a, { from: ACTIVE, to: MID });
    // The peer still held the dead account's token, so it reloads instead of
    // probing again and churning to yet another account.
    assert.deepEqual(b, { from: null, to: MID, reused: true });
  });
} finally {
  if (prevStateDir === undefined) delete process.env.GLMP_STATE_DIR;
  else process.env.GLMP_STATE_DIR = prevStateDir;
  if (prevStore === undefined) delete process.env.GLMP_MANAGED_STORE;
  else process.env.GLMP_MANAGED_STORE = prevStore;
  fs.rmSync(stateDir, { recursive: true, force: true });
}

summary();
