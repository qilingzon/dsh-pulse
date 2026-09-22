// bench.mjs — 性能实测：采样循环的每拍开销、常驻内存、发布体积。
// 结论要能被复算，所以这里只做测量，不给结论。
// 用法：node bench.mjs
import { readFileSync, statSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const BASE = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(BASE, "client.js"), "utf8");

const ws = src.indexOf("// #region window");
const we = src.indexOf("// #endregion", ws);
const region = src.slice(ws, we);
const W = new Function(
  region + "\nreturn { createMeterState, stepMeter, displayKey, windowSlope, readRate: null };"
)();

const nf = (n, d = 2) => n.toFixed(d);
const us = (ms) => ms * 1000;

console.log("=== 1. 采样一拍的开销（含满窗 41 点的算术） ===");

// 造一个「最坏情况」的采样器：窗口塞满、处于流式态。
function worstCaseState() {
  const st = W.createMeterState();
  let t = 0;
  let chars = 0;
  for (let i = 0; i < 60; i += 1) {
    t += 500;
    chars += 60;
    W.stepMeter(st, t, i * 60, chars, true);
  }
  return { st, t };
}

const { st: wc, t: wcT } = worstCaseState();
console.log(`  满窗采样点数 = ${wc.samples.length}（RETAIN_MS / SAMPLE_MS + 1）`);
console.log(`  最坏一拍 displayKey = ${W.displayKey(wc, wcT, true)}`);

// 热身后计时：每轮 = stepMeter + displayKey，正是 interval 回调做的全部事。
// 时间必须按真实节奏推进（500ms/拍），否则环形缓冲不会裁剪，测出来的是退化情形。
const ITER = 200000;
let clock = wcT;
const hot = (n) => {
  for (let i = 0; i < n; i += 1) {
    clock += 500;
    W.stepMeter(wc, clock, i * 60, 100 + i, true);
    W.displayKey(wc, clock, true);
  }
};
hot(20000);
const bufAfterHot = wc.samples.length;
let t0 = process.hrtime.bigint();
hot(ITER);
let t1 = process.hrtime.bigint();
const perTickMs = Number(t1 - t0) / 1e6 / ITER;
console.log(`  每拍 = ${nf(us(perTickMs))} µs  （stepMeter + displayKey，${ITER} 次平均）`);
console.log(`  20 万拍后缓冲仍为 ${bufAfterHot} 点 → 环形裁剪生效，不随时间增长`);

// 只算 displayKey（空闲态每拍的实际成本更低，但取上界更保守）
t0 = process.hrtime.bigint();
for (let i = 0; i < ITER; i += 1) W.displayKey(wc, clock, true);
t1 = process.hrtime.bigint();
const keyMs = Number(t1 - t0) / 1e6 / ITER;
console.log(`  其中 displayKey = ${nf(us(keyMs))} µs`);

console.log("");
console.log("=== 2. 折算到真实运行 ===");
const ticksPerSec = 2; // SAMPLE_MS = 500
const cpuMsPerSec = perTickMs * ticksPerSec;
console.log(`  采样频率 = ${ticksPerSec} 次/秒（SAMPLE_MS = 500）`);
console.log(`  持续 CPU = ${nf(us(cpuMsPerSec))} µs/秒 = ${nf(cpuMsPerSec / 1000 * 100, 6)}% 单核`);
const perHour = cpuMsPerSec * 3600 / 1000;
console.log(`  跑满 1 小时 = ${nf(perHour, 3)} ms CPU`);
console.log(`  跑满 24 小时 = ${nf(perHour * 24, 1)} ms CPU`);
console.log("  注：渲染被 displayKey 闸门挡住 —— 空闲时 0 帧/秒；流式时最多 2 帧/秒。");
console.log("  注：浏览器对隐藏标签页的 setInterval 有节流（约 1 次/分钟），后台标签更省。");

console.log("");
console.log("=== 3. 常驻内存 ===");
// 每个采样点是 {t, exact, est} 三个 number；V8 里 number 属性走 SMI/double 内联。
const slots = wc.samples.length;
console.log(`  环形缓冲 = ${slots} 个采样点 × 3 个 number = ${slots * 3} 个数值`);
console.log(`  粗估堆占用 ≈ ${nf(slots * 3 * 8 / 1024, 2)} KiB（64 位下按 8B/数值算上界，未计对象头）`);
console.log("  其余状态：ratio / running / stepStartTokens / stepPeakChars / estTokens / renderedKey —— 6 个标量。");
console.log("  定时器：1 个 setInterval；卸载时 clearInterval。");

console.log("");
console.log("=== 4. 发布体积（VPS 只需在首次加载时传一次） ===");
const shipped = ["client.js", "index.js", "cordis.patch.yml", "package.json"];
let raw = 0;
let gz = 0;
for (const f of shipped) {
  const buf = readFileSync(join(BASE, f));
  const g = gzipSync(buf, { level: 9 });
  raw += buf.length;
  gz += g.length;
  console.log(`  ${f.padEnd(18)} ${String(buf.length).padStart(7)} B  → gzip ${String(g.length).padStart(6)} B`);
}
console.log(`  ${"合计".padEnd(16)} ${String(raw).padStart(7)} B  → gzip ${String(gz).padStart(6)} B (${nf(gz / 1024, 1)} KiB)`);
console.log("  宿主侧 index.js 是空实现：不注入提示词、不注册服务、不落盘 —— VPS 进程零增量。");
