// smoke.mjs — 组件层冒烟：装载真实 client.js，在假 React 下渲染 PulseDock。
// verify.mjs 只做纯函数断言；本文件补上「整包能装载 + 组件能渲染 + 文案对」这一段。
// 用法：node smoke.mjs
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const BASE = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(BASE, "client.js"), "utf8");

let fail = 0;
const ok = (cond, msg) => {
  console.log((cond ? "  PASS  " : "  FAIL  ") + msg);
  if (!cond) fail++;
};

// ---- 1. 装载：client.js 是给 ModuleLoader 的 bundle，不是 ESM ----
let loaded = null;
globalThis.window = {
  __ModuleLoader__: {
    load(config) {
      loaded = config;
    }
  }
};

// 真实 React 会把 useRef 的返回值跨渲染持久化；替身必须照做，否则每次渲染都会
// 新建一份采样状态，采样点永远进不了下一帧。
const REF_HOLDER = { current: null };

const react = {
  createElement(type, props, ...children) {
    return { type, props: props || {}, children: children.flat() };
  },
  useState(init) {
    return [init, () => {}];
  },
  useRef() {
    return REF_HOLDER;
  },
  useEffect() {}
};

new Function("window", src)(globalThis.window);
ok(loaded !== null, "client.js 调用了 window.__ModuleLoader__.load");
ok(loaded && loaded.id === "dsh-pulse", `ModuleLoader id = ${loaded && loaded.id}`);

const mod = loaded.factory((name) => {
  if (name === "react") return react;
  throw new Error("unexpected require: " + name);
});
ok(typeof mod.apply === "function" && typeof mod.inject === "object", "导出 inject / apply");

const T = mod.__test;
ok(T && typeof T.PulseDock === "function", "__test.PulseDock 可用");

// ---- 2. 未命中 i18n 时退回字面量：文案必须自带单位与两位小数 ----
const seatMiss = () => undefined;
const USAGE = { cacheReadTokens: 8743, uncachedInputTokens: 1257, cacheWriteTokens: 0 };
const projection = (key) => {
  if (key === "tokenUsage") return USAGE;
  if (key === "sessionStats") return { decodeTokens: 600 };
  return undefined;
};

const idleProps = { t: seatMiss, useProjection: projection, useChat: () => null };
const el = T.PulseDock(idleProps);
ok(el && el.type === "span", "PulseDock 渲染出根 span");
ok(el.children.length === 2, "根 span 下有两枚 pill（缓存命中 + 速度）");
ok(el.children[0].children[0] === "缓存命中 87.43%", `缓存命中 pill = ${JSON.stringify(el.children[0].children[0])}`);
ok(el.children[1].children[0] === "— tok/s", `无采样时速度 pill = ${JSON.stringify(el.children[1].children[0])}`);
ok(el.props["data-pulse"] === "87.43", `data-pulse = ${el.props["data-pulse"]}`);
ok(el.props["data-pulse-tps"] === "idle", `data-pulse-tps = ${el.props["data-pulse-tps"]}`);
ok(el.props["data-pulse-chars"] === "0" && el.props["data-pulse-units"] === "0", "chars/units 探针初始为 0");

// ---- 3. 无缓存数据 + 无速度 → 整条 dock 不渲染（不留空 pill） ----
const bare = T.PulseDock({ t: seatMiss, useProjection: () => undefined, useChat: () => null });
ok(bare === null, "两个数据源都缺 → 返回 null（不占位）");

// ---- 4. 速率文案：估算态带 ~、精确态不带 ----
const mk = (running) => {
  const st = T.createMeterState();
  T.stepMeter(st, 1000, 0, 0, true);
  T.stepMeter(st, 2000, 0, 200, true);
  T.stepMeter(st, 3000, 0, 500, true);
  T.stepMeter(st, 4000, 600, 0, false);
  T.stepMeter(st, 5000, 600, 100, true);
  return st;
};
const estRate = T.readRate(mk(true), 5000, true, seatMiss);
ok(estRate.text === "~180 tok/s", `流式估算文案 = ${JSON.stringify(estRate.text)}`);
ok(estRate.key === "180", `data-pulse-tps = ${estRate.key}`);
ok(/流式进行中/.test(estRate.title), "估算态 title 明示「流式进行中」");
ok(/1\.2 tok\/unit/.test(estRate.title), "估算态 title 带标定比（tok/unit 加权口径）");

const exRate = T.readRate(mk(false), 5000, false, seatMiss);
ok(exRate.text === "150 tok/s", `结算后精确文案 = ${JSON.stringify(exRate.text)}（不带 ~）`);
ok(/sessionStats\.decodeTokens/.test(exRate.title), "精确态 title 写明口径来源");

// ---- 5. 采样循环挂载/卸载 ----
let intervalFn = null;
let cleared = 0;
const react2 = {
  ...react,
  useEffect(fn) {
    const cleanup = fn();
    if (typeof cleanup === "function") cleanup();
  }
};
globalThis.setInterval = (fn) => {
  intervalFn = fn;
  return 7;
};
globalThis.clearInterval = () => {
  cleared += 1;
};
const mod2 = loaded.factory((name) => (name === "react" ? react2 : undefined));
mod2.__test.PulseDock(idleProps);
ok(typeof intervalFn === "function", "挂载后启动了采样定时器");
ok(cleared === 1, "卸载时 clearInterval 被调用（不泄漏）");

// 手动跑两拍：采样点要跨过 1s 才出斜率，故先接管 Date.now 再推进。
let fakeNow = 0;
Date.now = () => fakeNow;
let liveCharsNow = 100;
const streamingProps = {
  t: seatMiss,
  useProjection: projection,
  useChat: (sel) => sel({ legacy: { partial: { turn: 1, step: 0, blocks: [{ kind: "text", text: "x".repeat(liveCharsNow) }] } } })
};
const el2 = mod2.__test.PulseDock(streamingProps);
const before = el2.props["data-pulse-tps"];
intervalFn();
liveCharsNow = 500;
fakeNow = 2000;
// 真实运行时每次 live-chunk 都会触发一次重渲，采样器读的是「最近一次渲染观测到的 partial」——
// 所以第二拍之前必须先重渲，才能看到增长后的字符数。
mod2.__test.PulseDock(streamingProps);
intervalFn();
const el3 = mod2.__test.PulseDock(streamingProps);
ok(before === "idle", `首帧还没采到两点 → ${before}`);
// 加权口径：ASCII 100→500 字 = 42→210 unit；est = 600 + unit × 0.80 → 633.6 → 768
// 10 秒窗内斜率 = (768 − 633.6) / 2s = 67.2 → 67 tok/s
ok(el3.props["data-pulse-tps"] === "67", `两拍（0s/2s，100→500 ASCII 字）→ 67.2 tok/s，实得 ${el3.props["data-pulse-tps"]}`);
ok(el3.children[1].children[0] === "~67 tok/s", `流式 pill 带 ~ 前缀：${JSON.stringify(el3.children[1].children[0])}`);

console.log("");
console.log(fail === 0 ? "SMOKE-OK（组件层全部通过）" : `SMOKE-FAILED（${fail} 项不通过）`);
process.exit(fail === 0 ? 0 : 1);
