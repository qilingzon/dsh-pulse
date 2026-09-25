#!/usr/bin/env node
/**
 * profile-edit.cjs — 用 JSON 语义增删 profile package.json 里的插件注册项。
 *
 * 为什么需要它：安装器原先用文本替换
 *     $c.Replace('"dsh-pulse": "file:../../plugins/dsh-pulse",', '').Replace(', "dsh-pulse"', '').Replace('"dsh-pulse"', '')
 * 在 2026-09-22 的安装闭环实测里直接产出**非法 JSON**：
 *     "bundles": [..., "dsh-cachehit-2dp",, "dsh-pulse"]     ← 双逗号
 * 原因是文件里是 `,"dsh-pulse"`（逗号后无空格），`.Replace(', "dsh-pulse"', '')` 匹配不到，
 * 兜底的 `.Replace('"dsh-pulse"', '')` 只删了带引号的字符串，逗号全留下了。
 * 然后 `pnpm install` 报 `Unexpected token "," ... is not valid JSON` 并退出码 1。
 *
 * 文本替换删不掉「逗号该不该留」，所以这里改用 JSON 语义：解析 → 增删 → 序列化。
 * 代价是 profile package.json 会被重新格式化为 2 空格缩进 —— 这是**有意取舍**：
 * 正确的 JSON 比逐字节保真重要（逐字节保真会让用户拿到一个坏掉的 profile）。
 *
 * 用法：
 *   node profile-edit.cjs add    <profilePackageJson> <id> <spec>
 *   node profile-edit.cjs remove <profilePackageJson> <id>
 *
 * 退出码：0 = 成功（含「本来就没有」）；1 = 参数 / 解析 / 写入失败。
 * 输出：一行 `OK ...` 或 `NOOP ...`，失败走 stderr + 非零退出码。
 */
// 2026-09-25 修（真实缺陷）：本文件扩展名是 .cjs，Node 无条件按 CommonJS 加载，
// 而这里原先写的是 ESM 的 `import { ... } from "node:fs"` →
//   SyntaxError: Cannot use import statement outside a module
// 即 install.ps1 / install.sh 的每一次 JSON 语义编辑都必然失败（退出码 1）。
// 改回 CommonJS 的 require：扩展名、文件名、所有调用点都不动。
const { readFileSync, writeFileSync } = require("node:fs");

const [action, file, id, spec] = process.argv.slice(2);

function die(message) {
  process.stderr.write(`[FAIL] ${message}\n`);
  process.exit(1);
}

if (action !== "add" && action !== "remove") die(`未知动作 "${action}"（期望 add | remove）`);
if (!file) die("缺少 <profilePackageJson>");
if (!id) die("缺少 <id>");

let json;
let original;
try {
  original = readFileSync(file, "utf8");
  json = JSON.parse(original);
} catch (e) {
  die(`读 / 解析 ${file} 失败：${e.message}`);
}
if (json === null || typeof json !== "object" || Array.isArray(json)) die(`${file} 顶层不是对象`);

const before = JSON.stringify(json);

if (action === "add") {
  if (!spec) die("add 需要 <spec>（例如 file:../../plugins/dsh-pulse）");
  if (json.dependencies === undefined) json.dependencies = {};
  if (json.dependencies === null || typeof json.dependencies !== "object" || Array.isArray(json.dependencies)) {
    die(`${file} 的 dependencies 不是对象`);
  }
  json.dependencies[id] = spec;

  if (json.dsh === undefined) json.dsh = {};
  if (json.dsh === null || typeof json.dsh !== "object" || Array.isArray(json.dsh)) die(`${file} 的 dsh 不是对象`);
  if (json.dsh.profile === undefined) json.dsh.profile = {};
  if (json.dsh.profile === null || typeof json.dsh.profile !== "object" || Array.isArray(json.dsh.profile)) {
    die(`${file} 的 dsh.profile 不是对象`);
  }
  if (json.dsh.profile.bundles === undefined) json.dsh.profile.bundles = [];
  if (!Array.isArray(json.dsh.profile.bundles)) die(`${file} 的 dsh.profile.bundles 不是数组`);
  if (!json.dsh.profile.bundles.includes(id)) json.dsh.profile.bundles.push(id);
} else {
  if (json.dependencies !== null && typeof json.dependencies === "object" && !Array.isArray(json.dependencies)) {
    delete json.dependencies[id];
  }
  const bundles = json.dsh && json.dsh.profile ? json.dsh.profile.bundles : undefined;
  if (Array.isArray(bundles)) {
    json.dsh.profile.bundles = bundles.filter((entry) => entry !== id);
  }
}

const after = JSON.stringify(json);
if (after === before) {
  process.stdout.write(`NOOP ${id} 本来就不在 ${file}\n`);
  process.exit(0);
}

const serialized = JSON.stringify(json, null, 2) + "\n";
try {
  // 写回前自检：序列化结果必须还能解析回同一个对象（防手滑写出坏 JSON）
  const roundTrip = JSON.parse(serialized);
  if (JSON.stringify(roundTrip) !== after) die("序列化自检失败：写回内容与内存对象不一致");
  writeFileSync(file, serialized, "utf8");
} catch (e) {
  die(`写 ${file} 失败：${e.message}`);
}

const bundlesLen = json.dsh && json.dsh.profile && Array.isArray(json.dsh.profile.bundles)
  ? json.dsh.profile.bundles.length
  : -1;
process.stdout.write(`OK ${action} ${id} → bundles=${bundlesLen} dep=${(json.dependencies || {})[id] || "ABSENT"}\n`);