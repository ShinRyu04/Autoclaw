import { getLanguage, initI18n, setLanguage, translateText } from "./i18n.js";

const $ = (id) => document.getElementById(id);
const locale = () => getLanguage() === "en" ? "en-US" : "id-ID";
let fmt = new Intl.NumberFormat(locale());
let rtf = new Intl.RelativeTimeFormat(locale(), { numeric: "auto" });

const ROUTES = {
  "/": {
    title: "Ringkasan",
    desc: "Akun, pemakaian, dan request terakhir.",
  },
  "/upstream": {
    title: "Upstream",
    desc: "Kapasitas governor dan status kedua jalur.",
  },
  "/health": {
    title: "Health",
    desc: "Uji token dan saldo semua akun AutoClaw.",
  },
  "/api-docs": {
    title: "Dokumentasi API",
    desc: "Base URL, endpoint, dan model yang tersedia di proxy lokal.",
  },
  "/accounts": {
    title: "Akun",
    desc: "Akun AutoClaw yang terdeteksi dan akun yang dipakai kedua jalur.",
  },
  "/keys": {
    title: "Kunci",
    desc: "Kelola kunci klien, pin model, dan kuota per jam.",
  },
  "/requests": {
    title: "Request",
    desc: "Aliran request kedua jalur dengan filter hasil.",
  },
  "/settings": {
    title: "Pengaturan",
    desc: "Batas akun, antrean, throttle, dan backend.",
  },
  "/logs": {
    title: "Log",
    desc: "Ekor berkas log proxy tanpa membuka terminal.",
  },
};

const state = {
  data: null,
  error: null,
  route: "/",
  requestFilter: "all",
  settingsFilled: false,
  actionError: "",
  accounts: null,
  accountsError: "",
  accountsLoading: false,
  checkinLoading: false,
  docs: null,
  docsError: "",
  health: null,
  healthError: "",
  healthLoading: false,
  logName: "",
  logLoadedFor: "",
  logLoading: false,
  logSignature: "",
  fetching: false,
};

let actionErrorTimer = null;

function ago(value) {
  const then = timestamp(value);
  if (then == null) return "–";
  const diff = then - Date.now();
  const abs = Math.abs(diff);
  if (abs < 45000) return "baru saja";
  if (abs < 3600000) return rtf.format(Math.round(diff / 60000), "minute");
  if (abs < 86400000) return rtf.format(Math.round(diff / 3600000), "hour");
  return rtf.format(Math.round(diff / 86400000), "day");
}

function timestamp(value) {
  if (value == null || value === "") return null;
  const ms = typeof value === "number" ? value : Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function duration(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return "–";
  const total = Math.round(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}j ${m}m`;
  if (m > 0) return `${m}m ${s}d`;
  return `${s}d`;
}

function clock(value) {
  const ms = timestamp(value);
  if (ms == null) return "–";
  return new Date(ms).toLocaleTimeString(locale(), {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function initials(value) {
  const words = String(value || "").replace(/[^\p{L}\p{N} ]/gu, " ").trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  const letters = words.slice(0, 2).map((word) => word[0]);
  return letters.join("").toUpperCase();
}

function shortId(value) {
  const id = String(value || "").trim();
  if (!id) return "–";
  return id.length > 14 ? `${id.slice(0, 6)}…${id.slice(-4)}` : id;
}

function accountLabel(account) {
  if (!account) return "Tanpa nama";
  const name = String(account.displayName || "").trim();
  if (name && name !== "None" && !name.includes("@") && !/^\+?\d[\d\s().-]{5,}$/.test(name)) {
    return name;
  }
  return account.numericUserId ? `Akun ${shortId(account.numericUserId)}` : "Akun AutoClaw";
}

function accountIdText(account) {
  return shortId(account?.numericUserId || account?.accountId);
}

function loginTime(value) {
  if (typeof value === "string" && value) {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) {
      return new Date(parsed).toLocaleString(locale(), { dateStyle: "medium", timeStyle: "short" });
    }
  }
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) return "tidak tercatat";
  return new Date(seconds * 1000).toLocaleString(locale(), {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function toneForStatus(status) {
  if (status >= 200 && status < 300) return "ok";
  if (status === 429 || status === 408) return "warn";
  return "err";
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = String(text);
  return node;
}

function setText(node, value) {
  node.textContent = value == null || value === "" ? "–" : String(value);
}

async function request(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (options.body) headers["Content-Type"] = "application/json";
  if (options.method && options.method !== "GET") headers["X-Dashboard"] = "1";
  const res = await fetch(path, { ...options, headers });
  let payload = null;
  try { payload = await res.json(); } catch { /* respons tanpa JSON */ }
  if (!res.ok) {
    throw Object.assign(new Error(payload?.error || `HTTP ${res.status}`), {
      status: res.status,
      payload,
    });
  }
  return payload;
}

function primaryProxy() {
  const openai = state.data?.proxies?.openai;
  const anthropic = state.data?.proxies?.anthropic;
  if (openai && !openai.error) return openai;
  if (anthropic && !anthropic.error) return anthropic;
  return null;
}

function showActionError(message) {
  state.actionError = message;
  clearTimeout(actionErrorTimer);
  actionErrorTimer = setTimeout(() => {
    if (state.actionError === message) {
      state.actionError = "";
      renderChrome();
    }
  }, 8000);
  renderChrome();
}

function renderChrome() {
  const dot = $("conn-dot");
  const connText = $("conn-text");
  const data = state.data;

  if (state.error) {
    dot.className = "dot err";
    connText.textContent = "Gagal memuat status";
  } else if (!data) {
    dot.className = "dot";
    connText.textContent = "Menghubungkan ke proxy";
  } else {
    const openai = data.proxies?.openai;
    const anthropic = data.proxies?.anthropic;
    const up = [openai, anthropic].filter((p) => p && !p.error).length;
    dot.className = "dot" + (up === 2 ? " ok" : up === 1 ? " warn" : " err");
    connText.textContent = up === 2 ? "Kedua jalur aktif"
      : up === 1 ? "Satu jalur aktif"
      : "Tidak ada jalur yang menjawab";
  }

  const backend = data?.config?.backend || primaryProxy()?.backend;
  const active = data?.config?.activeAccount;
  const initial = $("foot-initial");
  const accountName = $("foot-account");
  const accountSub = $("foot-account-sub");
  if (backend === "zai") {
    initial.textContent = "Z";
    accountName.textContent = "Z.ai API key";
    accountSub.textContent = data?.config?.zaiKeyConfigured ? "Backend zai, key tersimpan" : "Backend zai, key belum diisi";
  } else if (active) {
    const label = accountLabel(active);
    initial.textContent = initials(label);
    accountName.textContent = label;
    accountSub.textContent = `AutoClaw, ID ${accountIdText(active)}`;
  } else if (data) {
    initial.textContent = "–";
    accountName.textContent = data.config?.accountKey ? "Akun pilihan tidak terbaca" : "Belum ada akun aktif";
    accountSub.textContent = "Pilih akun di halaman Akun";
  } else {
    initial.textContent = "–";
    accountName.textContent = "Membaca akun";
    accountSub.textContent = "–";
  }

  const keys = data?.keys || [];
  const keysBadge = $("nav-keys");
  keysBadge.textContent = fmt.format(keys.length);
  keysBadge.hidden = keys.length === 0;

  const waiting = Object.values(data?.proxies || {}).reduce(
    (sum, p) => sum + (p && !p.error ? Number(p.queue?.waiting) || 0 : 0),
    0,
  );
  const queueBadge = $("nav-queue");
  queueBadge.textContent = fmt.format(waiting);
  queueBadge.hidden = waiting === 0;

  let banner = "";
  if (state.error) {
    banner = `Gagal memuat status: ${state.error.message}`;
  } else if (data && $("conn-dot").classList.contains("err")) {
    banner = "Kedua jalur proxy tidak menjawab. Cek log proxy dan watchdog.";
  } else if (state.actionError) {
    banner = state.actionError;
  }
  $("banner-text").textContent = banner;
  $("banner").hidden = !banner;
}

function renderCapacity() {
  const p = primaryProxy();
  const govState = $("gov-state");
  if (!state.data) {
    setText(govState, "memuat");
    govState.dataset.tone = "";
    $("capacity-note").textContent = "Membaca status governor.";
    return;
  }
  if (!p) {
    setText(govState, "tidak diketahui");
    govState.dataset.tone = "err";
    $("capacity-note").textContent = "Governor tidak bisa dibaca dari kedua jalur.";
    $("budget-used").textContent = "–";
    $("budget-limit").textContent = "tanpa data";
    $("budget-reset").textContent = "–";
    $("queue-text").textContent = "–";
    $("min-gap").textContent = "–";
    $("budget-fill").style.width = "0%";
    $("budget-fill").dataset.tone = "";
    return;
  }

  const gov = p.governor || {};
  const budget = Number(gov.budget) || 0;
  const used = Number(gov.windowRequests) || 0;
  const pct = budget > 0 ? Math.min(100, (used / budget) * 100) : 0;

  $("budget-used").textContent = fmt.format(used);
  $("budget-limit").textContent = budget > 0
    ? `/ ${fmt.format(budget)} request`
    : "tanpa batas";

  const meter = $("budget-meter");
  meter.setAttribute("aria-valuemax", String(Math.max(1, budget || 1)));
  meter.setAttribute("aria-valuenow", String(budget > 0 ? Math.min(used, budget) : 0));

  const fill = $("budget-fill");
  fill.style.width = `${pct}%`;
  fill.dataset.tone = pct >= 95 ? "err" : pct >= 80 ? "warn" : "ok";

  const stateName = String(gov.state || "unknown");
  setText(govState, stateName);
  govState.dataset.tone = stateName === "normal" ? "ok"
    : ["backoff", "warning", "warn", "throttle"].includes(stateName) ? "warn"
    : "";

  const resetAt = timestamp(gov.nextWindowAt);
  $("budget-reset").textContent = resetAt != null && resetAt > Date.now()
    ? `dalam ${duration(resetAt - Date.now())}`
    : "tersedia";

  const lanes = Object.values(state.data.proxies || {}).filter((x) => x && !x.error);
  const active = lanes.reduce((sum, x) => sum + (Number(x.queue?.active) || 0), 0);
  const waiting = lanes.reduce((sum, x) => sum + (Number(x.queue?.waiting) || 0), 0);
  $("queue-text").textContent = `${fmt.format(active)} aktif, ${fmt.format(waiting)} menunggu`;
  $("min-gap").textContent = `${fmt.format(p.config?.minGapMs ?? 0)} ms`;

  const notes = [];
  if (budget === 0) notes.push("Budget per jam dimatikan: request tidak dipacing.");
  if (gov.retryAfterMs > 0) notes.push(`Backoff upstream aktif, coba lagi dalam ${duration(gov.retryAfterMs)}.`);
  if (gov.backoffLevel > 0) notes.push(`Level backoff ${gov.backoffLevel}.`);
  if (waiting > 0) notes.push("Ada request menunggu slot generasi.");
  if (notes.length === 0) {
    notes.push(p.backend === "zai"
      ? "Dua jalur memakai API key Z.ai yang sama. Antrean dihitung per proses."
      : "Dua jalur berbagi satu akun AutoClaw. Antrean dihitung per proses.");
  }
  $("capacity-note").textContent = notes.join(" ");
}

function renderLanes() {
  if (!state.data) return;
  for (const key of ["openai", "anthropic"]) {
    const lane = $(`lane-${key}`);
    const p = state.data.proxies?.[key];
    const port = state.data.ports?.[key];
    const stateEl = lane.querySelector('[data-field="state"]');
    const tokenEl = lane.querySelector('[data-field="token"]');
    const runtimeEl = lane.querySelector('[data-field="runtime"]');
    const lastEl = lane.querySelector('[data-field="last"]');
    const errorsEl = lane.querySelector('[data-field="errors"]');

    setText(lane.querySelector('[data-field="port"]'), `:${port ?? "–"}`);

    if (!p || p.error) {
      lane.dataset.state = "down";
      setText(stateEl, "mati");
      stateEl.dataset.tone = "err";
      tokenEl.textContent = `Tidak menjawab di port ${port ?? "–"}.`;
      runtimeEl.textContent = p?.error ? `Error: ${p.error}` : "Error: tidak ada respons";
      lastEl.textContent = "–";
      errorsEl.textContent = "–";
      continue;
    }

    lane.dataset.state = "up";
    setText(stateEl, "aktif");
    stateEl.dataset.tone = "ok";

    if (p.token?.ok) {
      const guest = p.token.isGuest ? ", guest" : "";
      tokenEl.textContent = `Aktif${guest}, akun ${p.token.userId ?? "–"}`;
    } else {
      tokenEl.textContent = `Gagal: ${p.token?.error || "tidak diketahui"}`;
    }

    const recent = p.recent?.[p.recent.length - 1];
    runtimeEl.textContent = `pid ${p.pid ?? "–"}, hidup ${duration(p.uptimeMs)}, v${p.version ?? "–"}`;
    lastEl.textContent = recent
      ? `${clock(recent.ts)}, ${recent.status}, ${recent.model || "tanpa model"}, ${fmt.format(recent.latencyMs ?? 0)} ms`
      : "Belum ada";

    const errCodes = Object.entries(p.metrics?.byError || {}).sort((a, b) => b[1] - a[1]);
    const errTotal = errCodes.reduce((sum, [, n]) => sum + n, 0);
    errorsEl.textContent = errTotal > 0
      ? `${fmt.format(errTotal)}, tersering ${errCodes[0][0]}`
      : "Tidak ada";
  }
}

function allRecent() {
  const rows = [];
  for (const [lane, p] of Object.entries(state.data?.proxies || {})) {
    if (!p || p.error) continue;
    for (const entry of p.recent || []) rows.push({ ...entry, lane });
  }
  rows.sort((a, b) => (timestamp(a.ts) ?? 0) - (timestamp(b.ts) ?? 0));
  return rows;
}

function laneName(lane) {
  return lane === "openai" ? "OpenAI" : "Anthropic";
}

function statusBadge(status) {
  return el("span", `badge ${toneForStatus(status)}`, status == null ? "–" : status);
}

function renderOverview() {
  const rows = allRecent();
  const body = $("overview-requests");
  body.replaceChildren();
  const recent = rows.slice(-8).reverse();
  $("overview-requests-empty").hidden = recent.length > 0;

  for (const row of recent) {
    const tr = document.createElement("tr");
    tr.append(
      el("td", "num", clock(row.ts)),
      el("td", "", laneName(row.lane)),
      (() => { const td = document.createElement("td"); td.append(statusBadge(row.status)); return td; })(),
      el("td", "", row.model || "–"),
      el("td", "num", `${fmt.format(row.latencyMs ?? 0)} ms`),
    );
    body.append(tr);
  }

  const keys = (state.data?.keys || []).filter((k) => k.enabled);
  const pressure = $("key-pressure");
  pressure.replaceChildren();
  $("key-pressure-empty").hidden = keys.length > 0;

  const ranked = keys
    .map((k) => {
      const used = Number(k.usage?.used) || 0;
      const limit = Number(k.usage?.limit) || 0;
      return { key: k, used, limit, ratio: limit > 0 ? used / limit : 0 };
    })
    .sort((a, b) => b.ratio - a.ratio)
    .slice(0, 4);

  for (const item of ranked) {
    const li = document.createElement("li");
    const head = el("div", "pressure-head");
    head.append(el("span", "", item.key.name));
    head.append(el("span", "", item.limit > 0
      ? `${fmt.format(item.used)}/${fmt.format(item.limit)}`
      : `${fmt.format(item.used)}, tanpa batas`));
    const bar = el("span", "quota-bar");
    const fill = el("span");
    const pct = item.limit > 0 ? Math.min(100, item.ratio * 100) : 0;
    fill.style.width = `${pct}%`;
    fill.dataset.tone = pct >= 95 ? "err" : pct >= 80 ? "warn" : "ok";
    bar.append(fill);
    li.append(head, bar);
    pressure.append(li);
  }

  renderOverviewStats();
  renderOverviewAccounts();
}

function laneTotals() {
  const lanes = Object.values(state.data?.proxies || {}).filter((lane) => lane && !lane.error);
  const credits = lanes
    .map((lane) => lane.governor?.estimatedCredits)
    .filter((value) => value != null && Number.isFinite(Number(value)))
    .map(Number);
  return {
    up: lanes.length,
    requests: lanes.reduce((sum, lane) => sum + (Number(lane.metrics?.total) || 0), 0),
    tokens: lanes.reduce((sum, lane) => sum + (Number(lane.metrics?.tokens) || 0), 0),
    credits,
  };
}

function renderOverviewStats() {
  const data = state.accounts;
  const accounts = data?.accounts || [];
  const creditAccounts = accounts.filter((account) => account.credits?.ok);
  const activeAccounts = accounts.filter((account) => account.active);
  const totalPoints = creditAccounts.reduce(
    (sum, account) => sum + (Number(account.credits.totalPoints) || 0),
    0,
  );
  const lanes = laneTotals();

  $("stat-total-accounts").textContent = data ? fmt.format(accounts.length) : "–";
  $("stat-total-accounts-note").textContent = !data
    ? "memuat akun"
    : accounts.length > 0 ? "siap dipakai" : "belum ada akun";

  $("stat-active-accounts").textContent = data ? fmt.format(activeAccounts.length) : "–";
  $("stat-active-accounts-note").textContent = !data
    ? "memuat akun"
    : activeAccounts.length > 0 ? "dipakai kedua jalur" : "belum ada akun aktif";

  $("stat-total-points").textContent = !data
    ? "–"
    : creditAccounts.length > 0 ? fmt.format(totalPoints) : "–";
  $("stat-total-points-note").textContent = !data
    ? "memuat saldo"
    : accounts.length === 0 ? "belum ada akun"
      : creditAccounts.length === 0 ? "saldo belum terbaca"
        : creditAccounts.length < accounts.length
          ? `${fmt.format(creditAccounts.length)}/${fmt.format(accounts.length)} akun terbaca`
          : "saldo AutoClaw";

  $("stat-api-requests").textContent = !state.data
    ? "–"
    : lanes.up === 0 ? "–" : fmt.format(lanes.requests);
  $("stat-api-requests-note").textContent = !state.data
    ? "memuat status"
    : lanes.up === 0 ? "proxy tidak menjawab" : "sejak proxy hidup";

  $("stat-tokens-used").textContent = !state.data
    ? "–"
    : lanes.up === 0 ? "–" : fmt.format(lanes.tokens);
  $("stat-tokens-used-note").textContent = !state.data
    ? "memuat status"
    : lanes.up === 0 ? "proxy tidak menjawab" : "sejak proxy hidup";

  $("stat-estimated-cost").textContent = lanes.credits.length > 0
    ? fmt.format(lanes.credits.reduce((sum, value) => sum + value, 0))
    : "–";
  $("stat-estimated-cost-note").textContent = lanes.credits.length > 0
    ? "kredit dari upstream"
    : "tidak dilacak upstream";
}

function renderOverviewAccounts() {
  const data = state.accounts;
  const accounts = data?.accounts || [];
  const list = $("overview-accounts-list");
  list.replaceChildren();
  $("overview-accounts-empty").hidden = !data || accounts.length > 0;
  $("overview-accounts-note").textContent = !data
    ? "Memuat akun."
    : accounts.length > 0
      ? `${fmt.format(accounts.length)} akun siap dipakai`
      : "Belum ada akun.";
  const checkin = $("overview-checkin");
  checkin.disabled = !data || accounts.length === 0 || state.checkinLoading;
  checkin.textContent = state.checkinLoading ? "Check-in..." : "Check-in semua";

  for (const account of accounts) {
    const li = el("li", "overview-account");
    if (account.active) li.dataset.active = "true";
    const main = el("div", "account-main");
    const avatar = el("span", "account-avatar", initials(accountLabel(account)));
    avatar.setAttribute("aria-hidden", "true");
    const who = document.createElement("div");
    const title = el("h3", "", accountLabel(account));
    if (account.active) title.append(" ", el("span", "badge ok", "aktif"));
    who.append(title, el("p", "account-sub", `ID ${accountIdText(account)}`));
    main.append(avatar, who);
    const points = el("span", "overview-account-points");
    if (account.credits?.ok) {
      points.textContent = `${fmt.format(account.credits.totalPoints)} poin`;
    } else {
      points.textContent = "–";
      points.title = account.credits?.error || "Saldo belum terbaca";
    }
    li.append(main, points);
    list.append(li);
  }
}

async function runCheckinAll() {
  if (state.checkinLoading) return;
  const status = $("overview-checkin-status");
  state.checkinLoading = true;
  status.textContent = "Mengklaim check-in semua akun.";
  renderOverviewAccounts();
  try {
    const result = await request("/api/accounts/checkin", { method: "POST" });
    const parts = [];
    if (result.claimed) parts.push(`${fmt.format(result.claimed)} task diklaim`);
    if (result.already) parts.push(`${fmt.format(result.already)} sudah selesai`);
    if (result.failed) parts.push(`${fmt.format(result.failed)} gagal`);
    const points = (result.accounts || []).reduce(
      (sum, account) => sum + (Number(account.points) || 0),
      0,
    );
    if (points > 0) parts.push(`+${fmt.format(points)} poin`);
    status.textContent = parts.length > 0
      ? `${parts.join(", ")}.`
      : "Tidak ada task check-in yang bisa diklaim.";
    const errors = (result.accounts || []).flatMap((account) => account.errors || []);
    if (errors.length > 0) status.textContent += ` ${errors[0]}`;
    await loadAccounts(true);
  } catch (err) {
    status.textContent = `Check-in gagal: ${err.message}`;
  } finally {
    state.checkinLoading = false;
    renderOverviewAccounts();
    renderOverviewStats();
  }
}

function quotaCell(usage) {
  const wrap = el("span", "quota");
  const limit = Number(usage?.limit) || 0;
  const used = Number(usage?.used) || 0;
  const pct = limit > 0 ? Math.min(100, (used / limit) * 100) : 0;
  const bar = el("span", "quota-bar");
  const fill = el("span");
  fill.style.width = `${pct}%`;
  fill.dataset.tone = pct >= 95 ? "err" : pct >= 80 ? "warn" : "ok";
  bar.append(fill);
  wrap.append(bar, el("span", "", limit > 0
    ? `${fmt.format(used)}/${fmt.format(limit)}`
    : "tanpa batas"));
  return wrap;
}

function actionButton(label, className, onClick) {
  const btn = el("button", `btn small ${className || ""}`.trim(), label);
  btn.type = "button";
  btn.addEventListener("click", onClick);
  return btn;
}

async function runKeyAction(button, task) {
  const label = button.textContent;
  button.disabled = true;
  try {
    await task();
    await refresh();
  } catch (err) {
    showActionError(err.message);
  } finally {
    button.disabled = false;
    if (button.isConnected) button.textContent = label;
  }
}

function renderKeys() {
  const keys = state.data?.keys || [];
  const body = $("keys-body");
  const wrap = document.querySelector('[data-page="keys"] .table-wrap');
  body.replaceChildren();

  const empty = keys.length === 0;
  $("keys-empty").hidden = !empty;
  wrap.hidden = empty;

  for (const key of keys) {
    const tr = document.createElement("tr");
    if (!key.enabled) tr.dataset.disabled = "true";

    const name = el("td", "wrap", key.name);
    if (!key.enabled) {
      const badge = el("span", "badge", "nonaktif");
      name.append(" ", badge);
    }

    const masked = document.createElement("td");
    masked.append(el("code", "", key.keyMasked));

    const quota = document.createElement("td");
    quota.append(quotaCell(key.usage));

    const last = el("td", "", key.usage?.lastUsed
      ? `${ago(key.usage.lastUsed)}, ${key.usage.lastStatus ?? "–"}`
      : "belum dipakai");

    const actions = el("td", "actions");
    actions.append(
      actionButton(key.enabled ? "Nonaktifkan" : "Aktifkan", "", (event) => {
        const btn = event.currentTarget;
        runKeyAction(btn, () => request(`/api/keys/${key.id}`, {
          method: "PATCH",
          body: JSON.stringify({ enabled: !key.enabled }),
        }));
      }),
      actionButton("Reset", "", (event) => {
        if (!confirm(translateText(`Reset pemakaian kunci "${key.name}"?`))) return;
        runKeyAction(event.currentTarget, () => request(`/api/keys/${key.id}/reset`, { method: "POST" }));
      }),
      actionButton("Hapus", "danger", (event) => {
        if (!confirm(translateText(`Hapus kunci "${key.name}"? Klien yang memakainya akan langsung ditolak.`))) return;
        runKeyAction(event.currentTarget, () => request(`/api/keys/${key.id}`, { method: "DELETE" }));
      }),
    );

    tr.append(
      name,
      masked,
      el("td", "", key.model || "bebas"),
      quota,
      el("td", "num", fmt.format(key.usage?.totalRequests || 0)),
      last,
      actions,
    );
    body.append(tr);
  }
}

function renderDocs() {
  const data = state.docs;
  if (!data) {
    $("docs-model-source").textContent = state.docsError || "Membaca katalog model.";
    return;
  }
  $("docs-openai-base").textContent = data.baseUrl.openai;
  $("docs-anthropic-base").textContent = data.baseUrl.anthropic;
  $("docs-openai-auth").textContent = data.auth.openai;
  $("docs-anthropic-auth").textContent = data.auth.anthropic;

  const endpointBody = $("docs-endpoints");
  endpointBody.replaceChildren();
  for (const endpoint of data.endpoints || []) {
    const row = document.createElement("tr");
    const method = el("td");
    method.append(el("span", "badge", endpoint.method));
    const pathCell = el("td");
    pathCell.append(el("code", "", endpoint.path));
    row.append(method, pathCell, el("td", "", endpoint.base), el("td", "wrap", endpoint.purpose));
    endpointBody.append(row);
  }

  const modelBody = $("docs-models");
  modelBody.replaceChildren();
  const models = data.models || [];
  for (const model of models) {
    const row = document.createElement("tr");
    row.append(
      el("td", "", model.id),
      el("td", "", model.name),
      el("td", "num", model.contextWindow ? fmt.format(model.contextWindow) : "–"),
      el("td", "num", model.maxTokens ? fmt.format(model.maxTokens) : "–"),
    );
    modelBody.append(row);
  }
  $("docs-models-empty").hidden = models.length > 0;
  const source = data.modelSource ? `Sumber: ${data.modelSource}. ` : "";
  $("docs-model-source").textContent = `${source}${fmt.format(models.length)} model.`;

  const aliases = data.aliases || {};
  $("docs-aliases").textContent = `Alias Anthropic: opus = ${aliases.opus || "–"}, sonnet = ${aliases.sonnet || "–"}, haiku = ${aliases.haiku || "–"}.`;

  const model = models[0]?.id || "zai_glm-5.3";
  $("docs-example").textContent = [
    `curl ${data.baseUrl.openai}/chat/completions \\`,
    `  -H "Authorization: Bearer KUNCI_ANDA" \\`,
    `  -H "Content-Type: application/json" \\`,
    `  -d '{"model":"${model}","messages":[{"role":"user","content":"Halo"}]}'`,
  ].join("\n");
}

async function loadDocs() {
  if (state.docs) {
    renderDocs();
    return;
  }
  try {
    state.docs = await request("/api/docs");
    state.docsError = "";
  } catch (err) {
    state.docsError = err.message;
  }
  renderDocs();
}

function healthStatusLabel(status) {
  if (status === "ok") return "Sehat";
  if (status === "err") return "Error";
  return "Pending";
}

function renderHealth() {
  const data = state.health;
  const list = $("health-list");
  const error = $("health-error");
  error.hidden = !state.healthError;
  error.textContent = state.healthError || "";
  const button = $("health-run");
  button.disabled = state.healthLoading || data?.running === true;
  button.textContent = button.disabled && data?.running ? "Memeriksa..." : "Periksa akun";

  if (!data) {
    $("health-summary").textContent = "Periksa token dan saldo semua akun AutoClaw yang terdeteksi.";
    list.replaceChildren();
    $("health-empty").hidden = false;
    return;
  }

  const results = data.results || [];
  const counts = results.reduce((acc, item) => {
    acc[item.status] = (acc[item.status] || 0) + 1;
    return acc;
  }, {});
  if (data.running) {
    $("health-summary").textContent = "Pemeriksaan berjalan. Saldo dibaca paralel dari AutoClaw.";
  } else if (data.finishedAt) {
    $("health-summary").textContent = `${fmt.format(counts.ok || 0)} sehat, ${fmt.format(counts.err || 0)} error, ${fmt.format(counts.pending || 0)} pending. Diperiksa ${clock(data.finishedAt)}.`;
  } else {
    $("health-summary").textContent = `${fmt.format(results.length)} akun terdeteksi. Belum ada pemeriksaan.`;
  }

  list.replaceChildren();
  $("health-empty").hidden = results.length > 0;
  for (const account of results) {
    const label = accountLabel(account);
    const li = el("li", "account-item");
    if (account.active) li.dataset.active = "true";
    if (account.hasCredentials === false) li.dataset.unavailable = "true";

    const main = el("div", "account-main");
    const avatar = el("span", "account-avatar", initials(label));
    avatar.setAttribute("aria-hidden", "true");
    const who = document.createElement("div");
    const title = el("h3", "", label);
    if (account.active) title.append(" ", el("span", "badge ok", "aktif"));
    if (account.source === "dashboard") title.append(" ", el("span", "badge", "dashboard"));
    if (account.hasCredentials === false) title.append(" ", el("span", "badge warn", "tanpa kredensial"));
    who.append(title, el("p", "account-sub", `AutoClaw, ID ${accountIdText(account)}`));

    const facts = document.createElement("dl");
    facts.className = "account-facts";
    const statusFact = document.createElement("div");
    const stateBadge = el("span", "state", healthStatusLabel(account.status));
    if (account.status === "ok") stateBadge.dataset.tone = "ok";
    if (account.status === "err") stateBadge.dataset.tone = "err";
    if (account.message) stateBadge.title = account.message;
    const statusValue = el("dd");
    statusValue.append(stateBadge);
    statusFact.append(el("dt", "", "Status"), statusValue);
    const creditFact = document.createElement("div");
    creditFact.append(
      el("dt", "", "Kredit"),
      el("dd", "credit-value", account.credits?.ok ? `${fmt.format(account.credits.totalPoints)} poin` : "–"),
    );
    const dailyFact = document.createElement("div");
    dailyFact.append(
      el("dt", "", "Saldo harian"),
      el("dd", "", account.credits?.ok && account.credits.dailyPoints != null
        ? `${fmt.format(account.credits.dailyPoints)} poin` : "–"),
    );
    const idFact = document.createElement("div");
    idFact.append(el("dt", "", "ID"), el("dd", "", accountIdText(account)));
    facts.append(statusFact, creditFact, dailyFact, idFact);
    main.append(avatar, who, facts);
    li.append(main);
    list.append(li);
  }
}

async function loadHealth() {
  if (state.healthLoading) return;
  state.healthLoading = true;
  try {
    state.health = await request("/api/health");
    state.healthError = "";
  } catch (err) {
    state.healthError = err.message;
  } finally {
    state.healthLoading = false;
  }
  renderHealth();
}

async function runHealthCheck() {
  if (state.healthLoading) return;
  state.healthLoading = true;
  state.healthError = "";
  if (state.health) state.health.running = true;
  renderHealth();
  try {
    state.health = await request("/api/health/run", { method: "POST" });
  } catch (err) {
    state.healthError = err.message;
  } finally {
    state.healthLoading = false;
  }
  renderHealth();
}

function renderAccounts() {
  const data = state.accounts;
  const backend = data?.backend || state.data?.config?.backend || "autoclaw";
  const status = $("accounts-status");
  $("accounts-error").hidden = !state.accountsError;
  $("accounts-error").textContent = state.accountsError || "";

  if (!data) {
    $("active-account-name").textContent = "Membaca akun";
    $("active-account-sub").textContent = "–";
    $("active-account-id").textContent = "–";
    $("active-account-backend").textContent = backend;
    $("active-account-state").textContent = "–";
    $("active-account-initial").textContent = "–";
    $("active-account-note").textContent = "Memuat akun dari vault AutoClaw.";
    $("accounts-count").textContent = "–";
    return;
  }

  const accounts = data.accounts || [];
  const active = accounts.find((account) => account.active) || null;
  const activeCard = $("active-account");

  if (backend === "zai") {
    $("active-account-initial").textContent = "Z";
    $("active-account-name").textContent = "Z.ai API key";
    $("active-account-sub").textContent = "Backend zai tidak memakai akun AutoClaw.";
    $("active-account-id").textContent = "–";
    $("active-account-backend").textContent = "zai";
    $("active-account-state").textContent = state.data?.config?.zaiKeyConfigured ? "key tersimpan" : "key belum diisi";
    $("active-account-note").textContent = "Daftar akun AutoClaw tetap disimpan, tetapi baru dipakai kalau backend kembali ke autoclaw.";
    activeCard.dataset.state = state.data?.config?.zaiKeyConfigured ? "ok" : "warn";
  } else if (active) {
    const label = accountLabel(active);
    $("active-account-initial").textContent = initials(label);
    $("active-account-name").textContent = label;
    $("active-account-sub").textContent = `AutoClaw, ID ${accountIdText(active)}`;
    $("active-account-id").textContent = accountIdText(active);
    $("active-account-backend").textContent = backend;
    $("active-account-state").textContent = "token terbaca";
    $("active-account-note").textContent = "Kedua jalur memakai akun ini. Ganti akun kapan saja; request berikutnya memakai pilihan baru.";
    activeCard.dataset.state = "ok";
  } else {
    $("active-account-initial").textContent = "–";
    $("active-account-name").textContent = "Belum ada akun aktif";
    $("active-account-sub").textContent = data.configuredKey
      ? "Akun yang dipilih tidak bisa dibaca. Login ulang di AutoClaw atau pilih akun lain."
      : "Token AutoClaw belum terbaca.";
    $("active-account-id").textContent = "–";
    $("active-account-backend").textContent = backend;
    $("active-account-state").textContent = "tidak terbaca";
    $("active-account-note").textContent = "Cek status token di halaman Ringkasan, lalu muat ulang daftar akun.";
    activeCard.dataset.state = "err";
  }

  $("accounts-count").textContent = accounts.length === 0
    ? "Belum ada akun"
    : `${fmt.format(accounts.length)} akun siap dipakai`;

  const list = $("accounts-list");
  list.replaceChildren();
  $("accounts-empty").hidden = accounts.length > 0;

  for (const account of accounts) {
    const li = el("li", "account-item");
    li.id = `account-${account.key}`;
    if (account.active) li.dataset.active = "true";
    if (!account.hasCredentials) li.dataset.unavailable = "true";

    const main = el("div", "account-main");
    const avatar = el("span", "account-avatar", initials(accountLabel(account)));
    avatar.setAttribute("aria-hidden", "true");
    const who = document.createElement("div");
    const title = el("h3", "", accountLabel(account));
    if (account.active) title.append(" ", el("span", "badge ok", "aktif"));
    if (account.source === "dashboard") title.append(" ", el("span", "badge", "dashboard"));
    if (!account.hasCredentials) title.append(" ", el("span", "badge warn", "tanpa kredensial"));
    if (account.isGuest) title.append(" ", el("span", "badge", "guest"));
    who.append(title, el("p", "account-sub", `AutoClaw, ID ${accountIdText(account)}`));

    const facts = document.createElement("dl");
    facts.className = "account-facts";
    const idFact = document.createElement("div");
    idFact.append(el("dt", "", "ID"), el("dd", "", accountIdText(account)));
    const creditFact = document.createElement("div");
    const credit = account.credits;
    const creditText = credit?.ok
      ? `${fmt.format(credit.totalPoints)} poin`
      : account.hasCredentials ? (credit?.error || "–") : "perlu login";
    const creditValue = el("dd", "credit-value", creditText);
    if (credit?.ok) creditValue.title = `Terbaca ${clock(credit.updatedAt)}`;
    creditFact.append(el("dt", "", "Kredit"), creditValue);
    const loginFact = document.createElement("div");
    loginFact.append(el("dt", "", "Login terakhir"), el("dd", "", loginTime(account.lastLoginAt)));
    const sourceFact = document.createElement("div");
    sourceFact.append(el("dt", "", "Sumber"), el("dd", "", account.source === "dashboard" ? "Dashboard" : "Vault"));
    facts.append(idFact, creditFact, loginFact, sourceFact);
    main.append(avatar, who, facts);

    const actions = el("div", "account-actions");
    const activate = el("button", "btn small", account.active ? "Aktif" : account.hasCredentials ? "Jadikan aktif" : "Perlu login");
    activate.type = "button";
    activate.disabled = Boolean(account.active || !account.hasCredentials);
    activate.addEventListener("click", () => activateAccount(account.key, activate));
    const copyLink = el("button", "btn small", "Salin tautan");
    copyLink.type = "button";
    copyLink.title = "Salin tautan dashboard ke kartu akun ini";
    copyLink.addEventListener("click", () => copyText(`${location.origin}/accounts#${account.key}`, copyLink));
    const copyId = el("button", "btn small", "Salin ID");
    copyId.type = "button";
    copyId.title = "Salin ID akun AutoClaw";
    copyId.addEventListener("click", () => copyText(account.numericUserId || account.accountId || account.key, copyId));
    actions.append(activate, copyLink, copyId);
    if (account.source === "dashboard") {
      const rename = el("button", "btn small", "Ubah nama");
      rename.type = "button";
      rename.title = "Ganti nama tampilan akun ini";
      rename.addEventListener("click", () => renameAccount(account, rename));
      actions.append(rename);
      const remove = el("button", "btn small danger", "Hapus");
      remove.type = "button";
      remove.title = "Hapus akun dan token dari dashboard";
      remove.addEventListener("click", () => deleteAccount(account, remove));
      actions.append(remove);
    }
    li.append(main, actions);
    list.append(li);
  }

  if (!status.textContent) {
    status.textContent = accounts.length > 0
      ? "Pilih akun untuk dipakai kedua jalur. Token tidak ditampilkan di halaman ini."
      : "Tambah akun lewat Login Z.ai, atau muat ulang setelah login di aplikasi AutoClaw.";
  }

  if (location.hash) {
    const target = document.getElementById(`account-${location.hash.slice(1)}`);
    if (target) {
      target.scrollIntoView({ block: "center" });
      history.replaceState(null, "", location.pathname);
    }
  }
}

async function loadAccounts(force = false) {
  if (state.accountsLoading) return;
  state.accountsLoading = true;
  try {
    state.accounts = await request(`/api/accounts${force ? "?refresh=1" : ""}`);
    state.accountsError = "";
    renderAccounts();
    if (state.route === "/") {
      renderOverviewStats();
      renderOverviewAccounts();
    }
  } catch (err) {
    state.accountsError = err.message;
    renderAccounts();
  } finally {
    state.accountsLoading = false;
  }
}

async function activateAccount(key, button) {
  const status = $("accounts-status");
  status.textContent = "Mengaktifkan akun dan memuat ulang kedua jalur.";
  button.disabled = true;
  try {
    const result = await request("/api/accounts/active", {
      method: "POST",
      body: JSON.stringify({ key }),
    });
    const failed = Object.entries(result.reload || {}).filter(([, value]) => !value.ok);
    status.textContent = failed.length
      ? `Akun disimpan, tetapi gagal dimuat ulang: ${failed.map(([name]) => name).join(", ")}.`
      : "Akun aktif diganti. Request berikutnya memakai akun baru.";
    await loadAccounts();
    await refresh();
  } catch (err) {
    status.textContent = `Gagal mengganti akun: ${err.message}`;
    button.disabled = false;
  }
}

async function renameAccount(account, button) {
  const current = accountLabel(account);
  const input = prompt(translateText("Nama akun:"), current);
  if (input == null) return;
  const name = input.trim();
  if (!name || name === current) return;
  const status = $("accounts-status");
  button.disabled = true;
  try {
    await request(`/api/accounts/${encodeURIComponent(account.key)}`, {
      method: "PATCH",
      body: JSON.stringify({ name }),
    });
    await loadAccounts(true);
    status.textContent = `Nama akun diubah menjadi ${name}.`;
  } catch (err) {
    status.textContent = `Gagal mengubah nama: ${err.message}`;
    button.disabled = false;
  }
}

async function deleteAccount(account, button) {
  const label = accountLabel(account);
  if (!confirm(translateText(`Hapus ${label} dari dashboard? Token yang tersimpan ikut dihapus.`))) return;
  const status = $("accounts-status");
  status.textContent = `Menghapus ${label}.`;
  button.disabled = true;
  try {
    const result = await request(`/api/accounts/${encodeURIComponent(account.key)}`, { method: "DELETE" });
    await loadAccounts(true);
    await refresh();
    status.textContent = result.activeCleared
      ? `${label} dihapus. Jalur dimuat ulang karena akun itu sedang aktif.`
      : `${label} dihapus.`;
  } catch (err) {
    status.textContent = `Gagal menghapus akun: ${err.message}`;
    button.disabled = false;
  }
}

async function copyText(value, button) {
  const label = button.textContent;
  try {
    await navigator.clipboard.writeText(value);
    button.textContent = "Tersalin";
  } catch {
    const area = el("textarea");
    area.value = value;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.left = "-999px";
    document.body.append(area);
    area.select();
    try { document.execCommand("copy"); } catch { /* selection tetap terlihat */ }
    area.remove();
    button.textContent = "Tersalin";
  }
  setTimeout(() => {
    if (button.isConnected) button.textContent = label;
  }, 1500);
}

function renderRequests() {
  const all = allRecent();
  const strip = $("outcome-strip");
  strip.replaceChildren();

  const shown = all.slice(-60);
  for (const row of shown) {
    const cell = el("span", toneForStatus(row.status));
    cell.title = `${clock(row.ts)}, ${laneName(row.lane)}, ${row.status}, ${row.error || "ok"}`;
    strip.append(cell);
  }
  if (shown.length === 0) {
    for (let i = 0; i < 20; i++) strip.append(el("span"));
  }

  const counts = shown.reduce((acc, row) => {
    const tone = toneForStatus(row.status);
    acc[tone] = (acc[tone] || 0) + 1;
    return acc;
  }, {});
  $("outcome-legend").textContent = shown.length === 0
    ? "Belum ada request tercatat di proses ini."
    : `${fmt.format(shown.length)} request terakhir, ${fmt.format(counts.ok || 0)} sukses, ${fmt.format(counts.warn || 0)} rate limit, ${fmt.format(counts.err || 0)} error`;

  $("requests-range").textContent = all.length > 0
    ? `${fmt.format(all.length)} request, terbaru ${clock(all[all.length - 1].ts)}`
    : "Belum ada data";

  const filter = state.requestFilter;
  const visible = all
    .filter((row) => filter === "all" || toneForStatus(row.status) === filter)
    .slice(-40)
    .reverse();

  const body = $("requests-body");
  body.replaceChildren();
  $("requests-empty").hidden = all.length > 0;
  $("requests-filtered-empty").hidden = !(all.length > 0 && visible.length === 0);

  for (const row of visible) {
    const tr = document.createElement("tr");
    const status = document.createElement("td");
    status.append(statusBadge(row.status));
    tr.append(
      el("td", "num", clock(row.ts)),
      el("td", "", laneName(row.lane)),
      el("td", "", row.key || "–"),
      el("td", "", row.model || "–"),
      status,
      el("td", "num", `${fmt.format(row.latencyMs ?? 0)} ms`),
      el("td", "wrap", row.error || "–"),
    );
    body.append(tr);
  }
}

function fillSettings() {
  if (!state.data) return;
  const p = primaryProxy();
  const cfg = p?.config || {};
  const fileValues = state.data.config?.fileValues || {};

  const values = {
    GLMP_BACKEND: state.data.config?.backend || "autoclaw",
    ZAI_BASE_URL: fileValues.ZAI_BASE_URL || "",
    BUDGET_REQUESTS_PER_HOUR: cfg.budgetRequestsPerHour ?? 300,
    MIN_GAP_MS: cfg.minGapMs ?? 250,
    GLMP_QUEUE_MAX_DEPTH: cfg.queueMaxDepth ?? 50,
    GLMP_QUEUE_WAIT_MS: cfg.queueWaitMs ?? 0,
    MAX_MESSAGES: cfg.maxMessages ?? "",
    UPSTREAM_TIMEOUT_MS: cfg.upstreamTimeoutMs ?? 300000,
    GLMP_THROTTLE_RETRIES: cfg.throttleRetries ?? 2,
    GLMP_THROTTLE_RETRY_MS: fileValues.GLMP_THROTTLE_RETRY_MS ?? 4000,
    HEARTBEAT_INTERVAL_MS: cfg.heartbeatIntervalMs ?? 300000,
    GLMP_KEY_WINDOW_HOURS: fileValues.GLMP_KEY_WINDOW_HOURS ?? 1,
  };

  for (const [name, value] of Object.entries(values)) {
    const input = $(name);
    if (input) input.value = value ?? "";
  }

  $("ZAI_API_KEY").value = "";
  $("zai-key-hint").textContent = state.data.config?.zaiKeyConfigured
    ? "API key sudah tersimpan. Isi hanya kalau ingin menggantinya."
    : "Belum ada API key Z.ai. Wajib kalau backend diubah ke Z.ai.";
  $("config-path").textContent = state.data.config?.file || "config.json";
  state.settingsFilled = true;
}

function renderSettings() {
  if (!state.settingsFilled) fillSettings();
}

function fillLogSelect() {
  const select = $("log-file");
  const files = state.data?.logs || [];
  const signature = files.map((f) => `${f.name}:${f.size}`).join("|");

  if (signature !== state.logSignature) {
    state.logSignature = signature;
    const previous = select.value || state.logName;
    select.replaceChildren();
    if (files.length === 0) {
      const option = el("option", "", "Tidak ada berkas log");
      option.value = "";
      select.append(option);
      select.disabled = true;
    } else {
      select.disabled = false;
      for (const file of files) {
        const option = el("option", "", `${file.name} (${fmt.format(Math.round((file.size || 0) / 1024))} KB)`);
        option.value = file.name;
        select.append(option);
      }
      if (previous && files.some((f) => f.name === previous)) {
        select.value = previous;
      } else {
        select.value = files[0].name;
        state.logLoadedFor = "";
      }
    }
  }

  if (!state.logName || !files.some((f) => f.name === state.logName)) {
    state.logName = select.value || "";
  }
}

async function loadLog({ scrollBottom = false } = {}) {
  if (!state.logName) {
    $("log-view").textContent = "Tidak ada berkas log di folder logs.";
    return;
  }
  if (state.logLoading) return;
  state.logLoading = true;
  const name = state.logName;
  const view = $("log-view");
  const atBottom = view.scrollHeight - view.scrollTop - view.clientHeight < 24;
  try {
    const data = await request(`/api/logs?name=${encodeURIComponent(name)}&lines=400`);
    if (state.logName !== name) return;
    view.textContent = data.text || "(kosong)";
    if (scrollBottom || atBottom) view.scrollTop = view.scrollHeight;
    state.logLoadedFor = name;
  } catch (err) {
    if (state.logName === name) view.textContent = `Gagal membaca log: ${err.message}`;
  } finally {
    state.logLoading = false;
  }
}

function renderLogs() {
  if (!state.data) return;
  fillLogSelect();
  if (state.logName && state.logLoadedFor !== state.logName) {
    loadLog({ scrollBottom: $("log-follow").checked });
  }
}

function renderRoute() {
  const meta = ROUTES[state.route] || ROUTES["/"];
  document.title = `${translateText(meta.title)} · Autoclaw`;
  $("page-title").textContent = meta.title;
  $("page-desc").textContent = meta.desc;

  for (const section of document.querySelectorAll("[data-page]")) {
    section.hidden = section.dataset.page !== pageName(state.route);
  }

  for (const link of document.querySelectorAll("nav a[data-route]")) {
    if (link.getAttribute("href") === state.route) {
      link.setAttribute("aria-current", "page");
    } else {
      link.removeAttribute("aria-current");
    }
  }

  renderChrome();
  window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  $("page-title").focus({ preventScroll: true });

  if (!state.data) return;
  switch (state.route) {
    case "/accounts": renderAccounts(); loadAccounts(); break;
    case "/keys": renderKeys(); break;
    case "/requests": renderRequests(); break;
    case "/upstream": renderCapacity(); renderLanes(); break;
    case "/health": renderHealth(); loadHealth(); break;
    case "/api-docs": renderDocs(); loadDocs(); break;
    case "/settings": renderSettings(); break;
    case "/logs": renderLogs(); break;
    default:
      renderOverview();
      if (!state.accounts) loadAccounts();
      break;
  }
  renderCapacity();
  renderLanes();
}

function pageName(route) {
  return route === "/" ? "overview" : route.slice(1);
}

function normalizePath(pathname) {
  const path = String(pathname || "").replace(/\/+$/, "");
  return path || "/";
}

function navigate(path, { push = true } = {}) {
  const next = ROUTES[path] ? path : "/";
  const changed = next !== state.route;
  state.route = next;
  if (push && changed) history.pushState({}, "", next);
  if (changed) {
    const main = $("main");
    const offset = main.getBoundingClientRect().top;
    // Keep the document position but make the new page start at the header.
    void offset;
  }
  renderRoute();
}

async function refresh() {
  if (state.fetching) return;
  state.fetching = true;
  const button = $("refresh-all");
  button.disabled = true;
  try {
    const data = await request("/api/status");
    state.data = data;
    state.error = null;
    renderChrome();
    if (state.route === "/keys") renderKeys();
    if (state.route === "/requests") renderRequests();
    if (state.route === "/settings") renderSettings();
    if (state.route === "/logs") renderLogs();
    if (state.route === "/") {
      renderOverview();
      if (!state.accounts) loadAccounts();
      renderCapacity();
      renderLanes();
    }
    if (state.route === "/upstream") {
      renderCapacity();
      renderLanes();
    }
    if (state.route === "/keys" || state.route === "/settings") {
      renderCapacity();
      renderLanes();
    }
    if (state.route === "/health") loadHealth();
    if (state.route === "/api-docs") loadDocs();
    if (state.route === "/logs" && $("log-follow").checked && state.logLoadedFor === state.logName) {
      loadLog();
    }
    if (state.route === "/accounts") loadAccounts();
  } catch (err) {
    state.error = err;
    renderChrome();
  } finally {
    state.fetching = false;
    button.disabled = false;
  }
}

function loginStatus(message, isError = false) {
  const status = $("account-login-status");
  status.textContent = message;
  status.dataset.state = isError ? "err" : "ok";
}

function resetAccountDialog() {
  loginStatus("");
}

function openAccountDialog() {
  const dialog = $("account-dialog");
  resetAccountDialog();
  if (!dialog.open) dialog.showModal();
  $("zai-login").focus();
}

function openKeyDialog() {
  $("key-error").hidden = true;
  $("key-result").hidden = true;
  $("key-form").reset();
  $("key-rate").value = "0";
  const submit = $("key-form").querySelector('button[type="submit"]');
  submit.disabled = false;
  submit.textContent = "Buat kunci";

  const seen = new Set();
  const options = $("model-options");
  options.replaceChildren();
  for (const key of ["openai", "anthropic"]) {
    for (const model of state.data?.proxies?.[key]?.models || []) {
      if (!model?.id || seen.has(model.id)) continue;
      seen.add(model.id);
      const option = el("option");
      option.value = model.id;
      options.append(option);
    }
  }

  $("key-dialog").showModal();
  $("key-name").focus();
}

$("refresh-all").addEventListener("click", () => refresh());
$("banner-retry").addEventListener("click", () => refresh());

for (const link of document.querySelectorAll("a[data-route]")) {
  link.addEventListener("click", (event) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    navigate(normalizePath(link.getAttribute("href")), { push: true });
  });
}

window.addEventListener("popstate", () => {
  const path = normalizePath(location.pathname);
  if (!ROUTES[path]) {
    history.replaceState({}, "", "/");
    state.route = "/";
  } else {
    state.route = path;
  }
  renderRoute();
});

for (const button of document.querySelectorAll(".seg")) {
  button.addEventListener("click", () => {
    state.requestFilter = button.dataset.filter;
    for (const other of document.querySelectorAll(".seg")) {
      other.setAttribute("aria-pressed", other === button ? "true" : "false");
    }
    renderRequests();
  });
}

$("log-file").addEventListener("change", () => {
  state.logName = $("log-file").value;
  state.logLoadedFor = "";
  loadLog({ scrollBottom: true });
});

$("refresh-logs").addEventListener("click", () => loadLog({ scrollBottom: true }));

$("log-follow").addEventListener("change", () => {
  if ($("log-follow").checked) loadLog({ scrollBottom: true });
});

$("settings-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const status = $("settings-status");
  const submit = $("settings-submit");
  submit.disabled = true;
  const label = submit.textContent;
  submit.textContent = "Menyimpan...";
  status.textContent = "Menyimpan konfigurasi.";

  const payload = {};
  for (const element of form.elements) {
    if (!element.name) continue;
    if (element.name === "ZAI_API_KEY" && element.value === "") continue;
    payload[element.name] = element.value;
  }

  try {
    const result = await request("/api/config", {
      method: "PUT",
      body: JSON.stringify(payload),
    });
    const failed = Object.entries(result.reload || {}).filter(([, value]) => !value.ok);
    status.textContent = failed.length
      ? `Tersimpan, tetapi gagal dimuat ulang: ${failed.map(([name]) => name).join(", ")}.`
      : "Tersimpan dan dimuat ulang.";
    $("ZAI_API_KEY").value = "";
    state.settingsFilled = false;
    await refresh();
  } catch (err) {
    status.textContent = `Gagal menyimpan: ${err.message}`;
  } finally {
    submit.disabled = false;
    submit.textContent = label;
  }
});

$("add-account").addEventListener("click", openAccountDialog);
$("account-dialog").addEventListener("close", resetAccountDialog);
$("zai-login").addEventListener("click", () => {
  const tab = window.open("/oauth/zai", "_blank");
  if (!tab) {
    loginStatus("Tab login diblokir browser. Izinkan popup untuk dashboard lokal.", true);
    return;
  }
  loginStatus("Tab login Z.ai dibuka. Setelah selesai, daftar akun dimuat ulang saat tab ini aktif kembali.");
});
$("health-run").addEventListener("click", runHealthCheck);
$("overview-checkin").addEventListener("click", runCheckinAll);
$("docs-copy-example").addEventListener("click", () => {
  copyText($("docs-example").textContent, $("docs-copy-example"));
});
window.addEventListener("focus", () => {
  if (state.route === "/accounts" && !state.accountsLoading) loadAccounts(true);
});
$("account-dialog-close").addEventListener("click", () => $("account-dialog").close());
$("accounts-refresh").addEventListener("click", async () => {
  await loadAccounts(true);
  $("accounts-status").textContent = state.accountsError
    ? `Gagal memuat akun: ${state.accountsError}`
    : "Daftar akun dimuat ulang.";
});
$("account-reload-now").addEventListener("click", async () => {
  $("account-dialog").close();
  await loadAccounts(true);
  $("accounts-status").textContent = state.accountsError
    ? `Gagal memuat akun: ${state.accountsError}`
    : "Daftar akun dimuat ulang.";
});
$("accounts-auto").addEventListener("click", async () => {
  const status = $("accounts-status");
  status.textContent = "Mengikuti vault terbaru dan memuat ulang kedua jalur.";
  try {
    const result = await request("/api/accounts/active", {
      method: "POST",
      body: JSON.stringify({ key: "" }),
    });
    const failed = Object.entries(result.reload || {}).filter(([, value]) => !value.ok);
    status.textContent = failed.length
      ? `Pilihan dihapus, tetapi gagal dimuat ulang: ${failed.map(([name]) => name).join(", ")}.`
      : "Pilihan akun dihapus. Proxy memakai vault terbaru lagi.";
    await loadAccounts();
    await refresh();
  } catch (err) {
    status.textContent = `Gagal: ${err.message}`;
  }
});

for (const id of ["add-key", "add-key-empty"]) {
  $(id).addEventListener("click", openKeyDialog);
}

$("key-cancel").addEventListener("click", () => $("key-dialog").close());

$("key-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const error = $("key-error");
  const submit = $("key-form").querySelector('button[type="submit"]');
  error.hidden = true;
  submit.disabled = true;
  submit.textContent = "Membuat...";

  const name = $("key-name").value.trim();
  const model = $("key-model").value.trim();
  const rate = $("key-rate").value;

  try {
    const result = await request("/api/keys", {
      method: "POST",
      body: JSON.stringify({
        name,
        model,
        requestsPerHour: rate === "" ? 0 : Number(rate),
      }),
    });
    $("key-result").hidden = false;
    $("key-value").textContent = result.key;
    $("key-copy").textContent = "Salin";
    await refresh();
    $("key-copy").focus();
  } catch (err) {
    error.textContent = err.message;
    error.hidden = false;
    submit.disabled = false;
    submit.textContent = "Buat kunci";
  }
});

$("key-copy").addEventListener("click", async () => {
  const value = $("key-value").textContent;
  try {
    await navigator.clipboard.writeText(value);
    $("key-copy").textContent = "Tersalin";
    setTimeout(() => { $("key-copy").textContent = "Salin"; }, 1500);
  } catch {
    const range = document.createRange();
    range.selectNodeContents($("key-value"));
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  }
});

$("key-dialog").addEventListener("close", () => {
  const submit = $("key-form").querySelector('button[type="submit"]');
  submit.disabled = false;
  submit.textContent = "Buat kunci";
  $("key-error").hidden = true;
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") refresh();
});

const initialPath = normalizePath(location.pathname);
if (!ROUTES[initialPath]) {
  history.replaceState({}, "", "/");
  state.route = "/";
} else {
  state.route = initialPath;
}

initI18n();

for (const button of document.querySelectorAll("[data-lang]")) {
  button.addEventListener("click", () => {
    if (!setLanguage(button.dataset.lang)) return;
    fmt = new Intl.NumberFormat(locale());
    rtf = new Intl.RelativeTimeFormat(locale(), { numeric: "auto" });
    renderRoute();
    refresh();
  });
}

renderRoute();
refresh();
setInterval(() => {
  if (document.visibilityState === "visible") refresh();
}, 5000);
