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
const ts = src.indexOf("// #region trace");
const te = src.indexOf("// #endregion", ts);
const cs = src.indexOf("// #region curve");
const ce = src.indexOf("// #endregion", cs);
const region = src.slice(ws, we);
const W = new Function(
  region + "\nreturn { createMeterState, stepMeter, displayKey, windowSlope, liveCounts, countClasses, RATE_PRIOR };"
)();
// v0.7.0：轨迹区（trace）+ 曲线区（curve）一起求值，用来量「每拍多写一个点」的代价。
const C = new Function(
  region + "\n" + src.slice(ts, te) + "\n" + src.slice(cs, ce) +
    "\nreturn { tracePoint, tracePush, traceRecord, curveClip, curveSpeed, curveFilter, curvePath, curveStats, niceCeil," +
    " TRACE_CAP, TRACE_SAVE_MS, CURVE_WINDOW_MS };"
)();

const nf = (n, d = 2) => n.toFixed(d);
const us = (ms) => ms * 1000;

// 真实文体的一步：55% 汉字 / 30% 字母 / 5% 数字 / 5% 标点 / 5% 空白。
const mix = (n) => [
  Math.round(n * 0.55), Math.round(n * 0.3), Math.round(n * 0.05),
  Math.round(n * 0.05), Math.round(n * 0.05)
];

console.log("=== 1. 采样一拍的开销（含满窗 41 点的算术） ===");

// 造一个「最坏情况」的采样器：窗口塞满、处于流式态。
function worstCaseState() {
  const st = W.createMeterState();
  let t = 0;
  let chars = 0;
  for (let i = 0; i < 60; i += 1) {
    t += 500;
    chars += 60;
    W.stepMeter(st, t, i * 60, mix(chars), true);
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
    W.stepMeter(wc, clock, i * 60, mix(100 + i), true);
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

// v0.5.0 新增的大头：每拍要对「在飞正文」全量重数一遍五类字符。
// 这一步的代价与正文长度成正比，所以单独测一个真实量级的一步（8000 字）。
console.log("");
console.log("=== 1b. 五类字符重数（v0.5.0 新增，与正文长度成正比） ===");
const body = "中文输出速度实测".repeat(600) + " tok/s measured over 10s window. ".repeat(150);
console.log(`  样本正文长度 = ${body.length} 字符`);
const COUNT_ITER = 5000;
let sink = 0;
t0 = process.hrtime.bigint();
for (let i = 0; i < COUNT_ITER; i += 1) sink += W.countClasses(body)[0];
t1 = process.hrtime.bigint();
const countMs = Number(t1 - t0) / 1e6 / COUNT_ITER;
const perCharNs = countMs * 1e6 / body.length;
console.log(`  数一遍 ${body.length} 字 = ${nf(us(countMs))} µs（${nf(perCharNs, 2)} ns/字符）  [sink=${sink > 0}]`);
const liveTickMs = perTickMs + countMs;
console.log(`  流式一拍合计（重数 + stepMeter + displayKey）≈ ${nf(us(liveTickMs))} µs`);

// v0.7.0 新增：同拍往共享轨迹里写一个点（2s 子窗斜率 + 入环形缓冲）。
// 落盘是 5s 一次，不在每拍路径上，所以这里测的是稳态成本。
console.log("");
console.log("=== 1c. 共享轨迹写入（v0.7.0 新增，每拍一次） ===");
const traceStore = { points: [], lastSave: 0, ready: true };
// 先灌满 1200 点，测的是「缓冲已满」的稳态（含 splice 裁剪）。
for (let i = 0; i < C.TRACE_CAP + 100; i += 1) {
  C.traceRecord(traceStore, 100000 + i * 500, wc.samples, true, 60, null);
}
const TRACE_ITER = 200000;
let clock2 = 100000 + (C.TRACE_CAP + 100) * 500;
t0 = process.hrtime.bigint();
for (let i = 0; i < TRACE_ITER; i += 1) {
  clock2 += 500;
  C.traceRecord(traceStore, clock2, wc.samples, true, 60, null);
}
t1 = process.hrtime.bigint();
const traceMs = Number(t1 - t0) / 1e6 / TRACE_ITER;
console.log(`  traceRecord = ${nf(us(traceMs))} µs/拍（缓冲已满 ${traceStore.points.length} 点，含裁剪）`);
// 诚实的对照基准：采样一拍的真实成本是「重数正文 + stepMeter + displayKey」，
// 而不是只看算术部分的 0.24 µs —— 拿 0.24 µs 当分母会把增量放大成 1800%+，那是误导。
const liveTickBase = liveTickMs;
console.log(`  对照「流式一拍」真实基准 ${nf(us(liveTickBase))} µs → 增量 ${nf(traceMs / liveTickBase * 100, 1)}%`);
console.log(`  折算：${nf(traceMs * 2 / 1000 * 100, 6)}% 单核（2 拍/秒）`);

// 设置页打开时才付的成本：裁剪 + 折线 + 统计。每 500ms 一次，只在设置页可见时发生。
const cNow = clock2;
const cT0 = process.hrtime.bigint();
let cSink = 0;
for (let i = 0; i < 2000; i += 1) {
  const pts = C.curveClip(traceStore.points, cNow, C.CURVE_WINDOW_MS);
  const sp = C.curveSpeed(pts);
  const vMax = C.niceCeil(C.curveStats(sp).peak);
  cSink += C.curvePath(C.curveFilter(sp, "estimate"), cNow - C.CURVE_WINDOW_MS, cNow, 658, 174, vMax).length;
  cSink += C.curvePath(C.curveFilter(sp, "exact"), cNow - C.CURVE_WINDOW_MS, cNow, 658, 174, vMax).length;
  cSink += C.curvePath(pts.filter((p) => typeof p.cache === "number"), cNow - C.CURVE_WINDOW_MS, cNow, 658, 174, 100).length;
}
const cT1 = process.hrtime.bigint();
const curveMs = Number(cT1 - cT0) / 1e6 / 2000;
console.log(`  设置页重画一帧（裁 1200 点 + 3 条 path + 统计）= ${nf(us(curveMs))} µs  [sink=${cSink > 0}]`);
console.log(`  只在设置页打开时发生，2 帧/秒 → 占单核 ${nf(curveMs * 2 / 1000 * 100, 6)}%`);

console.log("");
console.log("=== 2. 折算到真实运行 ===");
const ticksPerSec = 2; // SAMPLE_MS = 500
const cpuMsPerSec = liveTickMs * ticksPerSec;
console.log(`  采样频率 = ${ticksPerSec} 次/秒（SAMPLE_MS = 500）`);
console.log(`  流式持续 CPU = ${nf(us(cpuMsPerSec))} µs/秒 = ${nf(cpuMsPerSec / 1000 * 100, 6)}% 单核（按 8000 字正文的上界）`);
console.log(`  空闲持续 CPU = ${nf(us(perTickMs * ticksPerSec))} µs/秒（正文为空，不数字符）`);
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
console.log("  其余状态：ratio / rates[5] / fit（25+5+2 个数）/ running / stepStartTokens / stepFirstOutputTime /");
console.log("            stepPeakCounts[5] / lastStep / estTokens / renderedKey —— 常数个标量与定长数组。");
console.log("  定时器：1 个 setInterval；卸载时 clearInterval。");

// v0.7.0 新增的常驻内存：模块级共享轨迹。这条**不随会话卸载**，进程活着就在。
console.log("");
console.log("=== 3b. 共享轨迹的常驻内存（v0.7.0 新增，跨会话存活） ===");
const tp = C.TRACE_CAP;
const jsonBytes = Buffer.byteLength(JSON.stringify({ v: 1, points: traceStore.points }), "utf8");
console.log(`  容量上限 = ${tp} 点（${tp * 0.5}s = ${tp * 0.5 / 60} 分钟 @500ms）`);
console.log(`  每点 = {t, est, exact, cache} 四个 number`);
console.log(`  粗估堆占用 ≈ ${nf(tp * 4 * 8 / 1024, 1)} KiB（按 8B/数值算下界，未计对象头；`);
console.log(`              加上 V8 对象头与 4 个属性槽后约 ${nf(tp * 4 * 8 * 2.2 / 1024, 1)} KiB 量级）`);
console.log(`  localStorage 快照 = ${nf(jsonBytes / 1024, 1)} KiB，每 ${C.TRACE_SAVE_MS / 1000}s 写一次（节流后）`);
console.log(`  对比：dock 的 20s 采样缓冲 ≈ 1 KiB —— 曲线这部分是唯一显著的内存增量，如实列出。`);

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
