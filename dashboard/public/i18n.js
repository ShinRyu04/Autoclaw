const STORAGE_KEY = "glmp-lang";
const SUPPORTED = new Set(["id", "en"]);
const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "CODE", "PRE", "TEXTAREA"]);
const ATTRIBUTES = ["title", "placeholder", "aria-label", "alt"];

const EN = {
  "Lewati ke konten": "Skip to content",
  "Panel operasi lokal": "Local operations panel",
  "Navigasi utama": "Main navigation",
  "Menghubungkan ke proxy": "Connecting to proxy",
  "Membaca akun": "Reading account",
  "Ringkasan": "Overview",
  "Akun, pemakaian, dan request terakhir.": "Accounts, usage, and recent requests.",
  "Kapasitas governor dan status kedua jalur.": "Governor capacity and the status of both lanes.",
  "Uji token dan saldo semua akun AutoClaw.": "Test tokens and balances for all AutoClaw accounts.",
  "Base URL, endpoint, dan model yang tersedia di proxy lokal.": "Base URL, endpoints, and models available in the local proxy.",
  "Akun AutoClaw yang terdeteksi dan akun yang dipakai kedua jalur.": "Detected AutoClaw accounts and the account used by both lanes.",
  "Kelola kunci klien, pin model, dan kuota per jam.": "Manage client keys, model pins, and hourly quota.",
  "Batas akun, antrean, throttle, dan backend.": "Account limits, queue, throttle, and backend.",
  "Ekor berkas log proxy tanpa membuka terminal.": "Tail proxy log files without opening a terminal.",
  "Akun": "Accounts",
  "Kunci": "Keys",
  "Request": "Requests",
  "Upstream": "Upstream",
  "Dokumentasi API": "API docs",
  "Pengaturan": "Settings",
  "Log": "Logs",
  "Muat ulang": "Reload",
  "Coba lagi": "Try again",
  "Total akun": "Total accounts",
  "siap dipakai": "ready to use",
  "Akun aktif": "Active account",
  "dipakai kedua jalur": "used by both lanes",
  "Total poin": "Total points",
  "saldo AutoClaw": "AutoClaw balance",
  "Request API": "API requests",
  "sejak proxy hidup": "since proxy start",
  "Token terpakai": "Tokens used",
  "Estimasi biaya": "Estimated cost",
  "tidak dilacak upstream": "not tracked upstream",
  "Memuat akun.": "Loading accounts.",
  "Check-in semua": "Check-in all",
  "Kelola": "Manage",
  "Belum ada akun. Tambah akun lewat Login Z.ai.": "No accounts yet. Add an account via Z.ai login.",
  "Request terakhir": "Recent requests",
  "Semua request": "All requests",
  "Delapan request terakhir dari kedua jalur": "Last eight requests from both lanes",
  "Waktu": "Time",
  "Jalur": "Lane",
  "Status": "Status",
  "Model": "Model",
  "Latensi": "Latency",
  "Error": "Error",
  "Tekanan kuota kunci": "Key quota pressure",
  "Kelola kunci": "Manage keys",
  "Belum ada kunci klien. Tambah kunci kalau ada klien yang perlu akses terpisah.": "No client keys yet. Add a key if a client needs separate access.",
  "Kapasitas jam ini": "Capacity this hour",
  "memuat": "loading",
  "/ – request": "/ – requests",
  "Pemakaian budget per jam": "Hourly budget usage",
  "Reset jendela": "Window reset",
  "Antrean": "Queue",
  "Jeda kirim": "Send delay",
  "Membaca status governor.": "Reading governor status.",
  "Jalur upstream": "Upstream lanes",
  "Satu akun, dua format. Status dibaca dari": "One account, two formats. Status read from",
  "masing-masing proses.": "each process.",
  "Dua jalur berbagi satu akun AutoClaw. Antrean dihitung per proses.": "Both lanes share one AutoClaw account. The queue is counted per process.",
  "Dua jalur memakai API key Z.ai yang sama. Antrean dihitung per proses.": "Both lanes use the same Z.ai API key. The queue is counted per process.",
  "Token": "Token",
  "Proses": "Process",
  "Error: tidak ada respons": "Error: no response",
  "Base URL": "Base URL",
  "Header autentikasi": "Auth header",
  "Endpoint": "Endpoints",
  "Semua endpoint memakai kunci operator atau kunci klien dari halaman Kunci.": "All endpoints use the operator key or a client key from the Keys page.",
  "Metode": "Method",
  "Keterangan": "Description",
  "Status token upstream.": "Upstream token status.",
  "Authorization: Bearer <kunci>": "Authorization: Bearer <key>",
  "x-api-key: <kunci> atau Authorization: Bearer <kunci>": "x-api-key: <key> or Authorization: Bearer <key>",
  "keduanya": "both",
  "Membaca katalog model.": "Reading model catalog.",
  "ID model": "Model ID",
  "Nama": "Name",
  "Output maksimum": "Max output",
  "Katalog model tidak terbaca. Jalankan proxy lalu muat ulang halaman.": "Model catalog could not be read. Start the proxy, then reload the page.",
  "Alias Anthropic: –": "Anthropic aliases: –",
  "Contoh request": "Example request",
  "Salin contoh": "Copy example",
  "Memuat contoh.": "Loading example.",
  "Daftar model dalam format OpenAI.": "Model list in OpenAI format.",
  "Daftar model dalam format Anthropic.": "Model list in Anthropic format.",
  "Chat completion, streaming dan non-streaming.": "Chat completion, streaming and non-streaming.",
  "Messages API Anthropic, termasuk SSE.": "Anthropic Messages API, including SSE.",
  "Stub hitung token, selalu mengembalikan 0.": "Token counting stub, always returns 0.",
  "Kesehatan akun": "Account health",
  "Periksa token dan saldo semua akun AutoClaw yang terdeteksi.": "Check tokens and balances for all detected AutoClaw accounts.",
  "Periksa akun": "Check accounts",
  "Belum ada akun untuk diperiksa.": "No accounts to check.",
  "Tambahkan akun lewat halaman Akun, lalu jalankan pemeriksaan.": "Add an account on the Accounts page, then run a check.",
  "Memeriksa...": "Checking...",
  "Check-in...": "Checking in...",
  "Pemeriksaan berjalan. Saldo dibaca paralel dari AutoClaw.": "Check running. Balances are read from AutoClaw in parallel.",
  "Sehat": "Healthy",
  "Pending": "Pending",
  "Perlu login": "Login required",
  "Saldo harian": "Daily balance",
  "Kredit": "Credit",
  "Login terakhir": "Last login",
  "Sumber": "Source",
  "tidak tercatat": "not recorded",
  "token terbaca": "token read",
  "Kedua jalur memakai akun ini. Ganti akun kapan saja; request berikutnya memakai pilihan baru.": "Both lanes use this account. Switch accounts at any time; the next request uses the new choice.",
  "Pilih akun untuk dipakai kedua jalur. Token tidak ditampilkan di halaman ini.": "Choose the account used by both lanes. The token is not shown on this page.",
  "Akun AutoClaw": "AutoClaw accounts",
  "Akun dashboard disimpan terenkripsi di mesin ini dan bisa dipakai tanpa membuka AutoClaw. Akun vault tetap dibaca dari AutoClaw. Token tidak pernah dikirim ke halaman ini.": "Dashboard accounts are stored encrypted on this machine and work without opening AutoClaw. Vault accounts are still read from AutoClaw. Tokens are never sent to this page.",
  "Ikuti vault": "Follow vault",
  "Tambah akun": "Add account",
  "Memuat akun dari vault.": "Loading account from vault.",
  "Semua akun": "All accounts",
  "Belum ada akun AutoClaw yang bisa dipakai.": "No AutoClaw accounts available.",
  "Tambah akun lewat Login Z.ai, lalu muat ulang daftar.": "Add an account via Z.ai login, then reload the list.",
  "Jadikan aktif": "Make active",
  "Aktif": "Active",
  "Salin tautan": "Copy link",
  "Salin ID": "Copy ID",
  "Ubah nama": "Rename",
  "Hapus": "Delete",
  "Dashboard": "Dashboard",
  "Vault": "Vault",
  "Tambah akun AutoClaw": "Add AutoClaw account",
  "Token disimpan terenkripsi di mesin ini; browser tidak pernah menerima token.": "The token is stored encrypted on this machine; the browser never receives it.",
  "Login dengan Z.ai": "Log in with Z.ai",
  "Buka tab login, selesaikan captcha, lalu masuk. Akun tersimpan otomatis setelah callback.": "Open the login tab, complete the captcha, then sign in. The account is saved automatically after the callback.",
  "Buka login Z.ai": "Open Z.ai login",
  "Tambah akun hanya lewat OAuth Z.ai.": "Accounts can only be added through Z.ai OAuth.",
  "Muat ulang daftar": "Reload list",
  "Tutup": "Close",
  "Kunci klien": "Client keys",
  "Kunci operator (": "Operator key (",
  ") selalu diterima tanpa kuota sendiri. Baris di bawah berasal dari": ") is always accepted without its own quota. Rows below come from",
  "Tambah kunci": "Add key",
  "Kuota jam ini": "Quota this hour",
  "Total": "Total",
  "Terakhir dipakai": "Last used",
  "Aksi": "Actions",
  "Kunci klien dan pemakaian kuotanya": "Client keys and quota usage",
  "Belum ada kunci klien.": "No client keys yet.",
  "Buat satu kunci per klien supaya kuota dan pemakaiannya bisa dipisah.": "Create one key per client so quota and usage can be separated.",
  "Tambah kunci pertama": "Add first key",
  "Aliran request kedua jalur dengan filter hasil.": "Request stream from both lanes with outcome filters.",
  "Belum ada request tercatat.": "No requests recorded yet.",
  "Belum ada request tercatat di proses ini.": "No requests recorded in this process yet.",
  "Tampilkan": "Show",
  "Semua": "All",
  "Sukses": "Success",
  "Rate limit": "Rate limit",
  "Tabel request terakhir": "Recent requests table",
  "Request terakhir dari kedua jalur": "Recent requests from both lanes",
  "Belum ada request di jendela proses ini. Kirim satu request lewat salah satu jalur.": "No requests in this process window. Send a request through either lane.",
  "Tidak ada request dengan status ini di jendela sekarang. Pilih Semua untuk melihat yang lain.": "No requests with this status in the current window. Choose All to see the others.",
  "Sumber upstream": "Upstream source",
  "AutoClaw (vault token)": "AutoClaw (vault token)",
  "Z.ai (API key langsung)": "Z.ai (direct API key)",
  "Mengubah backend butuh key Z.ai yang valid sebelum request berikutnya.": "Changing the backend requires a valid Z.ai key before the next request.",
  "Z.ai API key": "Z.ai API key",
  "Tidak diubah": "Unchanged",
  "Hanya dikirim saat diisi. Tidak pernah ditampilkan kembali.": "Only sent when filled. Never displayed again.",
  "Belum ada API key Z.ai. Wajib kalau backend diubah ke Z.ai.": "No Z.ai API key yet. Required if the backend is switched to Z.ai.",
  "Z.ai base URL": "Z.ai base URL",
  "Batas akun": "Account limits",
  "Budget request per jam": "Request budget per hour",
  "0 mematikan pacing. Governor tetap menolak saat budget habis.": "0 disables pacing. The governor still rejects when the budget is exhausted.",
  "Jeda minimum antar kirim (ms)": "Minimum delay between sends (ms)",
  "Timeout upstream (ms)": "Upstream timeout (ms)",
  "Maksimum pesan per request": "Maximum messages per request",
  "Kosong berarti tanpa batas.": "Empty means unlimited.",
  "Kedalaman antrean": "Queue depth",
  "Penuh menghasilkan": "Full returns",
  "Batas tunggu antrean (ms)": "Queue wait limit (ms)",
  "0 berarti menunggu tanpa batas.": "0 means wait indefinitely.",
  "Kuota kunci": "Key quota",
  "Jendela kuota kunci (jam)": "Key quota window (hours)",
  "Sliding window untuk": "Sliding window for",
  "tiap kunci.": "per key.",
  "Throttle dan heartbeat": "Throttle and heartbeat",
  "Retry throttle": "Throttle retry",
  "Jeda retry throttle (ms)": "Throttle retry delay (ms)",
  "Interval heartbeat (ms)": "Heartbeat interval (ms)",
  "0 mematikan heartbeat AutoClaw.": "0 disables the AutoClaw heartbeat.",
  "Simpan dan muat ulang": "Save and reload",
  "Tersimpan ke": "Saved to",
  ". Port, host, dan": ". Port, host, and",
  "tetap butuh restart.": "still require a restart.",
  "Berkas": "File",
  "Ikuti ujung": "Follow tail",
  "Isi log": "Log contents",
  "Pilih berkas log.": "Select a log file.",
  "Data dari endpoint": "Data from endpoint",
  "kedua jalur. Panel ini hanya loopback.": "both lanes. This panel is loopback only.",
  "Tambah kunci klien": "Add client key",
  "Pin model (opsional)": "Pin model (optional)",
  "contoh: zai_glm-5.3-flash": "e.g. zai_glm-5.3-flash",
  "Kuota request per jam (0 = tanpa batas)": "Request quota per hour (0 = unlimited)",
  "Buat kunci": "Create key",
  "Batal": "Cancel",
  "Kunci dibuat. Salin sekarang, nilainya tidak ditampilkan lagi.": "Key created. Copy it now; the value will not be shown again.",
  "Salin": "Copy",
  "Tersalin": "Copied",
  "Tidak ada": "None",
  "Belum ada": "None yet",
  "Belum ada data": "No data yet",
  "Tidak ada jalur yang menjawab": "No lane responded",
  "Tidak ada task check-in yang bisa diklaim.": "No check-in tasks to claim.",
  "Ada request menunggu slot generasi.": "Requests are waiting for a generation slot.",
  "Kedua jalur aktif": "Both lanes active",
  "Satu jalur aktif": "One lane active",
  "Tanpa nama": "Unnamed",
  "Tersimpan dan dimuat ulang.": "Saved and reloaded.",
  "Daftar akun dimuat ulang.": "Account list reloaded.",
  "Akun aktif diganti. Request berikutnya memakai akun baru.": "Active account changed. The next request uses the new account.",
  "Mengaktifkan akun dan memuat ulang kedua jalur.": "Activating the account and reloading both lanes.",
  "Mengikuti vault terbaru dan memuat ulang kedua jalur.": "Following the latest vault and reloading both lanes.",
  "Mengklaim check-in semua akun.": "Claiming check-in for all accounts.",
  "Tab login Z.ai dibuka. Setelah selesai, daftar akun dimuat ulang saat tab ini aktif kembali.": "The Z.ai login tab was opened. When finished, the account list reloads when this tab becomes active again.",
  "Tab login diblokir browser. Izinkan popup untuk dashboard lokal.": "The login tab was blocked by the browser. Allow popups for the local dashboard.",
  "Tambah akun lewat Login Z.ai, atau muat ulang setelah login di aplikasi AutoClaw.": "Add an account via Z.ai login, or reload after logging in to the AutoClaw app.",
  "Pilihan akun dihapus. Proxy memakai vault terbaru lagi.": "Account selection cleared. The proxy uses the latest vault again.",
  "Membuat...": "Creating...",
  "Menyimpan...": "Saving...",
  "Menyimpan konfigurasi.": "Saving configuration.",
  "Nonaktifkan": "Disable",
  "Aktifkan": "Enable",
  "Reset": "Reset",
  "nonaktif": "disabled",
  "mati": "down",
  "aktif": "active",
  "tanpa model": "no model",
  "tidak diketahui": "unknown",
  "tanpa batas": "unlimited",
  "Budget per jam dimatikan: request tidak dipacing.": "Hourly budget disabled: requests are not paced.",
  "Nama akun:": "Account name:",
  "(kosong)": "(empty)",
  "Ganti nama tampilan akun ini": "Rename this account display name",
  "Hapus akun dan token dari dashboard": "Delete the account and token from the dashboard",
  "Kedua jalur proxy tidak menjawab. Cek log proxy dan watchdog.": "Both proxy lanes are not responding. Check the proxy and watchdog logs.",
  "Tidak ada akun": "No accounts",
  "Tidak ada kunci": "No keys",
  "Tidak ada request": "No requests",
  "Tidak ada model": "No models",
  "Memuat akun": "Loading accounts",
  "Gagal memuat status": "Failed to load status",
  "Gagal memuat akun": "Failed to load accounts",
  "Gagal mengubah nama": "Failed to rename",
  "Gagal menghapus akun": "Failed to delete account",
  "Gagal mengganti akun": "Failed to switch account",
  "Gagal menyimpan": "Failed to save",
  "Gagal": "Failed",
  "Check-in gagal": "Check-in failed",
  "Memuat katalog model.": "Loading model catalog."
};

const PATTERNS = [
  [/^(\d[\d.,]*) akun siap dipakai$/, (m) => `${m[1]} accounts ready`],
  [/^(\d[\d.,]*) akun terdeteksi\. Belum ada pemeriksaan\.$/, (m) => `${m[1]} accounts detected. No check yet.`],
  [/^(\d[\d.,]*) sehat, ([\d.,]+) error, ([\d.,]+) pending\. Diperiksa (.+)\.$/, (m) => `${m[1]} healthy, ${m[2]} error, ${m[3]} pending. Checked ${m[4]}.`],
  [/^(\d[\d.,]*) aktif, ([\d.,]+) menunggu$/, (m) => `${m[1]} active, ${m[2]} waiting`],
  [/^(\d[\d.,]*) request, terbaru (.+)$/, (m) => `${m[1]} request${m[1] === "1" ? "" : "s"}, latest ${m[2]}`],
  [/^(\d[\d.,]*) request terakhir, ([\d.,]+) sukses, ([\d.,]+) rate limit, ([\d.,]+) error$/, (m) => `${m[1]} recent request${m[1] === "1" ? "" : "s"}, ${m[2]} success, ${m[3]} rate limit, ${m[4]} error`],
  [/^Akun (.+)$/, (m) => `Account ${m[1]}`],
  [/^Alias Anthropic: (.+)$/, (m) => `Anthropic aliases: ${m[1]}`],
  [/^\/ (.+) request$/, (m) => `/ ${m[1]} request${m[1] === "1" ? "" : "s"}`],
  [/^(\d[\d.,]*) dari ([\d.,]+)$/, (m) => `${m[1]} of ${m[2]}`],
  [/^Aktif, akun (.+)$/, (m) => `Active, account ${m[1]}`],
  [/^Aktif, guest, akun (.+)$/, (m) => `Active, guest, account ${m[1]}`],
  [/^Terbaca (.+)$/, (m) => `Read ${m[1]}`],
  [/^Sumber: (.+?)\. (\d+) model\.$/, (m) => `Source: ${m[1]}. ${m[2]} models.`],
  [/^Sumber: (.+)$/, (m) => `Source: ${m[1]}`],
  [/^pid (.+), hidup (.+), v(.+)$/, (m) => `pid ${m[1]}, up ${m[2].replace(/(\d)d\b/g, "$1s")}, v${m[3]}`],
  [/^dalam (.+)$/, (m) => `in ${m[1].replace(/(\d)d\b/g, "$1s")}`],
  [/^(.+) poin$/, (m) => `${m[1]} points`],
  [/^\+([\d.,]+) poin$/, (m) => `+${m[1]} points`],
  [/^Menghapus (.+)\.$/, (m) => `Deleting ${m[1]}.`],
  [/^Hapus (.+) dari dashboard\? Token yang tersimpan ikut dihapus\.$/, (m) => `Delete ${m[1]} from the dashboard? The stored token will also be deleted.`],
  [/^(.+) dihapus\. Jalur dimuat ulang karena akun itu sedang aktif\.$/, (m) => `${m[1]} deleted. Lanes reloaded because that account was active.`],
  [/^(.+) dihapus\.$/, (m) => `${m[1]} deleted.`],
  [/^Nama akun diubah menjadi (.+)\.$/, (m) => `Account renamed to ${m[1]}.`],
  [/^Akun disimpan, tetapi gagal dimuat ulang: (.+)\.$/, (m) => `Account saved, but reload failed: ${m[1]}.`],
  [/^Tersimpan, tetapi gagal dimuat ulang: (.+)\.$/, (m) => `Saved, but reload failed: ${m[1]}.`],
  [/^Pilihan dihapus, tetapi gagal dimuat ulang: (.+)\.$/, (m) => `Selection cleared, but reload failed: ${m[1]}.`],
  [/^Gagal memuat status: (.+)$/, (m) => `Failed to load status: ${m[1]}`],
  [/^Gagal memuat akun: (.+)$/, (m) => `Failed to load accounts: ${m[1]}`],
  [/^Gagal mengubah nama: (.+)$/, (m) => `Failed to rename: ${m[1]}`],
  [/^Gagal menghapus akun: (.+)$/, (m) => `Failed to delete account: ${m[1]}`],
  [/^Gagal mengganti akun: (.+)$/, (m) => `Failed to switch account: ${m[1]}`],
  [/^Gagal menyimpan: (.+)$/, (m) => `Failed to save: ${m[1]}`],
  [/^Gagal membaca log: (.+)$/, (m) => `Failed to read log: ${m[1]}`],
  [/^Gagal: (.+)$/, (m) => `Failed: ${m[1]}`],
  [/^Check-in gagal: (.+)$/, (m) => `Check-in failed: ${m[1]}`],
  [/^Backoff upstream aktif, coba lagi dalam (.+)\.$/, (m) => `Upstream backoff active, retry in ${m[1].replace(/(\d)d\b/g, "$1s")}.`],
  [/^Level backoff (\d+)\.$/, (m) => `Backoff level ${m[1]}.`],
  [/^Hapus kunci "(.+)"\? Klien yang memakainya akan langsung ditolak\.$/, (m) => `Delete key "${m[1]}"? Clients using it will be rejected immediately.`],
  [/^Reset pemakaian kunci "(.+)"\?$/, (m) => `Reset usage for key "${m[1]}"?`],
  [/^(.+), tersering (.+)$/, (m) => `${m[1]}, most frequent ${m[2]}`],
  [/^Tidak menjawab di port (.+)\.$/, (m) => `Not responding on port ${m[1]}.`],
  [/^Error: (.+)$/, (m) => `Error: ${m[1]}`],
  [/^(\d[\d.,]*) request$/, (m) => `${m[1]} requests`]
];

function normalizeLanguage(value) {
  return SUPPORTED.has(value) ? value : "id";
}

let language = "id";
try {
  language = normalizeLanguage(localStorage.getItem(STORAGE_KEY));
} catch {
  language = "id";
}

const listeners = new Set();
let observer = null;
let applyTimer = null;
let applying = false;
let titleSource = null;
let titleOutput = null;

export function translateText(value, target = language) {
  const text = String(value ?? "");
  if (target !== "en" || !text) return text;
  const match = text.match(/^(\s*)([\s\S]*?)(\s*)$/);
  if (!match) return text;
  const leading = match[1];
  const core = match[2];
  const trailing = match[3];
  if (!core) return text;
  const exact = EN[core];
  if (exact) return leading + exact + trailing;
  for (const [pattern, replace] of PATTERNS) {
    const match = core.match(pattern);
    if (match) return leading + replace(match) + trailing;
  }
  return text;
}

function shouldSkip(node) {
  const parent = node.parentElement;
  if (!parent) return true;
  if (SKIP_TAGS.has(parent.tagName)) return true;
  if (parent.closest("[data-i18n-ignore]")) return true;
  return false;
}

function applyTextNode(node) {
  if (shouldSkip(node)) return;
  const current = node.nodeValue;
  if (node.__i18nSrc === undefined || current !== node.__i18nOut) {
    node.__i18nSrc = current;
  }
  const next = translateText(node.__i18nSrc);
  if (current !== next) {
    node.__i18nOut = next;
    node.nodeValue = next;
  } else {
    node.__i18nOut = current;
  }
}

function applyAttribute(element, name) {
  if (SKIP_TAGS.has(element.tagName)) return;
  if (element.closest("[data-i18n-ignore]")) return;
  const current = element.getAttribute(name);
  if (current == null) return;
  const sources = element.__i18nAttrSrc || (element.__i18nAttrSrc = {});
  const outputs = element.__i18nAttrOut || (element.__i18nAttrOut = {});
  if (sources[name] === undefined || current !== outputs[name]) {
    sources[name] = current;
  }
  const next = translateText(sources[name]);
  if (current !== next) {
    outputs[name] = next;
    element.setAttribute(name, next);
  } else {
    outputs[name] = current;
  }
}

export function applyLanguage(root = document.body) {
  if (!root) return;
  applying = true;
  if (observer) observer.disconnect();
  try {
    document.documentElement.lang = language;
    if (root === document.body) {
      if (titleSource == null || document.title !== titleOutput) titleSource = document.title;
      titleOutput = translateText(titleSource);
      document.title = titleOutput;
    }
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes = [];
    let node;
    while ((node = walker.nextNode())) nodes.push(node);
    for (const item of nodes) applyTextNode(item);
    const elements = root.querySelectorAll ? [root, ...root.querySelectorAll("*")] : [root];
    for (const element of elements) {
      if (!element.getAttribute) continue;
      for (const name of ATTRIBUTES) applyAttribute(element, name);
    }
  } finally {
    applying = false;
    if (observer) observer.observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ATTRIBUTES
    });
  }
}

function scheduleApply() {
  if (applying || applyTimer) return;
  applyTimer = setTimeout(() => {
    applyTimer = null;
    applyLanguage();
  }, 0);
}

function updateSwitches() {
  for (const button of document.querySelectorAll("[data-lang]")) {
    button.setAttribute("aria-pressed", button.dataset.lang === language ? "true" : "false");
  }
}

export function getLanguage() {
  return language;
}

export function setLanguage(next) {
  const normalized = normalizeLanguage(next);
  if (normalized === language) return false;
  language = normalized;
  try {
    localStorage.setItem(STORAGE_KEY, language);
  } catch {
    /* storage may be unavailable */
  }
  updateSwitches();
  applyLanguage();
  for (const listener of listeners) {
    try { listener(language); } catch { /* ignore subscriber errors */ }
  }
  return true;
}

export function onLanguageChange(listener) {
  if (typeof listener !== "function") return () => {};
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function initI18n() {
  updateSwitches();
  applyLanguage();
  if (!observer) {
    observer = new MutationObserver(scheduleApply);
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ATTRIBUTES
    });
  }
  return language;
}
