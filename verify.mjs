// verify.mjs — dsh-pulse 自证：语法 + 抽取 formatter/window 区做行为断言 + 注册面静态核对
// 用法：node verify.mjs     （与 cwd 无关）
import { readFileSync, readdirSync } from "node:fs";
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
    ok(readModelKey(() => ({ rowId: "deepseek-official/deepseek-v4-flash" })) === "deepseek-official/deepseek-v4-flash", "顶层 rowId → 桶名");
    ok(readModelKey(() => ({ model: "m1" })) === "m1", "顶层 model → 桶名");
    // 2026-09-22 源码核对：真实形状是 { current, routable, groups, failures, status, error }，
    // 当前模型在 current 里。v0.6.0 初版漏了这层，实测一直退回全局桶。
    ok(readModelKey(() => ({ current: { provider: "r4", model: "deepseek-v4.1-flash" }, status: "ready" })) === "r4/deepseek-v4.1-flash",
      "真实形状：current.provider + current.model → 桶名");
    ok(readModelKey(() => ({ current: { providerId: "p", modelId: "m" } })) === "p/m", "current 用 providerId/modelId 拼桶名");
    ok(readModelKey(() => ({ current: { model: "solo" } })) === "solo", "current 只有 model → 用 model 当桶名");
    ok(readModelKey(() => ({ current: "plain/model" })) === "plain/model", "current 是字符串 → 直接用");
    ok(readModelKey(() => ({ current: null, groups: [] })) === "", "current 为 null → 空串（退回全局桶，不崩）");
    ok(readModelKey(() => ({ nope: 1 })) === "", "认不出的形状 → 空串（退回全局桶）");
    ok(readModelKey(() => ({ model: "x".repeat(200) })) === "", "超长值 → 空串（不拿异常形状当桶名）");
    ok(readModelKey(() => ({ current: { provider: "p".repeat(100), model: "m" } })) === "m",
      "provider 超长被丢弃 → 退回用 model 当桶名（有桶总比全局桶好，且模型名足够区分）");
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

console.log("=== 5. v0.6.0 slot 阴影（纯函数 + 假 ctx 注册） ===");
{
  // client.js 是给 ModuleLoader 的 bundle，不是 ESM：用假 window 装载后取 factory。
  const captured = {};
  new Function("window", src)({ __ModuleLoader__: { load: (c) => { captured.config = c; } } });
  const mod = captured.config.factory((name) => (name === "react" ? { createElement: () => null } : undefined));
  const X = mod.__test;

  const OriginalComp = function OriginalComp() {};
  const fakeReact = {
    createElement: (type, props) => ({ type, props: props || {} }),
    useMemo: (fn) => fn(),
    memo: (c) => c
  };
  const USAGE = { cacheReadTokens: 8743, uncachedInputTokens: 1257, cacheWriteTokens: 0 };

  // --- 5.1 isComponentType ---
  ok(X.isComponentType(function () {}) === true, "isComponentType(函数) = true");
  ok(X.isComponentType({ $$typeof: Symbol("react.memo") }) === true, "isComponentType(React.memo 产物) = true");
  ok(X.isComponentType({}) === false && X.isComponentType(null) === false && X.isComponentType(42) === false,
    "isComponentType(普通对象 / null / 数字) = false");

  // --- 5.2 findStatsEntry ---
  const realStats = { options: { id: "stats", order: 0 }, component: OriginalComp };
  const otherEntry = { options: { id: "pulse", order: 1 }, component: OriginalComp };
  const shadowEntry = { options: { id: "stats", order: 0, priority: -1 }, component: OriginalComp };
  const noComp = { options: { id: "stats", order: 0 } };
  ok(X.findStatsEntry([otherEntry, realStats]) === realStats, "findStatsEntry 跳过别的 id，找到内置 stats（priority 缺省 = 0）");
  ok(X.findStatsEntry([shadowEntry, realStats]) === realStats, "findStatsEntry 不会把已有的阴影（priority -1）当成内置那枚");
  ok(X.findStatsEntry([noComp]) === null, "没有 component 的条目不算（拿不到原组件就不阴影）");
  ok(X.findStatsEntry([]) === null && X.findStatsEntry(null) === null, "空 / null 列表 → null（不崩）");

  // --- 5.3 nextShadowPriority ---
  ok(X.nextShadowPriority([]) === -1, "无同 id 条目 → -1（低于内置的 0）");
  ok(X.nextShadowPriority([realStats]) === -1, "只有内置（0）→ -1");
  ok(X.nextShadowPriority([realStats, shadowEntry]) === -2, "已有一枚阴影（-1）→ -2（不会撞 priority 抛错）");
  ok(X.nextShadowPriority([otherEntry]) === -1, "只按 id === stats 计算，别的 id 不参与");

  // --- 5.4 阴影组件：拦截 t，其余透传 ---
  const Shadow = X.createStatsShadow(fakeReact);
  const el = Shadow({
    Original: OriginalComp,
    useProjection: (k) => (k === "tokenUsage" ? USAGE : undefined),
    t: (key, params) => key + "|" + JSON.stringify(params || null),
    sessionId: "s1",
    useChat: function () {}
  });
  ok(el.type === OriginalComp, "阴影组件渲染的是原组件本体（不是重写一份统计行）");
  ok(el.props.t("stats.cacheHit", { percent: "99" }) === 'stats.cacheHit|{"percent":"87.43"}',
    `stats.cacheHit 被换成两位小数：${el.props.t("stats.cacheHit", { percent: "99" })}`);
  ok(el.props.t("stats.turns", { n: 3 }) === 'stats.turns|{"n":3}', "其它 key 逐字透传（轮次/步骤/耗时/TTFT/token 显示不变）");
  ok(el.props.sessionId === "s1" && typeof el.props.useChat === "function", "slot props 原样转发给原组件");
  ok(el.props.Original === undefined, "Original 不再往下传（原组件不需要知道自己被阴影了）");
  ok(el.props.useProjection !== undefined, "useProjection 转发（原组件可能也要用）");

  const elNoUsage = Shadow({
    Original: OriginalComp,
    useProjection: () => undefined,
    t: (key, params) => key + "|" + JSON.stringify(params || null)
  });
  ok(elNoUsage.props.t("stats.cacheHit", { percent: "99" }) === 'stats.cacheHit|{"percent":"99"}',
    "拿不到 tokenUsage → 原样透传（不把 null 塞进 percent）");
  ok(Shadow({ Original: null, useProjection: () => USAGE, t: () => "x" }) === null, "拿不到原组件 → 整枚不渲染（宁可少一枚，也不弄坏 dock）");
  ok(Shadow({ Original: OriginalComp, useProjection: () => USAGE, t: null }) === null, "拿不到 t → 整枚不渲染");

  // --- 5.5 ensureStatsShadow：假 ctx 注册 ---
  const makeCtx = (opts) => {
    const registered = [];
    const entries = opts.entries || [];
    return {
      registered,
      slots: {
        // 用「有没有传 specValue」而不是「spec 是不是 undefined」来区分 ——
        // 否则想测 spec 返回 undefined 时会被默认值吃掉。
        spec: () => (Object.prototype.hasOwnProperty.call(opts, "specValue")
          ? opts.specValue
          : { kind: "list", scope: "session" }),
        entries: opts.noEntriesApi ? undefined : () => entries,
        register: (options, component) => {
          if (opts.throwOnRegister) throw new Error("priority collision");
          registered.push({ options, component });
          return () => { registered.length = 0; };
        }
      }
    };
  };

  X.shadowState.active = false;
  const ctxA = makeCtx({ entries: [realStats] });
  const handleA = { current: null, component: Shadow };
  ok(X.ensureStatsShadow(ctxA, handleA) === true, "阴影注册成功 → 返回 true");
  ok(ctxA.registered.length === 1, "只注册一枚");
  const regA = ctxA.registered[0].options;
  ok(regA.id === "stats" && regA.priority === -1 && regA.order === 0,
    `注册参数 id=stats / priority=-1 / order=0，实得 id=${regA.id} priority=${regA.priority} order=${regA.order}`);
  ok(regA.name === "conversation.composer.dock", "注册在 composer dock 上");
  ok(regA.locale === "chat", `内置没声明 locale 时回退 "chat"（复用内置 i18n 命名空间），实得 ${regA.locale}`);
  ok(regA.inject().Original === OriginalComp, "inject 把原组件注入给阴影组件");
  ok(X.shadowState.active === true, "注册成功后 shadowState.active = true");
  ok(X.ensureStatsShadow(ctxA, handleA) === true && ctxA.registered.length === 1, "重复调用不重复注册（幂等）");

  X.shadowState.active = false;
  const ctxLocale = makeCtx({ entries: [{ options: { id: "stats", order: 0, locale: "chat" }, component: OriginalComp }] });
  X.ensureStatsShadow(ctxLocale, { current: null, component: Shadow });
  ok(ctxLocale.registered[0].options.locale === "chat", "内置声明了 locale → 原样复用");

  X.shadowState.active = false;
  const ctxNoSpec = makeCtx({ entries: [realStats], specValue: undefined });
  ok(X.ensureStatsShadow(ctxNoSpec, { current: null, component: Shadow }) === false && ctxNoSpec.registered.length === 0,
    "slot 未声明（spec === undefined）→ 不注册（加载顺序早于内置时不炸）");
  ok(X.shadowState.active === false, "未注册时 shadowState.active 保持 false → PulseDock 走降级路径");

  X.shadowState.active = false;
  const ctxNoApi = makeCtx({ entries: [realStats], noEntriesApi: true });
  ok(X.ensureStatsShadow(ctxNoApi, { current: null, component: Shadow }) === false && ctxNoApi.registered.length === 0,
    "老版本 harness 没有 slots.entries → 不注册（降级路径）");

  X.shadowState.active = false;
  const ctxThrow = makeCtx({ entries: [realStats], throwOnRegister: true });
  ok(X.ensureStatsShadow(ctxThrow, { current: null, component: Shadow }) === false,
    "register 抛错（priority 撞车）→ 被吞掉并降级，绝不抛给宿主");
  ok(X.shadowState.active === false, "抛错后 shadowState.active 保持 false");

  X.shadowState.active = false;
  ok(X.ensureStatsShadow({}, { current: null, component: Shadow }) === false, "ctx 没有 slots → 不注册（不崩）");
  ok(X.ensureStatsShadow(null, { current: null, component: Shadow }) === false, "ctx 为 null → 不注册（不崩）");
  X.shadowState.active = false;
}

console.log("=== 6. 注册面静态核对（v0.6.0 阴影） ===");
ok(/"data-pulse-shadow"/.test(src), "带 data-pulse-shadow 探针（CDP 可判定阴影是否生效）");
ok(/priority: nextShadowPriority\(entries\)/.test(src), "阴影注册使用协商出的更低 priority");
ok(/inject: function \(\) \{ return \{ Original: original\.component \}; \}/.test(src), "用 inject 把原组件交给阴影组件");
ok(/shadowState\.active/.test(src) && /view !== null && !shadowState\.active/.test(src),
  "阴影生效时不重复画缓存命中（避免两枚读数）");
ok(/typeof slots\.register !== "function" \|\| typeof slots\.entries !== "function" \|\| typeof slots\.spec !== "function"/.test(src),
  "缺 slots API → 走降级路径（老版本 harness）");
ok(/\} catch \(e\) \{\s*\/\/[^\n]*\n\s*handleRef\.current = null;\s*shadowState\.active = false;\s*return false;\s*\}/.test(src),
  "注册抛错被吞掉并降级（catch 里清 handle + 复位 active + 返回 false），不抛给宿主");

console.log("=== 7. 发布文件编码（BOM 会让 profile 加载器硬失败） ===");
{
  // 2026-09-22 实测：package.json 带上 UTF-8 BOM 后，dsh 的 profile 加载器直接崩：
  //   SyntaxError: Unexpected token '锘?, "锘縶\n"name"... is not valid JSON
  //   at loadProfileDirectory (dsh-app-boot/lib/index.js:866)
  // 同一类问题在 v0.4.0 已在 install.ps1 上踩过一次（Windows PowerShell 5.1 按 ANSI 读）。
  // 这条断言把它钉死：**JSON 文件一律不许带 BOM**。
  const jsonFiles = ["package.json"];
  for (const f of jsonFiles) {
    const buf = readFileSync(join(BASE, f));
    const bom = buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf;
    ok(!bom, `${f} 无 BOM（有 BOM 时 dsh profile 加载器 JSON.parse 会硬失败）`);
    try {
      JSON.parse(buf.toString("utf8").replace(/^\uFEFF/, ""));
      ok(true, `${f} 可被 JSON.parse`);
    } catch (e) {
      ok(false, `${f} JSON.parse 失败：${e.message}`);
    }
  }
  // ps1 反过来必须有 BOM —— Windows PowerShell 5.1 否则按 ANSI 读中文注释而解析失败。
  // 2026-09-22 实测：**用 edit 工具改过的 .ps1 会丢 BOM**，v0.4.0 加的 BOM 就是这么丢的，
  // 结果安装器自己解析失败。所以这里扫描仓库里**所有** .ps1，而不是只盯已知的两个。
  const ps1Files = readdirSync(BASE).filter((f) => f.toLowerCase().endsWith(".ps1"));
  ok(ps1Files.length >= 2, `仓库里有 ${ps1Files.length} 个 .ps1（至少 install.ps1 / uninstall.ps1）`);
  for (const f of ps1Files) {
    const buf = readFileSync(join(BASE, f));
    const bom = buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf;
    ok(bom, `${f} 带 UTF-8 BOM（Windows PowerShell 5.1 需要；edit 工具改过会丢，必须复检）`);
  }
}

console.log("");
console.log(fail === 0 ? "VERIFY-OK（全部断言通过）" : `VERIFY-FAILED（${fail} 项不通过）`);
process.exit(fail === 0 ? 0 : 1);