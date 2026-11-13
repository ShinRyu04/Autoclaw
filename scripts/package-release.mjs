import { execFileSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);

function option(name, fallback) {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : fallback;
}

const platform = option("platform");
const arch = option("arch");
const outDir = resolve(root, option("out", "dist"));
const compiled = args.includes("--compiled");

if (!["windows", "linux", "darwin"].includes(platform)) {
  throw new Error("--platform must be windows, linux, or darwin");
}
if (!["x64", "arm64"].includes(arch)) {
  throw new Error("--arch must be x64 or arm64");
}
if (compiled && (platform !== (process.platform === "win32" ? "windows" : process.platform) || arch !== process.arch)) {
  throw new Error(`--compiled builds natively only (host is ${process.platform}-${process.arch})`);
}

const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const version = pkg.version;
const name = `autoclaw-${version}-${platform}-${arch}`;
const stageRoot = join(outDir, ".stage");
const stage = join(stageRoot, name);
const buildDir = join(outDir, ".build");
const extension = platform === "windows" ? "zip" : "tar.gz";
const archive = join(outDir, `${name}.${extension}`);
const exeSuffix = platform === "windows" ? ".exe" : "";

rmSync(stage, { recursive: true, force: true });
rmSync(buildDir, { recursive: true, force: true });
rmSync(archive, { force: true });
mkdirSync(stage, { recursive: true });

const tracked = execFileSync("git", ["ls-files", "-z"], { cwd: root })
  .toString("utf8")
  .split("\0")
  .filter(Boolean);

// The compiled bundle ships binaries plus the assets they read at runtime.
// The source bundle ships everything tracked (minus build/CI files).
const COMPILED_ASSETS = /^(?:package\.json|config\.example\.json|lib\/fallback-models\.json|README\.md|LICENSE|dashboard\/public\/)/;

for (const file of tracked) {
  if (/^(?:\.github\/|\.gitignore$|dist\/|scripts\/)/.test(file)) continue;
  if (/\.bak-/.test(file)) continue;
  if (compiled && !COMPILED_ASSETS.test(file)) continue;
  const destination = join(stage, file);
  mkdirSync(dirname(destination), { recursive: true });
  copyFileSync(join(root, file), destination);
}

function node(args) {
  execFileSync(process.execPath, args, { stdio: "inherit", cwd: root });
}

const SEA_FUSE = "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2";

async function buildSeaBinary(role, entryFile) {
  const { build } = await import("esbuild");
  const entry = join(buildDir, `entry-${role}.js`);
  writeFileSync(entry, `import "./compiled-env.js";\nimport ${JSON.stringify(entryFile)};\n`);

  const bundle = join(buildDir, `${role}.cjs`);
  await build({
    entryPoints: [entry],
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node22",
    logLevel: "warning",
    define: { "import.meta.url": '"file:///"' },
    outfile: bundle,
  });

  const seaConfig = join(buildDir, `sea-${role}.json`);
  const blob = join(buildDir, `${role}.blob`);
  writeFileSync(seaConfig, JSON.stringify({
    main: bundle,
    output: blob,
    disableExperimentalSEAWarning: true,
    useSnapshot: false,
    useCodeCache: false,
  }, null, 2));
  node(["--experimental-sea-config", seaConfig]);

  const binary = join(stage, `autoclaw-${role}${exeSuffix}`);
  copyFileSync(process.execPath, binary);
  if (platform !== "windows") chmodSync(binary, 0o755);

  if (platform === "darwin") {
    // A signed Mach-O cannot take the injected blob; strip, inject, re-sign
    // ad hoc so arm64 macOS still executes it.
    try { execFileSync("codesign", ["--remove-signature", binary], { stdio: "inherit" }); } catch { /* unsigned already */ }
  }

  const inject = [join(root, "node_modules", "postject", "dist", "cli.js"), binary, "NODE_SEA_BLOB", blob, "--sentinel-fuse", SEA_FUSE];
  if (platform === "darwin") inject.push("--macho-segment-name", "NODE_SEA");
  node(inject);

  if (platform === "darwin") {
    execFileSync("codesign", ["--sign", "-", binary], { stdio: "inherit" });
  }
  return binary;
}

if (compiled) {
  mkdirSync(buildDir, { recursive: true });
  writeFileSync(
    join(buildDir, "compiled-env.js"),
    `import path from "node:path";

// A SEA binary cannot resolve paths relative to its own module URL, so the
// runtime home is the directory holding the executable unless the operator
// overrides it. config.json, keys.json, proxy-state/ and dashboard/public all
// live there, next to the binaries.
if (!process.env.GLMP_HOME) process.env.GLMP_HOME = path.dirname(process.execPath);
if (!process.env.GLMP_CONFIG_PATH) process.env.GLMP_CONFIG_PATH = path.join(process.env.GLMP_HOME, "config.json");
if (!process.env.GLMP_KEYS_FILE) process.env.GLMP_KEYS_FILE = path.join(process.env.GLMP_HOME, "keys.json");
`,
  );

  await buildSeaBinary("openai", "../../openai.js");
  await buildSeaBinary("anthropic", "../../anthropic.js");
  await buildSeaBinary("dashboard", "../../dashboard/server.js");

  if (platform === "windows") {
    writeFileSync(
      join(stage, "start-autoclaw.cmd"),
      [
        "@echo off",
        "setlocal",
        'set "AUTOCLAW_HOME=%~dp0"',
        'if not defined PROXY_KEY set "PROXY_KEY=akuganteng"',
        'set "GLMP_HOME=%AUTOCLAW_HOME%"',
        'set "GLMP_CONFIG_PATH=%AUTOCLAW_HOME%config.json"',
        'set "GLMP_KEYS_FILE=%AUTOCLAW_HOME%keys.json"',
        'if not exist "%AUTOCLAW_HOME%logs" mkdir "%AUTOCLAW_HOME%logs"',
        'powershell -NoProfile -WindowStyle Hidden -Command "Start-Process -WindowStyle Hidden -FilePath \\"%AUTOCLAW_HOME%autoclaw-openai.exe\\" -WorkingDirectory \\"%AUTOCLAW_HOME%\\" -RedirectStandardOutput \\"%AUTOCLAW_HOME%logs\\openai.out.log\\" -RedirectStandardError \\"%AUTOCLAW_HOME%logs\\openai.err.log\\""',
        'powershell -NoProfile -WindowStyle Hidden -Command "Start-Process -WindowStyle Hidden -FilePath \\"%AUTOCLAW_HOME%autoclaw-anthropic.exe\\" -WorkingDirectory \\"%AUTOCLAW_HOME%\\" -RedirectStandardOutput \\"%AUTOCLAW_HOME%logs\\anthropic.out.log\\" -RedirectStandardError \\"%AUTOCLAW_HOME%logs\\anthropic.err.log\\""',
        'powershell -NoProfile -WindowStyle Hidden -Command "Start-Process -WindowStyle Hidden -FilePath \\"%AUTOCLAW_HOME%autoclaw-dashboard.exe\\" -WorkingDirectory \\"%AUTOCLAW_HOME%\\" -RedirectStandardOutput \\"%AUTOCLAW_HOME%logs\\dashboard.out.log\\" -RedirectStandardError \\"%AUTOCLAW_HOME%logs\\dashboard.err.log\\""',
        "echo OpenAI     http://127.0.0.1:18791/v1",
        "echo Anthropic  http://127.0.0.1:18792",
        "echo Dashboard  http://127.0.0.1:18793",
        "",
      ].join("\r\n"),
    );
    writeFileSync(
      join(stage, "stop-autoclaw.cmd"),
      [
        "@echo off",
        'taskkill /F /IM autoclaw-openai.exe 2>nul',
        'taskkill /F /IM autoclaw-anthropic.exe 2>nul',
        'taskkill /F /IM autoclaw-dashboard.exe 2>nul',
        "echo stopped",
        "",
      ].join("\r\n"),
    );
  } else {
    const start = join(stage, "start-autoclaw.sh");
    writeFileSync(
      start,
      `#!/bin/sh
set -eu
DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
export GLMP_HOME="$DIR"
export GLMP_CONFIG_PATH="$DIR/config.json"
export GLMP_KEYS_FILE="$DIR/keys.json"
export PROXY_KEY="\${PROXY_KEY:-akuganteng}"
mkdir -p "$DIR/logs"
cd "$DIR"

start() {
  name=$1
  shift
  if [ -f "$DIR/logs/$name.pid" ]; then
    pid=$(cat "$DIR/logs/$name.pid")
    if kill -0 "$pid" 2>/dev/null; then
      echo "$name already running (pid $pid)"
      return 0
    fi
  fi
  nohup "$DIR/autoclaw-$name" "$@" >>"$DIR/logs/$name.log" 2>&1 &
  echo $! >"$DIR/logs/$name.pid"
  echo "$name started (pid $!)"
}

start openai
start anthropic
start dashboard
echo "Dashboard: http://127.0.0.1:18793"
`,
    );
    chmodSync(start, 0o755);

    const stop = join(stage, "stop-autoclaw.sh");
    writeFileSync(
      stop,
      `#!/bin/sh
set -eu
DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
for name in openai anthropic dashboard; do
  pidfile="$DIR/logs/$name.pid"
  if [ -f "$pidfile" ]; then
    pid=$(cat "$pidfile")
    kill "$pid" 2>/dev/null || true
    rm -f "$pidfile"
    echo "$name stopped"
  fi
done
`,
    );
    chmodSync(stop, 0o755);
  }
} else {
  const runtime = join(stage, "runtime");
  mkdirSync(runtime, { recursive: true });
  const nodeName = platform === "windows" ? "node.exe" : "node";
  const nodeBinary = join(runtime, nodeName);
  copyFileSync(process.execPath, nodeBinary);
  if (platform !== "windows") chmodSync(nodeBinary, 0o755);

  if (platform === "windows") {
    writeFileSync(
      join(stage, "start-autoclaw.cmd"),
      [
        "@echo off",
        "setlocal",
        'set "AUTOCLAW_HOME=%~dp0"',
        'set "PATH=%AUTOCLAW_HOME%runtime;%PATH%"',
        'if not defined PROXY_KEY set "PROXY_KEY=akuganteng"',
        'powershell -NoProfile -ExecutionPolicy Bypass -File "%AUTOCLAW_HOME%watchdog.ps1"',
        "",
      ].join("\r\n"),
    );
  } else {
    const start = join(stage, "start-autoclaw.sh");
    writeFileSync(
      start,
      `#!/bin/sh
set -eu
DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
export PATH="$DIR/runtime:$PATH"
export GLMP_CONFIG_PATH="$DIR/config.json"
export GLMP_KEYS_FILE="$DIR/keys.json"
export GLMP_IDENTITY_VERSION="2.0.3"
export PROXY_KEY="\${PROXY_KEY:-akuganteng}"
mkdir -p "$DIR/logs"
cd "$DIR"

start() {
  name=$1
  shift
  if [ -f "$DIR/logs/$name.pid" ]; then
    pid=$(cat "$DIR/logs/$name.pid")
    if kill -0 "$pid" 2>/dev/null; then
      echo "$name already running (pid $pid)"
      return 0
    fi
  fi
  nohup "$DIR/runtime/node" "$@" >>"$DIR/logs/$name.log" 2>&1 &
  echo $! >"$DIR/logs/$name.pid"
  echo "$name started (pid $!)"
}

start openai "$DIR/bin/cli.js" --openai --port 18791
start anthropic "$DIR/bin/cli.js" --anthropic --port 18792
start dashboard "$DIR/dashboard/server.js"
echo "Dashboard: http://127.0.0.1:18793"
`,
    );
    chmodSync(start, 0o755);

    const stop = join(stage, "stop-autoclaw.sh");
    writeFileSync(
      stop,
      `#!/bin/sh
set -eu
DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
for name in openai anthropic dashboard; do
  pidfile="$DIR/logs/$name.pid"
  if [ -f "$pidfile" ]; then
    pid=$(cat "$pidfile")
    kill "$pid" 2>/dev/null || true
    rm -f "$pidfile"
    echo "$name stopped"
  fi
done
`,
    );
    chmodSync(stop, 0o755);
  }
}

const layout = compiled
  ? `This archive ships compiled executables (Node.js SEA) for ${platform}-${arch};
there is no JavaScript runtime or source tree to unpack.

## Windows

Run \`start-autoclaw.cmd\`. It starts \`autoclaw-openai.exe\`,
\`autoclaw-anthropic.exe\` and \`autoclaw-dashboard.exe\` hidden and writes their
output to \`logs\\\`. Stop them with \`stop-autoclaw.cmd\`.

## Linux and macOS

\`\`\`sh
chmod +x start-autoclaw.sh stop-autoclaw.sh autoclaw-openai autoclaw-anthropic autoclaw-dashboard
./start-autoclaw.sh
\`\`\`
`
  : `This archive contains the Autoclaw source and a bundled Node.js runtime
(${process.version}) for ${platform}-${arch}.

## Windows

Run \`start-autoclaw.cmd\`. It adds \`runtime\\\` to PATH and starts
\`watchdog.ps1\`. Set \`AUTOCLAW_EXE\` if the AutoClaw desktop app is not at the
default path.

## Linux and macOS

\`\`\`sh
chmod +x start-autoclaw.sh stop-autoclaw.sh
./start-autoclaw.sh
\`\`\`
`;

writeFileSync(
  join(stage, "PORTABLE.md"),
  `# Autoclaw ${version} portable bundle

${layout}
The dashboard opens at http://127.0.0.1:18793. The lanes use ports 18791
(OpenAI) and 18792 (Anthropic). Stop them with \`./stop-autoclaw.sh\` (or
\`stop-autoclaw.cmd\`).

AutoClaw vault accounts need the AutoClaw desktop app installed for the current
OS user. Dashboard OAuth accounts do not need the desktop app.

Runtime files such as \`config.json\`, \`keys.json\`, \`proxy-state/\`, and
\`logs/\` are created next to the launcher and are not part of the archive.
`,
);

mkdirSync(outDir, { recursive: true });
if (platform === "windows") {
  execFileSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-Command",
      `Compress-Archive -LiteralPath '${stage.replaceAll("'", "''")}' -DestinationPath '${archive.replaceAll("'", "''")}' -Force`,
    ],
    { stdio: "inherit" },
  );
} else {
  execFileSync("tar", ["-czf", archive, "-C", stageRoot, name], {
    stdio: "inherit",
  });
}

rmSync(stageRoot, { recursive: true, force: true });
rmSync(buildDir, { recursive: true, force: true });
console.log(archive);
