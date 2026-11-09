// Insert provider "autoclaw" (Autoclaw) ke opencode.json -> blok "provider" (v1) + "providers" (v2)
const fs = require('fs');
const p = 'C:\\Users\\Zyrex\\.config\\opencode\\opencode.json';
let src = fs.readFileSync(p, 'utf8');
const eol = src.includes('\r\n') ? '\r\n' : '\n';

const preCheck = JSON.parse(src);
const hasV1 = !!(preCheck.provider && preCheck.provider.autoclaw);
const hasV2 = !!(preCheck.providers && preCheck.providers.autoclaw);
console.log('sebelum -> v1:', hasV1, '| v2:', hasV2);

const models = [
  ['zai_auto', 'Auto (AutoClaw)', 131072],
  ['zai_auto-fast', 'Auto Fast (AutoClaw)', 131072],
  ['zaicoding_glm-5.3', 'GLM 5.3 Coding (AutoClaw)', 131072],
  ['zai_glm-5.3-flash', 'GLM 5.3 Flash (AutoClaw)', 131072],
  ['zai_glm-5.3-flashx-legal', 'GLM 5.3 FlashX Legal (AutoClaw)', 307200],
];

function indent(text, n) {
  const pad = ' '.repeat(n);
  return text.split('\n').map(l => (l.length ? pad + l : l)).join(eol);
}

// v1: provider -> npm/options/models{ tool_call, reasoning, limit }
function blockV1(base) {
  const m = models.map(([id, name, out]) =>
    `"${id}": {` +
    `\n  "name": ${JSON.stringify(name)},` +
    `\n  "tool_call": true,` +
    `\n  "reasoning": true,` +
    `\n  "limit": { "context": 1048576, "output": ${out} }` +
    `\n}`).join(',\n');
  const obj =
    `"autoclaw": {\n` +
    `  "name": "AutoClaw Gateway (Autoclaw)",\n` +
    `  "npm": "@ai-sdk/openai-compatible",\n` +
    `  "options": { "apiKey": "akuganteng", "baseURL": "http://127.0.0.1:18791/v1" },\n` +
    `  "models": {\n` + indent(m, 2) + `\n  }\n` +
    `},`;
  return indent(obj, base);
}

// v2: providers -> package/settings/models{ capabilities, limit, reasoning }
function blockV2(base) {
  const m = models.map(([id, name, out]) =>
    `"${id}": {` +
    `\n  "name": ${JSON.stringify(name)},` +
    `\n  "capabilities": { "tools": true, "input": ["text"], "output": ["text"] },` +
    `\n  "limit": { "context": 1048576, "output": ${out} },` +
    `\n  "reasoning": true` +
    `\n}`).join(',\n');
  const obj =
    `"autoclaw": {\n` +
    `  "name": "AutoClaw Gateway (Autoclaw)",\n` +
    `  "package": "@opencode/ai/providers/openai-compatible",\n` +
    `  "settings": { "apiKey": "akuganteng", "baseURL": "http://127.0.0.1:18791/v1" },\n` +
    `  "models": {\n` + indent(m, 2) + `\n  }\n` +
    `},`;
  return indent(obj, base);
}

function insertInto(src, key, makeBlock) {
  // cari `"key": {` di awal baris (bukan substring lain)
  const re = new RegExp('^([ \\t]*)"' + key + '"[ \\t]*:[ \\t]*\\{[ \\t]*$', 'm');
  const m = re.exec(src);
  if (!m) return null;
  const headIndentLen = m[1].length;
  // children indent = indent baris pertama setelah '{'
  const afterBrace = m.index + m[0].length;
  const rest = src.slice(afterBrace);
  const nextLineMatch = /^(\r?\n)([ \t]*)\S/m.exec(rest);
  const childIndent = nextLineMatch ? nextLineMatch[2].length : headIndentLen + 4;
  const block = makeBlock(childIndent);
  return src.slice(0, afterBrace) + eol + block + src.slice(afterBrace);
}

const before = src;
if (!hasV1) {
  const next = insertInto(src, 'provider', blockV1);
  if (!next) throw new Error('gagal insert ke blok "provider" (v1)');
  src = next;
}
if (!hasV2) {
  const next = insertInto(src, 'providers', blockV2);
  if (!next) throw new Error('gagal insert ke blok "providers" (v2)');
  src = next;
}

// validasi JSON
const parsed = JSON.parse(src);
if (!parsed.provider.autoclaw || !parsed.providers.autoclaw) throw new Error('validasi gagal');

fs.writeFileSync(p, src, 'utf8');
console.log('OK inserted. ukuran:', src.length);
console.log('v1 providers:', Object.keys(parsed.provider).join(', '));
console.log('v2 providers:', Object.keys(parsed.providers).join(', '));
console.log('model autoclaw:', Object.keys(parsed.provider.autoclaw.models).join(', '));
