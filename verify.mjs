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

console.log("=== 3. 10 秒滑窗速率（抽取 window 区做行为断言） ===");
{
  const ws = src.indexOf("// #region window");
  const we = src.indexOf("// #endregion", ws);
  if (ws < 0 || we < 0) {
    ok(false, "找不到 // #region window 标记块");
  } else {
    const region = src.slice(ws, we);
    const w = new Function(
      region +
        "\nreturn { createMeterState, stepMeter, pushSample, windowSlope, formatRate, calibrateRatio, estimateTokens, liveChars, exactOutputTokens };"
    )();
    const { createMeterState, stepMeter, pushSample, windowSlope, formatRate, calibrateRatio, estimateTokens, liveChars, exactOutputTokens } = w;

    ok(liveChars(null) === 0, "liveChars(null) = 0（不崩）");
    ok(liveChars({ blocks: [] }) === 0, "liveChars(空 blocks) = 0");
    ok(
      liveChars({ blocks: [{ kind: "text", text: "abcde" }, { kind: "reasoning", text: "xy" }, { kind: "tool-call", argsRaw: "zzzzzzz" }] }) === 7,
      "liveChars 只数 text+reasoning（5+2=7），不数 tool-call 参数"
    );

    ok(exactOutputTokens({ decodeTokens: 120 }, { outputTokens: 9 }) === 120, "exactOutputTokens 优先 sessionStats = 120");
    ok(exactOutputTokens(null, { outputTokens: 9 }) === 9, "exactOutputTokens 回退 tokenUsage = 9");
    ok(exactOutputTokens(null, null) === null, "两个投影都缺 → null（不出数，不猜）");

    ok(formatRate(42.7) === "43", 'formatRate(42.7) = "43"（≥10 取整，同产品 formatTokensPerSecond）');
    ok(formatRate(9.87) === "9.9", 'formatRate(9.87) = "9.9"（<10 保留一位小数）');
    ok(formatRate(0) === "0", 'formatRate(0) = "0"');
    ok(formatRate(-1) === null, "formatRate(负值) = null");

    ok(calibrateRatio(0, 100, 0.5) === 0.5, "无字符 → 保持旧比 0.5");
    ok(calibrateRatio(1000, 0, 0.5) === 0.5, "无 tokens → 保持旧比 0.5");
    ok(calibrateRatio(1000, 600, 0.5) === 0.6, "正常标定 600/1000 = 0.6");
    ok(calibrateRatio(1000, 10, 0.5) === 0.05, "过小比值夹紧到下界 0.05");
    ok(calibrateRatio(1000, 20000, 0.5) === 8, "过大比值夹紧到上界 8");

    ok(estimateTokens(100, 200, 0.5) === 200, "estimateTokens(100, 200, 0.5) = 200");
    ok(estimateTokens(0, 100, 0) === 50, "ratio 为 0 → 退回种子比 0.5，得 50");

    const s = [];
    for (let i = 0; i <= 10; i += 1) pushSample(s, i * 1000, i, i, 5000);
    ok(s.length === 6 && s[0].t === 5000, "pushSample 裁掉窗外旧点：剩 6 点、最老 t=5000");

    const edge = [
      { t: 0, exact: 0, est: 0 },
      { t: 2000, exact: 20, est: 20 },
      { t: 8000, exact: 80, est: 80 },
      { t: 10000, exact: 100, est: 100 }
    ];
    const full = windowSlope(edge, 10000, "exact", 10000, 1000);
    ok(full !== null && full.rate === 10 && full.tokens === 100 && full.spanMs === 10000, "满窗斜率：100 tok / 10s = 10 tok/s");
    const trimmed = windowSlope(edge, 12000, "exact", 10000, 1000);
    ok(trimmed !== null && trimmed.rate === 10 && trimmed.spanMs === 8000, "窗沿锚点取到 t=2000：80 tok / 8s = 10 tok/s");
    ok(windowSlope([{ t: 0, exact: 0, est: 0 }, { t: 500, exact: 5, est: 5 }], 500, "exact", 10000, 1000) === null, "跨度不足 1s → null（两点斜率不可信）");
    ok(windowSlope([{ t: 0, exact: 100, est: 100 }, { t: 1000, exact: 50, est: 50 }], 1000, "exact", 10000, 1000) === null, "计数器回退 → null（不报负数）");

    const m = createMeterState();
    stepMeter(m, 1000, 0, 0, true);
    stepMeter(m, 2000, 0, 200, true);
    stepMeter(m, 3000, 0, 500, true);
    ok(m.running === true, "流式进行中 running = true");
    ok(m.estTokens === 250, "估算值 = 0 + 500 字符 × 0.5 = 250");
    stepMeter(m, 4000, 600, 0, false);
    ok(m.ratio === 1.2, "步骤结算 → 标定比 = 600 tokens / 500 字符 = 1.2");
    ok(m.estTokens === 600, "结算后估算收敛回精确值 600（不跳变）");
    ok(m.running === false, "结算后 running = false");
    stepMeter(m, 5000, 600, 100, true);
    ok(m.estTokens === 720, "第二步用新比：600 + 100 × 1.2 = 720");
    const estSlope = windowSlope(m.samples, 5000, "est", 10000, 1000);
    const exactSlope = windowSlope(m.samples, 5000, "exact", 10000, 1000);
    ok(estSlope !== null && estSlope.rate === 180, "估算窗斜率 = 720 tok / 4s = 180 tok/s");
    ok(exactSlope !== null && exactSlope.rate === 150, "精确窗斜率 = 600 tok / 4s = 150 tok/s（流式段仍是平线，故低于估算）");
  }
}

console.log("=== 4. 注册面静态核对 ===");
ok(/"conversation\.composer\.dock"/.test(src), "注册目标 = conversation.composer.dock");
ok(/id: "pulse"/.test(src), 'entry id = "pulse"（不与内置 "stats" 撞 id）');
ok(/order: 1/.test(src), "order = 1（紧随内置 order 0）");
ok(/locale: NS/.test(src), "声明 locale 席位 → 组件拿到 t");
ok(/WINDOW_MS = 10000/.test(src), "滑窗 = 10000ms（用户令「10s 内」）");
ok(/readProjection\(props\.useProjection, "sessionStats"\)/.test(src), "读 sessionStats 投影（精确输出 tokens 的唯一权威来源）");
ok(/props\.useChat/.test(src) && /legacy\.partial/.test(src), "读 legacy.partial（流式进行中宿主没有 usage，只有这份实时文本）");
ok(/setInterval\(/.test(src) && /clearInterval\(/.test(src), "采样循环随卸载清理（不泄漏定时器）");
ok(/"data-pulse-tps"/.test(src), "速度读数带 data-pulse-tps 探针");
ok(/window\.__ModuleLoader__\.load\(\{\s*\n\s*id: "dsh-pulse"/.test(src), "ModuleLoader id = dsh-pulse");
ok(/require\("react"\)/.test(src), 'require("react")');
ok(/exports\.inject = inject/.test(src) && /exports\.apply = apply/.test(src), "导出 inject / apply");
ok(!/document\.|window\.document|querySelector|getElementById/.test(src), "不碰 DOM / 不引用产品选择器");
ok(!/ctx\.remote|host\.call|harness\./.test(src), "不走宿主 RPC（纯读投影）");

console.log("");
console.log(fail === 0 ? "VERIFY-OK（全部断言通过）" : `VERIFY-FAILED（${fail} 项不通过）`);
process.exit(fail === 0 ? 0 : 1);
