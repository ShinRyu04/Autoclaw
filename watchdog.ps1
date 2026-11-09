# Autoclaw + AutoClaw watchdog
# Dipanggil Scheduled Task "Autoclaw-Watchdog" tiap 2 menit (hidden, tanpa jendela).
# Tugasnya: pastikan AutoClaw hidup (kalau backend autoclaw), lalu pastikan
# port 18791 (OpenAI), 18792 (Anthropic), dan 18793 (dashboard) hidup.
# Tidak dobel: port dicek dulu sebelum proses baru dibuat.

$ErrorActionPreference = 'SilentlyContinue'

$base      = 'D:\ToolsAI\glmproxy'
$cli       = Join-Path $base 'vendor\glmproxy\bin\cli.js'
$dashboard = Join-Path $base 'dashboard\server.js'
$autoClaw  = 'D:\Desktop\AutoClaw2\AutoClaw2.exe'
$log       = Join-Path $base 'logs\watchdog.log'

# A stale shell variable must never redirect this copy to another install.
$env:GLMP_CONFIG_PATH = Join-Path $base 'config.json'
$env:GLMP_KEYS_FILE   = Join-Path $base 'keys.json'
if ($env:GLMP_HOME -and -not ($env:GLMP_HOME.TrimEnd('\') -ieq $base)) {
    Remove-Item Env:GLMP_HOME -ErrorAction SilentlyContinue
}

function Write-Log($msg) {
    $line = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')  $msg"
    Add-Content -Path $log -Value $line -Encoding utf8
}

# --- jangan jalan dobel ---
$mutex = New-Object System.Threading.Mutex($false, 'Global\AutoclawWatchdog')
if (-not $mutex.WaitOne(0)) { exit 0 }

try {
    if (-not (Test-Path (Join-Path $base 'logs'))) {
        New-Item -ItemType Directory -Force -Path (Join-Path $base 'logs') | Out-Null
    }

    # Nilai yang dipakai semua proses anak; dashboard memakai PROXY_KEY untuk /status.
    # Tunable (budget, gap, timeout, retry) sengaja TIDAK diset di sini supaya
    # config.json / dashboard benar-benar berlaku. Default core: 300 req/jam,
    # gap 250 ms; config.json di repo ini menaikkan timeout ke 300 detik.
    $env:GLMP_IDENTITY_VERSION = '2.0.3'
    $env:PROXY_KEY             = 'akuganteng'

    # Backend efektif: env > config.json > ZAI_API_KEY > autoclaw.
    $backend = $env:GLMP_BACKEND
    if (-not $backend) {
        $cfgPath = Join-Path $base 'config.json'
        if (Test-Path $cfgPath) {
            try {
                $cfg = Get-Content -Raw -Path $cfgPath | ConvertFrom-Json
                if ($cfg.GLMP_BACKEND) { $backend = [string]$cfg.GLMP_BACKEND }
            } catch { }
        }
    }
    if (-not $backend) {
        if ($env:ZAI_API_KEY) { $backend = 'zai' } else { $backend = 'autoclaw' }
    }

    # --- 1. AutoClaw hanya perlu hidup saat token berasal dari vault AutoClaw.
    # Akun dashboard punya token sendiri dan tidak butuh aplikasi AutoClaw.
    $activeManaged = ''
    try {
        $storeUrl = 'file:///' + ($base -replace '\\', '/') + '/vendor/glmproxy/lib/account-store.js'
        $env:GLMP_STORE_MODULE = $storeUrl
        $activeManaged = (& node --input-type=module -e "import(process.env.GLMP_STORE_MODULE).then(m=>process.stdout.write(m.getActiveManagedId()||String()))" 2>$null)
        Remove-Item Env:GLMP_STORE_MODULE -ErrorAction SilentlyContinue
    } catch { $activeManaged = '' }

    if ($backend -ne 'zai' -and -not $activeManaged) {
        if (-not (Get-Process -Name 'AutoClaw2' -ErrorAction SilentlyContinue)) {
            if (Test-Path $autoClaw) {
                Start-Process -FilePath $autoClaw -WindowStyle Minimized
                Write-Log 'AutoClaw: MATI -> dinyalakan'
                Start-Sleep -Seconds 20   # beri waktu baca vault
            } else {
                Write-Log "AutoClaw: exe tidak ditemukan ($autoClaw)"
            }
        }
    }

    # --- 2. Proses: cek port, nyalakan yang mati saja ---
    $targets = @(
        @{ Port = 18791; Line = "node `"$cli`" --openai --port 18791 --key akuganteng"; File = 'openai.log' },
        @{ Port = 18792; Line = "node `"$cli`" --anthropic --port 18792 --key akuganteng"; File = 'anthropic.log' },
        @{ Port = 18793; Line = "node `"$dashboard`""; File = 'dashboard.log' }
    )

    foreach ($t in $targets) {
        $listen = Get-NetTCPConnection -LocalPort $t.Port -State Listen -ErrorAction SilentlyContinue
        if ($listen) { continue }

        $args = "/c $($t.Line) >> `"$base\logs\$($t.File)`" 2>&1"
        Start-Process -FilePath 'cmd.exe' -ArgumentList $args -WindowStyle Hidden
        Write-Log "Autoclaw: port $($t.Port) MATI -> dinyalakan"
    }
}
finally {
    $mutex.ReleaseMutex()
    $mutex.Dispose()
}
