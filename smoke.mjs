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
ok(el.props["data-pulse-src"] === "idle", `空闲态 data-pulse-src = ${el.props["data-pulse-src"]}（真值 / 估计 / 空闲三态可外部判定）`);
ok(el.props["data-pulse-step-tps"] === "na", "空闲态本步真值探针 = na");
ok(el.props["data-pulse-rates"].split(",").length === 5, `五类标定探针初始就是先验五值：${el.props["data-pulse-rates"]}`);

// ---- 2b. v0.6.0 阴影：生效时不再画缓存命中（避免「99% + 99.87%」两枚读数） ----
T.shadowState.active = true;
const shadowed = T.PulseDock(idleProps);
ok(shadowed !== null && shadowed.children.length === 1,
  `阴影生效 → 只剩 tok/s 一枚 pill（实得 ${shadowed === null ? "null" : shadowed.children.length} 枚）`);
ok(shadowed.props["data-pulse-shadow"] === "on", `阴影态 data-pulse-shadow = ${shadowed.props["data-pulse-shadow"]}`);
ok(shadowed.children[0].props.title.includes("无输出") || shadowed.children[0].props.title.includes("tok/s"),
  "留下的是 tok/s pill");
T.shadowState.active = false;
ok(el.children.length === 2, "阴影关闭 → 恢复两枚（老版本 harness 的降级路径）");
ok(el.props["data-pulse-shadow"] === "off", `降级态 data-pulse-shadow = ${el.props["data-pulse-shadow"]}`);

// ---- 2c. 阴影组件本体：真装载 + 假 React（无 memo / 无 useMemo 的退化路径） ----
const Shadow = T.createStatsShadow(react);
const ORIGINAL = function StatsPills() {};
const shadowEl = Shadow({
  Original: ORIGINAL,
  useProjection: (k) => (k === "tokenUsage" ? USAGE : undefined),
  t: (key, params) => key + "|" + JSON.stringify(params || null),
  sessionId: "s9"
});
ok(shadowEl.type === ORIGINAL, "阴影组件渲染原组件本体（统计行其余内容逐字不变）");
ok(shadowEl.props.t("stats.cacheHit", { percent: "87" }) === 'stats.cacheHit|{"percent":"87.43"}',
  `stats.cacheHit 被换成两位小数：${shadowEl.props.t("stats.cacheHit", { percent: "87" })}`);
ok(shadowEl.props.t("stats.steps", { n: 4 }) === 'stats.steps|{"n":4}', "其它 i18n key 透传");
ok(shadowEl.props.sessionId === "s9" && shadowEl.props.Original === undefined, "slot props 转发，Original 不外传");

// 带 memo / useMemo 的 React 形状也要能跑（真浏览器走这条）
const reactFull = { ...react, useMemo: (fn) => fn(), memo: (c) => c };
const ShadowFull = T.createStatsShadow(reactFull);
const fullEl = ShadowFull({
  Original: ORIGINAL,
  useProjection: (k) => (k === "tokenUsage" ? USAGE : undefined),
  t: (key, params) => key + "|" + JSON.stringify(params || null)
});
ok(fullEl.props.t("stats.cacheHit", {}) === 'stats.cacheHit|{"percent":"87.43"}', "React.memo + useMemo 路径同样拦截成功");
ok(T.createStatsShadow(react)({ Original: null, useProjection: () => USAGE, t: () => "x" }) === null,
  "拿不到原组件 → 整枚不渲染（宁可少一枚，也不弄坏 dock）");

// ---- 3. 无缓存数据 + 无速度 → 整条 dock 不渲染（不留空 pill） ----
const bare = T.PulseDock({ t: seatMiss, useProjection: () => undefined, useChat: () => null });
ok(bare === null, "两个数据源都缺 → 返回 null（不占位）");

// ---- 4. 速率文案：估算态带 ~、精确态带 ✓ ----
const CJK = (n) => [n, 0, 0, 0, 0];
const mk = (running) => {
  const st = T.createMeterState();
  T.stepMeter(st, 1000, 0, CJK(0), true);
  T.stepMeter(st, 2000, 0, CJK(200), true);
  T.stepMeter(st, 3000, 0, CJK(500), true);
  T.stepMeter(st, 4000, 600, CJK(0), false);
  T.stepMeter(st, 5000, 600, CJK(100), true);
  return st;
};
const estRate = T.readRate(mk(true), 5000, true, seatMiss);
ok(estRate.text === "~173 tok/s", `流式估算文案 = ${JSON.stringify(estRate.text)}`);
ok(estRate.source === "estimate", `流式态 source = ${estRate.source}`);
ok(estRate.key === "173", `data-pulse-tps = ${estRate.key}`);
ok(/流式进行中/.test(estRate.title), "估算态 title 明示「流式进行中」");
ok(/五类标定 汉字 0\.9/.test(estRate.title), `估算态 title 摊开五类标定（结算后 CJK 0.80→0.90）：${estRate.title.slice(0, 120)}`);
ok(/上次结算真值 300/.test(estRate.title), "估算态 title 带上本步 provider 真值 300 tok/s");

const exRate = T.readRate(mk(false), 5000, false, seatMiss);
ok(exRate.text === "150 tok/s ✓", `结算后精确文案 = ${JSON.stringify(exRate.text)}（带 ✓ 标记真值）`);
ok(exRate.source === "exact", `结算态 source = ${exRate.source}`);
ok(/sessionStats\.decodeTokens/.test(exRate.title), "精确态 title 写明口径来源");
ok(/本步真值 300/.test(exRate.title), "精确态 title 带本步 provider 真值");
ok(T.readRate(T.createMeterState(), 1000, false, seatMiss).source === "idle", "空态 source = idle（不拿估计冒充真值）");

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
// 五类口径：ASCII 100→500 字全部落「字母」类，实测先验 0.24 tok/char。
// est = 600 + 100×0.24 = 624 → 600 + 500×0.24 = 720；10 秒窗内斜率 = 96 / 2s = 48 tok/s
ok(el3.props["data-pulse-tps"] === "48", `两拍（0s/2s，100→500 ASCII 字）→ 48 tok/s，实得 ${el3.props["data-pulse-tps"]}`);
ok(el3.children[1].children[0] === "~48 tok/s", `流式 pill 带 ~ 前缀：${JSON.stringify(el3.children[1].children[0])}`);
ok(el3.props["data-pulse-src"] === "estimate", `流式态探针 data-pulse-src = ${el3.props["data-pulse-src"]}`);
ok(el3.props["data-pulse-units"] === "210", `加权 unit 探针仍按旧口径（500 × 0.42 = 210）：${el3.props["data-pulse-units"]}`);

// ---- 5. v0.7.0 设置页曲线组件：真渲染一遍，断言 SVG 与探针 ----
{
  const TC = mod.__test;
  ok(typeof TC.PulseCurveSection === "function", "__test.PulseCurveSection 可用");
  ok(TC.sharedTrace && Array.isArray(TC.sharedTrace.points),
    "__test.sharedTrace 可用（dock 与设置页共享的模块级轨迹）");

  // 先让模块单例完成一次性装载 —— 否则组件首帧渲染时 ensureTrace() 会把 points
  // 换成一个新数组，我们刚推进去的数据就丢了（这个坑第一次就踩到了）。
  TC.ensureTrace();
  ok(TC.sharedTrace.ready === true, "ensureTrace() 完成一次性装载（ready = true）");

  // 造 20 个点：前 10 个是流式（只有 est），后 10 个是结算（只有 exact），缓存线全程有值。
  const tNow = Date.now();
  const pts = [];
  for (let i = 0; i < 20; i += 1) {
    const streaming = i < 10;
    pts.push(TC.tracePoint(tNow - (20 - i) * 500, streaming ? 30 + i : null, streaming ? null : 80 + i, 40 + i));
  }
  TC.sharedTrace.points.length = 0;
  for (const p of pts) TC.sharedTrace.points.push(p);

  const curveEl = TC.PulseCurveSection({ t: seatMiss });
  ok(curveEl && curveEl.type === "div", "曲线分区渲染出根 div");
  ok(curveEl.props["data-pulse-curve"] === "20",
    `探针 data-pulse-curve = 点数 20，实得 ${curveEl.props["data-pulse-curve"]}`);
  ok(curveEl.props["data-pulse-curve-src"] === "settings",
    `探针 data-pulse-curve-src = settings，实得 ${curveEl.props["data-pulse-curve-src"]}`);
  ok(curveEl.props["data-pulse-curve-peak"] === "99",
    `峰值探针 = 99 tok/s（后 10 点 exact 80+i，i=10..19 → 90..99），实得 ${curveEl.props["data-pulse-curve-peak"]}`);
  ok(curveEl.props["data-pulse-curve-cache"] === "59",
    `末点缓存命中 = 40+19 = 59%，实得 ${curveEl.props["data-pulse-curve-cache"]}`);

  const svg = curveEl.children.find((c) => c && c.type === "svg");
  ok(!!svg, "渲染出 SVG");
  ok(svg && svg.props["data-pulse-curve-svg"] === "1", "SVG 带 data-pulse-curve-svg 探针");
  ok(svg && svg.props.viewBox === "0 0 760 210", `SVG viewBox = ${svg && svg.props.viewBox}`);

  const paths = svg ? svg.children.filter((c) => c && c.type === "path") : [];
  ok(paths.length === 3, `三条线：exact 实线 + est 虚线 + 缓存线，实得 ${paths.length}`);
  const dashed = paths.filter((p) => p.props.strokeDasharray);
  ok(dashed.length === 1, `只有 est 那条是虚线，实得 ${dashed.length} 条虚线`);
  ok(dashed.length === 1 && typeof dashed[0].props.d === "string" && dashed[0].props.d.length > 0,
    `虚线 path 的 d 串非空（实得 ${dashed.length === 1 ? JSON.stringify(dashed[0].props.d) : "无虚线"}）`);
  ok(paths.every((p) => p.props.d && p.props.d.indexOf("M") === 0),
    "每条 path 的 d 串都以 M 开头（不是空路径）");
  ok(paths.every((p) => p.props.fill === "none"), "曲线不填充（折线图，不是面积图）");

  const gridGroup = svg ? svg.children.find((c) => c && c.type === "g") : null;
  const gridLines = gridGroup ? gridGroup.children.filter((c) => c && c.type === "line") : [];
  ok(gridLines.length === 5, `横向网格 5 条，实得 ${gridLines.length}`);
  const gridTexts = gridGroup ? gridGroup.children.filter((c) => c && c.type === "text") : [];
  ok(gridTexts.length === 15, `左轴 tok/s 5 个 + 右轴命中% 5 个 + X 轴 5 个 = 15 个刻度文本，实得 ${gridTexts.length}`);

  // 无数据时：探针归零 + 出提示，而不是画一张空图装样子。
  TC.sharedTrace.points.length = 0;
  const emptyEl = TC.PulseCurveSection({ t: seatMiss });
  ok(emptyEl.props["data-pulse-curve"] === "0", `清空后点数探针 = 0，实得 ${emptyEl.props["data-pulse-curve"]}`);
  ok(emptyEl.props["data-pulse-curve-cache"] === "na", "无缓存数据时探针 = na（不假装 0%）");
  const emptySvg = emptyEl.children.find((c) => c && c.type === "svg");
  const emptyPaths = emptySvg ? emptySvg.children.filter((c) => c && c.type === "path") : [];
  ok(emptyPaths.length === 0, `无数据时不画任何 path，实得 ${emptyPaths.length}`);
  const hint = emptyEl.children.filter((c) => c && c.type === "div" && typeof c.children[0] === "string" && c.children[0].indexOf("暂无数据") === 0);
  ok(hint.length === 1, "无数据时给出「暂无数据」提示（并说明曲线从何而来）");
}

console.log("");
console.log(fail === 0 ? "SMOKE-OK（组件层全部通过）" : `SMOKE-FAILED（${fail} 项不通过）`);
process.exit(fail === 0 ? 0 : 1);
