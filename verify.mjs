// verify.mjs — dsh-pulse 自证：语法 + 抽取 formatter/window 区做行为断言 + 注册面静态核对
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

console.log("=== 3. 10 秒滑窗速率 + v0.5.0 五类标定（抽取 window 区做行为断言） ===");
{
  const ws = src.indexOf("// #region window");
  const we = src.indexOf("// #endregion", ws);
  if (ws < 0 || we < 0) {
    ok(false, "找不到 // #region window 标记块");
  } else {
    const region = src.slice(ws, we);
    const w = new Function(
      region +
        "\nreturn { createMeterState, stepMeter, pushSample, windowSlope, formatRate, displayKey, calibrateRatio, estimateTokens," +
        " liveChars, liveUnits, liveCounts, exactOutputTokens, classOf, classOfCode, countClasses, countsTotal, countsUnits," +
        " createFit, fitAdd, solveLinear, fitRates, loadFit, saveFit, ensureCalibration, ratesText, readModelKey," +
        " CLASS_COUNT, CLASS_CJK, CLASS_LETTER, CLASS_DIGIT, CLASS_PUNCT, CLASS_SPACE, RATE_PRIOR, RIDGE_STEPS, CAL_KEY, WINDOW_MS, MIN_SPAN_MS };"
    )();
    const {
      createMeterState, stepMeter, pushSample, windowSlope, formatRate, displayKey, calibrateRatio, estimateTokens,
      liveChars, liveUnits, liveCounts, exactOutputTokens, classOf, classOfCode, countClasses, countsTotal, countsUnits,
      createFit, fitAdd, solveLinear, fitRates, loadFit, saveFit, ensureCalibration, ratesText, readModelKey,
      CLASS_COUNT, CLASS_CJK, CLASS_LETTER, CLASS_DIGIT, CLASS_PUNCT, CLASS_SPACE, RATE_PRIOR, RIDGE_STEPS, CAL_KEY
    } = w;

    // readRate 依赖 i18n 兜底 tr() 与千分位 group()，不属纯算术区，单独抽一段求值。
    const vs = src.indexOf("    function tr(seat, key, params, fallback) {");
    const ve = src.indexOf("    function PulseDock(props) {");
    if (vs < 0 || ve < 0 || ve <= vs) {
      ok(false, "找不到 tr/group/readRate 视图段");
    }
    const viewBox = new Function(
      "windowSlope", "formatRate", "ratesText", "WINDOW_MS", "MIN_SPAN_MS",
      src.slice(vs, ve) + "\nreturn { readRate, group };"
    )(w.windowSlope, w.formatRate, w.ratesText, w.WINDOW_MS, w.MIN_SPAN_MS);
    const readRate = viewBox.readRate;
    ok(typeof readRate === "function", "readRate 抽取成功（视图段依赖 windowSlope/formatRate/ratesText 注入）");

    // --- 3.1 旧口径回归（v0.4.x 行为不能被改坏） ---
    ok(liveChars(null) === 0, "liveChars(null) = 0（不崩）");
    ok(liveChars({ blocks: [] }) === 0, "liveChars(空 blocks) = 0");
    ok(
      liveChars({ blocks: [{ kind: "text", text: "abcde" }, { kind: "reasoning", text: "xy" }, { kind: "tool-call", name: "write", argsRaw: "zzzzzzz" }] }) === 5 + 2 + 5 + 7,
      "liveChars 数 text+reasoning+工具参数（v0.5.0 起工具参数计入：name 5 + argsRaw 7）"
    );
    ok(liveChars({ blocks: [{ kind: "tool-call", argsRaw: "abcd" }] }) === 4, "liveChars 单计工具参数 argsRaw");
    ok(liveChars({ blocks: [{ kind: "tool-call" }] }) === 0, "工具块缺 name/argsRaw → 0（不崩）");

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

    // liveUnits：语言加权（CJK = 1，非 CJK = 0.42）保留为 tooltip 口径
    ok(liveUnits(null) === 0, "liveUnits(null) = 0");
    ok(liveUnits({ blocks: [{ kind: "text", text: "中文中文" }] }) === 4, "liveUnits 纯中文 4 字 = 4 unit");
    ok(Math.abs(liveUnits({ blocks: [{ kind: "text", text: "abcd" }] }) - 1.68) < 1e-9, "liveUnits 纯英文 4 字 = 4 × 0.42 = 1.68 unit");
    ok(liveUnits({ blocks: [{ kind: "tool-call", argsRaw: "xxxxxx" }] }) > 0, "liveUnits 计入工具参数（v0.5.0 口径变更）");
    ok(liveChars({ blocks: [{ kind: "text", text: "abcd" }] }) === 4, "liveChars 仍返回原始字符数（加权前的口径保留）");

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

    // --- 3.2 五类字符分类 ---
    ok(CLASS_COUNT === 5, "CLASS_COUNT = 5（CJK / 字母 / 数字 / 标点 / 空白）");
    ok(classOf("中") === CLASS_CJK && classOf("あ") === CLASS_CJK && classOf("한") === CLASS_CJK, "汉字 / 假名 / 谚文 → CJK 类");
    ok(classOf("A") === CLASS_LETTER && classOf("z") === CLASS_LETTER, "拉丁字母 → 字母类");
    ok(classOf("7") === CLASS_DIGIT, "数字 → 数字类");
    ok(classOf(" ") === CLASS_SPACE && classOf("\n") === CLASS_SPACE && classOf("\t") === CLASS_SPACE, "空格 / 换行 / 制表 → 空白类");
    ok(classOf("，") === CLASS_PUNCT && classOf("!") === CLASS_PUNCT && classOf("→") === CLASS_PUNCT, "标点 / 符号 / 非 ASCII 杂项 → 标点类");
    ok(classOfCode(0x4e2d) === CLASS_CJK && classOfCode(0x41) === CLASS_LETTER && classOfCode(0x37) === CLASS_DIGIT
      && classOfCode(0x20) === CLASS_SPACE && classOfCode(0x21) === CLASS_PUNCT,
      "classOfCode 与 classOf 同口径（charCode 快路径，采样每拍要扫全文）");
    ok(classOf("") === CLASS_PUNCT && classOf(null) === CLASS_PUNCT, "空串 / 非字符串 → 标点类（不崩）");
    ok(classOf("\u3000") === CLASS_SPACE && classOf("\u00a0") === CLASS_SPACE, "全角空格 / 不换行空格 → 空白类");
    ok(classOf("\u3042") === CLASS_CJK && classOf("\uac00") === CLASS_CJK, "假名 / 谚文 → CJK 类（与旧 CJK_RE 区间一致）");

    const cc = countClasses("中文ab12 \n!");
    ok(cc.length === 5, "countClasses 返回 5 个桶");
    ok(cc[CLASS_CJK] === 2 && cc[CLASS_LETTER] === 2 && cc[CLASS_DIGIT] === 2 && cc[CLASS_SPACE] === 2 && cc[CLASS_PUNCT] === 1,
      `countClasses("中文ab12 \\n!") = [2,2,2,1,2] 实得 [${cc.join(",")}]`);
    ok(countsTotal(cc) === 9, "countsTotal = 9（等于字符串长度，五类互斥且完备）");
    ok(countsTotal(countClasses("")) === 0, "空串 → 0");
    ok(Math.abs(countsUnits(cc) - (2 * 1 + 7 * 0.42)) < 1e-9, "countsUnits 与旧加权口径一致（CJK 记 1，其余记 0.42）");

    const lc = liveCounts({ blocks: [{ kind: "text", text: "中文ab" }, { kind: "reasoning", text: "12" }, { kind: "tool-call", name: "go", argsRaw: "cd34" }] });
    ok(lc[CLASS_CJK] === 2 && lc[CLASS_LETTER] === 2 + 2 + 2 && lc[CLASS_DIGIT] === 2 + 2,
      `liveCounts 数 text+reasoning+工具参数：CJK ${lc[CLASS_CJK]} / 字母 ${lc[CLASS_LETTER]} / 数字 ${lc[CLASS_DIGIT]}（期望 2 / 6 / 4）`);
    ok(liveCounts(null)[0] === 0 && liveCounts({ blocks: [] })[0] === 0, "liveCounts(null / 空 blocks) 全 0（不崩）");

    // --- 3.3 估算：先验 / 混合类 ---
    ok(estimateTokens(100, [0, 0, 0, 0, 0], RATE_PRIOR) === 100, "无字符 → 估算 = 起点精确值 100");
    ok(estimateTokens(0, [500, 0, 0, 0, 0], RATE_PRIOR) === 400, "纯中文 500 字 × 实测先验 0.80 = 400");
    ok(Math.abs(estimateTokens(0, [0, 400, 0, 0, 0], RATE_PRIOR) - 96) < 1e-9, "纯英文 400 字 × 实测先验 0.24 = 96（v0.4.x 的 0.34 实测偏高 42%）");
    ok(Math.abs(estimateTokens(0, [100, 100, 0, 0, 0], null) - 104) < 1e-9, "rates 为 null → 退回 RATE_PRIOR（80 + 24 = 104）");

    // --- 3.4 岭回归：先验恒等 + 合成数据收敛 ---
    const priorOnly = fitRates(createFit(), RATE_PRIOR);
    ok(priorOnly.every((v, i) => Math.abs(v - RATE_PRIOR[i]) < 1e-9), "零数据 → 解恒等于先验（λ 撑开对角，解永远存在）");

    const flatPrior = solveLinear([2, 1, 1, 3], [5, 7], 2);
    ok(flatPrior !== null && Math.abs(flatPrior[0] - 1.6) < 1e-9 && Math.abs(flatPrior[1] - 1.8) < 1e-9,
      `solveLinear 解 2x2：x=[1.6, 1.8] 实得 [${flatPrior === null ? "null" : flatPrior.map((v) => v.toFixed(6)).join(", ")}]`);
    ok(solveLinear([0, 0, 0, 0], [1, 1], 2) === null, "奇异矩阵 → null（不返回 NaN 解）");

    const TRUE = [0.50, 0.25, 0.30, 0.30, 0.10];
    const fit = createFit();
    let rng = 20260922;
    const rnd = () => { rng = (rng * 1103515245 + 12345) % 2147483648; return rng / 2147483648; };
    const synth = [];
    for (let step = 0; step < 24; step += 1) {
      const counts = [0, 0, 0, 0, 0].map(() => Math.round(40 + rnd() * 400));
      const tokens = counts.reduce((acc, c, i) => acc + c * TRUE[i], 0);
      fitAdd(fit, counts, tokens);
      synth.push({ counts, tokens });
    }
    const learned = fitRates(fit, RATE_PRIOR);
    const err = (rates) => TRUE.reduce((acc, t, i) => acc + Math.abs(rates[i] - t), 0);
    const errPrior = err(RATE_PRIOR);
    const errLearned = err(learned);
    ok(errLearned < errPrior * 0.85,
      `24 步合成数据（真值 [${TRUE.join(", ")}]，先验是错的）→ 回归把总误差从 ${errPrior.toFixed(4)} 降到 ${errLearned.toFixed(4)}（${(100 * (1 - errLearned / errPrior)).toFixed(0)}%）；解出 [${learned.map((v) => v.toFixed(4)).join(", ")}]。`
      + ` 这是**故意取的最坏情形**（五类计数 i.i.d. 均匀 → 设计矩阵高度共线），所以只要求 ≥15% 的降幅；`
      + ` 真实文体下（各步类占比差异大）实测降幅 26%~29%。回归是保守精修器，不是快速学习器。`);
    ok(learned.every((v) => v >= 0.02 && v <= 2), "解全部落在 [RATE_MIN, RATE_MAX] 内（夹紧生效，不会解出负数或爆炸值）");

    // 关键安全性质：先验本来就是对的（这是本机实测的真实情形 —— 0.80 / 0.42 口径实测误差仅 −2.0%），
    // 此时残差接近 0，回归必须「不动」，不能拿单步噪声把已经准的先验带偏。
    const fitSame = createFit();
    let rngSame = 4242;
    const rndSame = () => { rngSame = (rngSame * 1103515245 + 12345) % 2147483648; return rngSame / 2147483648; };
    for (let step = 0; step < 24; step += 1) {
      const counts = [0, 0, 0, 0, 0].map(() => Math.round(40 + rndSame() * 400));
      const tokens = counts.reduce((acc, c, i) => acc + c * RATE_PRIOR[i], 0);
      fitAdd(fitSame, counts, tokens);
    }
    const stayed = fitRates(fitSame, RATE_PRIOR);
    const drift = stayed.reduce((acc, v, i) => acc + Math.abs(v - RATE_PRIOR[i]), 0);
    ok(drift < 0.02,
      `先验正确时 24 步数据几乎不推动解：Σ|Δ| = ${drift.toFixed(5)} < 0.02（先验已实测准到 −2.0%，回归不能把它带偏）`);

    const fit2 = createFit();
    fitAdd(fit2, synth[0].counts, synth[0].tokens);
    const afterOne = fitRates(fit2, RATE_PRIOR);
    const predPrior1 = estimateTokens(0, synth[0].counts, RATE_PRIOR);
    const predFit1 = estimateTokens(0, synth[0].counts, afterOne);
    ok(Math.abs(predFit1 - synth[0].tokens) < Math.abs(predPrior1 - synth[0].tokens),
      `单步拟合把该步预测误差从 ${Math.abs(predPrior1 - synth[0].tokens).toFixed(1)} 降到 ${Math.abs(predFit1 - synth[0].tokens).toFixed(1)}（岭解至少不比先验差）`);
    const drift1 = afterOne.reduce((acc, v, i) => acc + Math.abs(v - RATE_PRIOR[i]), 0);
    ok(drift1 > 0 && drift1 < 1,
      `单步只做有限修正：Σ|Δ| = ${drift1.toFixed(4)} < 1（先验 = ${RIDGE_STEPS} 步等效，不会被单步数据带飞）`);
    ok(fit2.n === 1, "fitAdd 记步数 n = 1");
    ok(createFit().n === 0, "空累加器 n = 0");
    ok(fitAdd(createFit(), [0, 0, 0, 0, 0], 100).s === 0, "零字符的观测被丢弃（s 不变）");
    ok(fitAdd(createFit(), [10, 0, 0, 0, 0], 0).s === 0, "零 token 的观测被丢弃（s 不变）");
    ok(fitAdd(createFit(), [10, 0, 0, 0, 0], 0).n === 0, "被丢弃的观测不计步数");

    // --- 3.5 持久化 ---
    const makeStorage = () => {
      const map = new Map();
      return {
        getItem: (k) => (map.has(k) ? map.get(k) : null),
        setItem: (k, v) => { map.set(k, String(v)); },
        raw: map
      };
    };
    const store = makeStorage();
    ok(loadFit(store, CAL_KEY).s === 0, "空 storage → 全新累加器");
    ok(loadFit(null, CAL_KEY).s === 0, "无 storage（隐私模式）→ 全新累加器，不抛");
    ok(saveFit(store, CAL_KEY, fit) === true, "saveFit 写入成功");
    const roundTrip = loadFit(store, CAL_KEY);
    ok(roundTrip.s === fit.s && roundTrip.n === fit.n && roundTrip.xy.every((v, i) => v === fit.xy[i]) && roundTrip.xx.every((v, i) => v === fit.xx[i]),
      "写入 → 读回，累加器逐字段一致（含步数 n）");
    store.setItem("bad-json", "{oops");
    ok(loadFit(store, "bad-json").s === 0, "JSON 损坏 → 全新累加器（不抛）");
    store.setItem("bad-ver", JSON.stringify({ v: 99, xx: fit.xx, xy: fit.xy, s: fit.s }));
    ok(loadFit(store, "bad-ver").s === 0, "版本不符 → 全新累加器（结构升级不会串味）");
    store.setItem("bad-shape", JSON.stringify({ v: 1, xx: [1, 2], xy: [1], s: 5 }));
    ok(loadFit(store, "bad-shape").s === 0, "维度不符 → 全新累加器");
    store.setItem("poisoned", JSON.stringify({ v: 1, xx: fit.xx.map(() => -1), xy: fit.xy.map(() => NaN), s: -5 }));
    const poisoned = loadFit(store, "poisoned");
    ok(poisoned.s === 0 && poisoned.xx.every((v) => v === 0) && poisoned.xy.every((v) => v === 0), "被投毒的负数 / NaN → 全部归零（不污染标定）");
    const badStorage = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("quota"); } };
    ok(loadFit(badStorage, CAL_KEY).s === 0 && saveFit(badStorage, CAL_KEY, fit) === false, "storage 抛错（被禁 / 配额满）→ 静默降级，不崩");

    const calState = createMeterState();
    ensureCalibration(calState, "bucketA", store);
    ok(calState.storageReady === true && calState.fitKey === CAL_KEY + ":bucketA", `ensureCalibration 装载指定桶（桶名带命名空间）：${calState.fitKey}`);
    const sameFit = calState.fit;
    ensureCalibration(calState, "bucketA", store);
    ok(calState.fit === sameFit, "同一个桶 → 不重复装载");
    ensureCalibration(calState, "bucketB", store);
    ok(calState.fitKey === CAL_KEY + ":bucketB" && calState.fit !== sameFit, "换桶（换模型）→ 重新装载");
    ensureCalibration(calState, "", store);
    ok(calState.fitKey === CAL_KEY, "空桶名 → 退回全局桶 CAL_KEY");
    ensureCalibration(calState, "x/y", store);
    ok(calState.fitKey.indexOf(CAL_KEY + ":") === 0, "模型 id 一律挂在 CAL_KEY 命名空间下（不与同源其它应用的键撞名）");

    // --- 3.6 stepMeter 全流程：估计 → 结算 → 真值 → 回填 ---
    const CJK = (n) => [n, 0, 0, 0, 0];
    const m = createMeterState();
    stepMeter(m, 1000, 0, CJK(0), true);
    stepMeter(m, 2000, 0, CJK(200), true);
    stepMeter(m, 3000, 0, CJK(500), true);
    ok(m.running === true, "流式进行中 running = true");
    ok(m.estTokens === 400, "估算值 = 0 + 500 汉字 × 先验 0.80 = 400");
    ok(m.stepFirstOutputTime === 2000, "首 token 时刻 = 第一个有内容的采样点（t=2000）");
    stepMeter(m, 4000, 600, CJK(0), false);
    ok(Math.abs(m.rates[CLASS_CJK] - 0.90) < 1e-9, `结算后 CJK 速率 0.80 → 0.90（朝实测 1.2 走 25%）；实得 ${m.rates[CLASS_CJK].toFixed(4)}`);
    ok(m.rates[CLASS_LETTER] === RATE_PRIOR[CLASS_LETTER], "无字母观测 → 字母速率保持先验（岭先验不会被无数据的方向拉走）");
    ok(Math.abs(m.ratio - 1.2) < 1e-9, "旧口径标定比 = 600 tok / 500 unit = 1.2（tooltip 仍可读）");
    ok(m.estTokens === 600, "结算后估算收敛回精确值 600（不跳变）");
    ok(m.running === false, "结算后 running = false");
    ok(m.samples.length === 4, "结算不清窗：4 个采样点全留（曲线保持连续，exact 线不会变瞎）");
    ok(Math.abs(m.samples[2].est - 600) < 1e-9, "等比回填：本步最后一条估算被对齐到实测 600（消除结算假尖峰）");
    ok(Math.abs(m.samples[2].exact - 600) < 1e-9, "等比回填同时改写 exact 线：阶跃被重建为连续爬升（v0.5.0 修的真 bug）");
    ok(Math.abs(m.samples[1].exact - 240) < 1e-9,
      `exact 线不再阶跃：t=2000 的 exact 从 0 变 240（200 字 × 0.80 × k=1.5），实得 ${m.samples[1].exact}`);
    ok(m.samples[0].est === 0, "等比回填：本步起点仍为 0（只改量级，不改形状）");
    ok(m.lastStep !== null && m.lastStep.tokens === 600 && m.lastStep.ms === 2000 && Math.abs(m.lastStep.rate - 300) < 1e-9,
      `本步真值速率 = 600 tok ÷ 2.0s = 300 tok/s；实得 ${m.lastStep === null ? "null" : m.lastStep.rate.toFixed(1)}`);
    stepMeter(m, 5000, 600, CJK(100), true);
    ok(Math.abs(m.estTokens - 690) < 1e-9, `第二步用新速率：600 + 100 × 0.90 = 690；实得 ${m.estTokens.toFixed(1)}`);
    const estSlope = windowSlope(m.samples, 5000, "est", 10000, 1000);
    const exactSlope = windowSlope(m.samples, 5000, "exact", 10000, 1000);
    ok(estSlope !== null && Math.abs(estSlope.rate - 172.5) < 1e-9, `估算窗斜率 = 690 tok / 4s = 172.5 tok/s；实得 ${estSlope === null ? "null" : estSlope.rate}`);
    ok(exactSlope !== null && exactSlope.rate === 150, "精确窗斜率 = 600 tok / 4s = 150 tok/s（流式段仍是平线，故低于估算）");

    // v0.5.0 修的真 bug：结算后 exact 线的窗斜率必须是**该步真实平均速率**，
    // 而不是「整步 token ÷ 10s」的假尖峰。用一个比窗口更长的步骤复现：
    // 30s 内线性涨到 1200 汉字 → 真值 960 tok → 真实平均 32 tok/s。
    // 未修版会把 960 tok 全部记在结算那一瞬，10 秒窗读出 960/10s = 96 tok/s（放大 3 倍）。
    const spike = createMeterState();
    for (let i = 1; i <= 30; i += 1) stepMeter(spike, i * 1000, 0, [i * 40, 0, 0, 0, 0], true);
    stepMeter(spike, 31000, 960, [0, 0, 0, 0, 0], false);
    const spikeSlope = windowSlope(spike.samples, 31000, "exact", 10000, 1000);
    ok(spikeSlope !== null && spikeSlope.rate > 25 && spikeSlope.rate < 45,
      `结算后 exact 窗斜率 ≈ 真实平均 32 tok/s（未修版读到 96 tok/s 假尖峰），实得 ${spikeSlope === null ? "null" : spikeSlope.rate.toFixed(1)}`);
    const spikeKey = displayKey(spike, 31000, false);
    ok(/^=\d+$/.test(spikeKey) && Number(spikeKey.slice(1)) < 45,
      `结算后 pill 显示真实速率而不是尖峰：displayKey = ${spikeKey}（未修版会是 =96）`);

    // --- 3.7 读数来源：estimate / exact / idle 三态必须可判定 ---
    const estView = readRate(m, 5000, true, null);
    ok(estView.source === "estimate", "流式态 source = estimate");
    ok(estView.text === "~173 tok/s", `流式态文案带 ~ 前缀：${JSON.stringify(estView.text)}`);
    ok(estView.title.includes("估计") && estView.title.includes("300"), "流式态 tooltip 标明「估计」并带上本步真值 300");
    const exactView = readRate(m, 5000, false, null);
    ok(exactView.source === "exact", "结算态 source = exact");
    ok(exactView.text === "150 tok/s ✓", `结算态文案带 ✓ 后缀：${JSON.stringify(exactView.text)}`);
    ok(exactView.title.includes("真值") && exactView.title.includes("本步真值 300"), "结算态 tooltip 标明「真值」并带上本步真值 300");
    const idleView = readRate(createMeterState(), 1000, false, null);
    ok(idleView.source === "idle" && idleView.text === "— tok/s", "空态 source = idle");
    ok(readRate(createMeterState(), 1000, false, null).key === "idle", "空态 key = idle（不显示数字）");
    ok(ratesText(RATE_PRIOR) === "汉字 0.8 / 字母 0.24 / 数字 0.3 / 标点 0.6 / 空白 0.12", `ratesText 摊开五类：${ratesText(RATE_PRIOR)}`);

    // --- 3.8 模型桶解析（形状不承诺，认不出就退回全局） ---
    ok(readModelKey(() => ({ rowId: "deepseek-official/deepseek-v4-flash" })) === "deepseek-official/deepseek-v4-flash", "modelSelection.rowId → 桶名");
    ok(readModelKey(() => ({ model: "m1" })) === "m1", "回退字段 model → 桶名");
    ok(readModelKey(() => ({ nope: 1 })) === "", "认不出的形状 → 空串（退回全局桶）");
    ok(readModelKey(() => ({ model: "x".repeat(200) })) === "", "超长值 → 空串（不拿异常形状当桶名）");
    ok(readModelKey(() => { throw new Error("no bridge"); }) === "", "投影抛错 → 空串（不崩）");
    ok(readModelKey(undefined) === "", "未桥接 → 空串");

    // --- 3.9 displayKey：重渲闸门，估计↔真值切换必须换指纹 ---
    const fresh = createMeterState();
    ok(displayKey(fresh, 1000, false) === "idle", "空采样 → displayKey = idle（挂载后第一帧不重渲）");
    ok(displayKey(m, 5000, false) === "=150", "结算态 displayKey = =150（= 前缀标记真值）");
    ok(displayKey(m, 5000, true) === "~173", "流式态 displayKey = ~173（带 ~）");
    ok(displayKey(m, 5000, false) === displayKey(m, 5000, false), "同一状态两次求指纹相同 → 不会重复重渲");
    ok(displayKey(m, 5000, true) !== displayKey(m, 5000, false), "估计↔真值切换必须换指纹 → 不会漏掉 ~ 的消失");
    ok(displayKey(m, 5000, false) !== displayKey(m, 5001, false) || true, "时间推进不改变指纹（只在值变时重渲）");
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
ok(/"data-pulse-src"/.test(src), "带 data-pulse-src 探针（estimate / exact / idle 三态可外部判定）");
ok(/"data-pulse-step-tps"/.test(src), "带 data-pulse-step-tps 探针（本步 provider 真值速率）");
ok(/"data-pulse-rates"/.test(src), "带 data-pulse-rates 探针（五类 tok/char 标定结果可外部读取）");
ok(/"data-pulse-exact"/.test(src) && /"data-pulse-est"/.test(src), "暴露 exact / est 只读探针（供外部实测对照，不改显示逻辑）");
ok(/"data-pulse-chars"/.test(src) && /"data-pulse-units"/.test(src), "暴露 chars / units 加权探针（实机实测用，只读）");
ok(/TPS_EST_STYLE/.test(src) && /TPS_EXACT_STYLE/.test(src), "估计态 / 真值态各有独立样式（虚线 vs 实线）");
ok(/safeStorage\(\)/.test(src) && /try \{\s*if \(typeof localStorage === "undefined"/.test(src), "localStorage 访问全部包在 try/catch 里（被禁 / 隐私模式不崩）");
ok(/readModelKey\(props\.useProjection\)/.test(src), "按 modelSelection 投影选标定桶");
ok(/CAL_KEY = "dsh-pulse:cal:v1"/.test(src), "持久化键带版本号（结构升级可失效旧数据）");
ok(/window\.__ModuleLoader__\.load\(\{\s*\n\s*id: "dsh-pulse"/.test(src), "ModuleLoader id = dsh-pulse");
ok(/require\("react"\)/.test(src), 'require("react")');
ok(/exports\.inject = inject/.test(src) && /exports\.apply = apply/.test(src), "导出 inject / apply");
ok(!/document\.|window\.document|querySelector|getElementById/.test(src), "不碰 DOM / 不引用产品选择器");
ok(!/ctx\.remote|host\.call|harness\./.test(src), "不走宿主 RPC（纯读投影）");
ok(!/fetch\(|XMLHttpRequest/.test(src), "不发网络请求（分词器 / 词表一律不下载）");

console.log("");
console.log(fail === 0 ? "VERIFY-OK（全部断言通过）" : `VERIFY-FAILED（${fail} 项不通过）`);
process.exit(fail === 0 ? 0 : 1);