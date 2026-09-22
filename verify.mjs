// verify.mjs — dsh-pulse 自证：语法 + 抽取 formatter 做行为断言 + 注册面静态核对
// 用法：node verify.mjs     （与 cwd 无关）
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const BASE = dirname(fileURLToPath(import.meta.url));
const CLIENT = join(BASE, "client.js");
const INDEX = join(BASE, "index.js");
const src = readFileSync(CLIENT, "utf8");

let fail = 0;
const ok = (cond, msg) => {
  console.log((cond ? "  PASS  " : "  FAIL  ") + msg);
  if (!cond) fail++;
};

console.log("=== 1. 语法检查 ===");
for (const f of [INDEX, CLIENT]) {
  try {
    execFileSync(process.execPath, ["--check", f], { stdio: "pipe" });
    ok(true, "node --check " + f.split(/[\\/]/).pop());
  } catch (e) {
    ok(false, "node --check " + f + " → " + String(e.stderr || e.message).slice(0, 240));
  }
}

console.log("=== 2. 抽取 formatter 做行为断言（两位小数） ===");
const start = src.indexOf("// #region formatter");
const end = src.indexOf("// #endregion", start);
if (start < 0 || end < 0) {
  ok(false, "找不到 // #region formatter 标记块");
} else {
  const region = src.slice(start, end);
  const box = new Function(region + "\nreturn { formatCacheHitPercent };")();
  const f = box.formatCacheHitPercent;
  const cases = [
    [10000, 10000, 2, "100", "全命中 = 100（语义不变）"],
    [8743, 10000, 2, "87.43", "两位小数"],
    [9999, 10000, 2, "99.99", "两位上界"],
    [8740, 10000, 2, "87.40", "末位 0 补齐两位"],
    [8705, 10000, 2, "87.05", "前导 0 补齐两位"],
    [8700, 10000, 2, "87", "整值不带小数点"],
    [0, 10000, 2, "0", "零命中"],
    [8743, 10000, 1, "87.4", "1 位调用者行为不变"],
    [8743, 10000, 0, "87", "0 位调用者行为不变"],
    [1, 0, 2, null, "无计费输入 → null"]
  ];
  for (const [cr, pt, dp, want, note] of cases) {
    const got = f(cr, pt, dp);
    ok(got === want, `${note}  f(${cr}, ${pt}, ${dp}) = ${JSON.stringify(got)}（期望 ${JSON.stringify(want)}）`);
  }
  for (const [cr, pt] of [[99999, 100000], [999996, 1000000]]) {
    const got = f(cr, pt, 2);
    ok(got !== "100" && got !== "100.00", `部分命中不伪装 100：f(${cr}, ${pt}, 2) = ${JSON.stringify(got)}`);
  }
}

console.log("=== 3. 注册面静态核对 ===");
ok(/"conversation\.composer\.dock"/.test(src), "注册目标 = conversation.composer.dock");
ok(/id: "pulse"/.test(src), 'entry id = "pulse"（不与内置 "stats" 撞 id）');
ok(/order: 1/.test(src), "order = 1（紧随内置 order 0）");
ok(/locale: NS/.test(src), "声明 locale 席位 → 组件拿到 t");
ok(/window\.__ModuleLoader__\.load\(\{\s*\n\s*id: "dsh-pulse"/.test(src), "ModuleLoader id = dsh-pulse");
ok(/require\("react"\)/.test(src), 'require("react")');
ok(/exports\.inject = inject/.test(src) && /exports\.apply = apply/.test(src), "导出 inject / apply");
ok(!/document\.|window\.document|querySelector|getElementById/.test(src), "不碰 DOM / 不引用产品选择器");
ok(!/ctx\.remote|host\.call|harness\./.test(src), "不走宿主 RPC（纯读投影）");

console.log("");
console.log(fail === 0 ? "VERIFY-OK（全部断言通过）" : `VERIFY-FAILED（${fail} 项不通过）`);
process.exit(fail === 0 ? 0 : 1);
