(() => {
  const statusEl = document.getElementById("status");
  const button = document.getElementById("captcha-btn");
  const zone = document.getElementById("captcha-zone");

  function setStatus(text, state) {
    statusEl.textContent = text;
    if (state) statusEl.dataset.state = state;
    else delete statusEl.dataset.state;
  }

  async function readJson(res) {
    try { return await res.json(); }
    catch { return {}; }
  }

  async function startOAuth(verifyParam) {
    const res = await fetch("/api/oauth/zai/start", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Dashboard": "1" },
      body: JSON.stringify({ verifyParam }),
    });
    const data = await readJson(res);
    if (!res.ok || !data.url) throw new Error(data.error || `HTTP ${res.status}`);
    return data.url;
  }

  function beginOAuth(verifyParam) {
    setStatus("Verifikasi diterima. Menyiapkan halaman login Z.ai.", "ok");
    button.disabled = true;
    button.textContent = "Membuka Z.ai...";
    startOAuth(verifyParam)
      .then((url) => {
        setStatus("Membuka halaman login Z.ai. Selesaikan login di sana.", "ok");
        window.location.assign(url);
      })
      .catch((err) => {
        setStatus(`Gagal memulai OAuth: ${err.message}`, "err");
        button.disabled = false;
        button.textContent = "Ulangi verifikasi";
      });
  }

  function initCaptcha(config) {
    if (typeof window.initAliyunCaptcha !== "function") {
      setStatus("SDK captcha belum siap. Memuat ulang...", "err");
      window.setTimeout(() => initCaptcha(config), 500);
      return;
    }
    button.disabled = false;
    button.textContent = "Mulai verifikasi";
    setStatus("Klik tombol untuk membuka verifikasi captcha.");
    window.initAliyunCaptcha({
      SceneId: config.sceneId,
      mode: "popup",
      element: "#captcha-zone",
      button: "#captcha-btn",
      captchaVerifyCallback(captchaVerifyParam) {
        beginOAuth(captchaVerifyParam);
        return { captchaResult: true, bizResult: true };
      },
      onBizResultCallback() {},
      slideStyle: { width: 320, height: 40 },
      language: "en",
      onError(error) {
        setStatus(`Captcha gagal: ${error?.message || "coba lagi"}`, "err");
        button.disabled = false;
        button.textContent = "Ulangi verifikasi";
      },
    });
  }

  function loadSdk(config) {
    window.AliyunCaptchaConfig = { region: config.region, prefix: config.prefix };
    const script = document.createElement("script");
    script.src = "https://o.alicdn.com/captcha-frontend/aliyunCaptcha/AliyunCaptcha.js";
    script.onload = () => initCaptcha(config);
    script.onerror = () => setStatus("Gagal memuat SDK captcha. Periksa koneksi lalu muat ulang tab ini.", "err");
    document.head.append(script);
  }

  async function main() {
    try {
      const res = await fetch("/api/oauth/zai/config");
      const config = await readJson(res);
      if (!res.ok) throw new Error(config.error || `HTTP ${res.status}`);
      if (!config.enabled) {
        setStatus("Captcha tidak aktif di upstream. Tekan tombol untuk lanjut.", "err");
        button.disabled = false;
        button.textContent = "Lanjut ke Z.ai";
        button.addEventListener("click", () => beginOAuth(""), { once: true });
        return;
      }
      if (!config.sceneId || !config.prefix) throw new Error("Konfigurasi captcha tidak lengkap");
      loadSdk(config);
    } catch (err) {
      setStatus(`Gagal membaca konfigurasi: ${err.message}`, "err");
      zone.hidden = true;
    }
  }

  main();
})();
