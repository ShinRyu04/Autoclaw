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

if (!["windows", "linux", "darwin"].includes(platform)) {
  throw new Error("--platform must be windows, linux, or darwin");
}
if (!["x64", "arm64"].includes(arch)) {
  throw new Error("--arch must be x64 or arm64");
}

const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const version = pkg.version;
const name = `autoclaw-${version}-${platform}-${arch}`;
const stageRoot = join(outDir, ".stage");
const stage = join(stageRoot, name);
const extension = platform === "windows" ? "zip" : "tar.gz";
const archive = join(outDir, `${name}.${extension}`);

rmSync(stage, { recursive: true, force: true });
rmSync(archive, { force: true });
mkdirSync(stage, { recursive: true });

const tracked = execFileSync("git", ["ls-files", "-z"], { cwd: root })
  .toString("utf8")
  .split("\0")
  .filter(Boolean);

for (const file of tracked) {
  if (/^(?:\.github\/|\.gitignore$|dist\/|scripts\/)/.test(file)) continue;
  if (/\.bak-/.test(file)) continue;
  const destination = join(stage, file);
  mkdirSync(dirname(destination), { recursive: true });
  copyFileSync(join(root, file), destination);
}

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

writeFileSync(
  join(stage, "PORTABLE.md"),
  `# Autoclaw ${version} portable bundle

This archive contains the Autoclaw source and a bundled Node.js runtime
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

The dashboard opens at http://127.0.0.1:18793. The lanes use ports 18791
(OpenAI) and 18792 (Anthropic). Stop them with \`./stop-autoclaw.sh\`.

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
console.log(archive);
