/* dsh-pulse · client half
 * 在 composer dock 做两件事：
 *   1) 用 slot 阴影**顶替**内置统计行，把「缓存命中」换成两位小数（v0.6.0）；
 *   2) 另加一枚只读的「10 秒滑窗平均输出速度 tok/s」读数。
 *
 * v0.6.0 的阴影（本插件最重要的一次架构变化）：
 *   同 id "stats" + 更低的 priority 注册一个阴影条目 → 顶替内置那枚；
 *   阴影组件把原组件 `Original` 原样渲染（轮次/步骤/耗时/TTFT/token 全不变），
 *   只把 `t` 换成拦截版，把 `stats.cacheHit` 的 percent 改成两位小数。
 *   **页面上因此只有一枚缓存命中读数**，而不是 v0.5.0 的「99% + 99.87%」两枚。
 *   阴影不可用（老版本 harness / 注册失败）时自动降级：本插件补上自己那一枚。
 *   机制与源码证据见 TECHNIQUES.md。
 *
 * 速度读数的两条数据线（口径写死在 title 里，不混报）：
 *   精确线 —— sessionStats.decodeTokens 的墙钟斜率。该计数只在 assistant/message 落盘
 *             （即步骤结算、provider 上报 usage）时前进，所以流式进行中它是平的。
 *             显示为 `41.8 tok/s ✓` + 实线高对比边。
 *   估算线 —— 流式进行中改读 legacy.partial（客户端独有的 assistant/live-chunk 折叠）
 *             的实时文本增量，按五类字符的在线标定折算；显示为 `~42.1 tok/s` + 虚线降透明。
 *             步骤一结算，估算线立刻收敛回精确线（同一根累计曲线，不会跳变）。
 *
 * v0.5.0 引入的三件事（保留）：
 *   1) 估计 / 真值视觉分离：`~` vs `✓`、虚线 vs 实线，并新增 data-pulse-src 探针。
 *   2) 每个步骤结算瞬间给出「本步真值速率」，写进 tooltip 与 data-pulse-step-tps。
 *   3) 五类字符（CJK/字母/数字/标点/空白）带岭先验的在线最小二乘标定，按模型 id
 *      持久化到 localStorage；结算时两条线共用同一条重建曲线（消除阶跃假尖峰）。
 *
 * 物理边界（源码核对，2026-09-22）：流式进行中拿不到真值 token 数。
 *   - 唯一来源是 provider 的 usage.outputTokens，见 dsh-session-stats 的 projection：
 *     只在 case 'assistant/message' 里 decodeTokens += outputTokens。
 *   - 该 usage 只随 finish chunk / 尾部 usage-only chunk 到达，见 dsh-llm-deepseek
 *     `stream_options: { include_usage: true }`。
 *   - harness 自身没有分词器（dsh-token-meter 用 CHARS_PER_TOKEN = 4 估），
 *     所以插件侧也无法对流式文本做精确分词。
 *   因此流中一律是估计值，且必须带 `~` 标记 —— 这是协议边界，不是实现取舍。
 *
 * 为什么是「另加一枚」而不是改内置那枚 —— 见 README「能力边界」：
 *   内置百分比在 @deepseek-ai/dsh-client-ui-chat 模块内部就四舍五入完（formatCacheHitPercent
 *   不导出），i18n 拿到的已是字符串，且 conversation.composer.dock 是 list 型 slot
 *   （renderer 全量渲染，同 id 同 priority 注册直接抛错）—— 插件没有可顶替的席位。
 *
 * 只读 useProjection("tokenUsage")：不写宿主、不碰 DOM、不引用产品 CSS 类名。
 */
window.__ModuleLoader__.load({
  id: "dsh-pulse",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

    var react = require("react");

    var inject = ["slots", "locale"];
    var NS = "ui-pulse";
    var DP = 2; // 小数位数：用户令「缓存命中要精确到小数点后两位数」

    // #region formatter
    // 与内置同源同规则的百分比取整：正整数单位 + 正逢五进一；诚实分支保证
    // 「部分命中绝不显示 100」。verify.mjs 按本区标记抽取做单测 —— 勿改标记。
    function roundedPercentUnits(cacheReadTokens, denominator, decimalPlaces) {
      const scale = Math.pow(10, decimalPlaces) * 100;
      const doubledScale = scale * 2;
      const denominatorQuotient = Math.floor(denominator / doubledScale);
      const denominatorRemainder = denominator % doubledScale;
      let lower = 0;
      let upper = scale;
      while (lower < upper) {
        const candidate = Math.floor((lower + upper + 1) / 2);
        const factor = candidate * 2 - 1;
        if (cacheReadTokens >= factor * denominatorQuotient + Math.ceil(factor * denominatorRemainder / doubledScale)) lower = candidate;
        else upper = candidate - 1;
      }
      return lower;
    }
    function displayPercentUnits(units, decimalPlaces) {
      if (decimalPlaces === 0) return String(units);
      const perUnit = Math.pow(10, decimalPlaces);
      const whole = Math.floor(units / perUnit);
      const fraction = units % perUnit;
      return fraction === 0 ? String(whole) : `${whole}.${String(fraction).padStart(decimalPlaces, "0")}`;
    }
    function formatCacheHitPercent(cacheReadTokens, promptTokens, decimalPlaces) {
      if (!(promptTokens > 0)) return null;
      const missedInputTokens = promptTokens - cacheReadTokens;
      if (missedInputTokens === 0) return "100";
      const roundedUnits = roundedPercentUnits(cacheReadTokens, promptTokens, decimalPlaces);
      if (roundedUnits < 100 * Math.pow(10, decimalPlaces)) return displayPercentUnits(roundedUnits, decimalPlaces);
      let distinguishingPlaces = 1;
      let scaledDoubleGap = missedInputTokens * 200;
      const denominatorTens = Math.floor(promptTokens / 10);
      while (scaledDoubleGap <= denominatorTens) {
        scaledDoubleGap *= 10;
        distinguishingPlaces += 1;
      }
      const denominatorOnes = promptTokens % 10;
      let roundedLoss = 5;
      for (let loss = 1; loss < 5; loss += 1) {
        const factor = loss * 2 + 1;
        const threshold = factor * denominatorTens + Math.floor(factor * denominatorOnes / 10);
        if (scaledDoubleGap <= threshold) {
          roundedLoss = loss;
          break;
        }
      }
      return `99.${"9".repeat(distinguishingPlaces - 1)}${10 - roundedLoss}`;
    }
    // #endregion

    // #region shadow
    // v0.6.0：用 slot 阴影**顶替**内置统计行，把缓存命中换成两位小数。
    //
    // 这推翻了 v0.5.0 之前 README《二、能力边界》的结论（「list 型没有可顶替的席位」）。
    // 源码证据（dsh-client-ui-slots/lib/index.js）：
    //   L130  list 型按 (priority ?? 0) 升序、再按 (order ?? 0) 升序排序；
    //   投影   entriesOfSlot 取每个 cell 的第一个存活条目，list 的 cell = entry.options.id；
    //   守卫   同 id + 同 priority → 抛错，提示原文 "register at a different priority to shadow it (lowest renders)"；
    //   内置   { id: "stats", order: 0 }，没有 priority → 默认 0（dsh-client-ui-chat L8349）。
    // 所以「同 id + 更低 priority」即可胜出；且渲染侧只画胜出者（dsh-client-ui-renderer L850-868），
    // 落选条目根本不会被渲染 —— 页面上不会出现两枚缓存命中读数。
    //
    // 阴影组件把原组件 `Original` 原样渲染（轮次/步骤/耗时/TTFT/token 全部不变），
    // 只替换 `t`：拦截 `stats.cacheHit`，把 percent 换成我们自己的两位小数实现。
    // verify.mjs 按本区标记抽取做单测 —— 勿改标记。

    var STATS_SLOT = "conversation.composer.dock";
    var STATS_ID = "stats";
    var STATS_KEY = "stats.cacheHit";
    var STATS_NS_FALLBACK = "chat";
    var ORIGINAL_PRIORITY = 0;

    /** 阴影是否已接管内置统计行。PulseDock 靠它决定要不要再画一枚缓存命中（降级用）。 */
    var shadowState = { active: false };

    /** 原组件可能是函数，也可能是 React.memo 的产物（带 $$typeof 的对象）。 */
    function isComponentType(value) {
      return typeof value === "function"
        || (typeof value === "object" && value !== null && value.$$typeof !== undefined);
    }

    /**
     * 在原始条目列表里找内置统计行：id === "stats" 且 priority === 0 且有组件。
     * @returns 条目对象，找不到返回 null。
     */
    function findStatsEntry(entries) {
      if (!entries || typeof entries.length !== "number") return null;
      for (var i = 0; i < entries.length; i += 1) {
        var entry = entries[i];
        if (!entry || !entry.options || !entry.component) continue;
        if (entry.options.id !== STATS_ID) continue;
        if ((entry.options.priority === undefined ? ORIGINAL_PRIORITY : entry.options.priority) !== ORIGINAL_PRIORITY) continue;
        return entry;
      }
      return null;
    }

    /**
     * 下一个阴影优先级 = 现有同 id 条目的最低 priority - 1。
     * 取 min 再减一，保证与任何已存在的阴影都不撞（同 id 同 priority 注册会抛错）。
     */
    function nextShadowPriority(entries) {
      var min = ORIGINAL_PRIORITY;
      if (entries && typeof entries.length === "number") {
        for (var i = 0; i < entries.length; i += 1) {
          var entry = entries[i];
          if (!entry || !entry.options || entry.options.id !== STATS_ID) continue;
          var priority = entry.options.priority;
          if (typeof priority === "number" && isFinite(priority) && priority < min) min = priority;
        }
      }
      return min - 1;
    }

    /**
     * 造阴影组件。`Original` 由 register 的 inject 注入。
     * 拦截 `t` 只改 `stats.cacheHit`；其余 key 一律透传，所以原统计行的
     * 轮次 / 步骤 / 耗时 / TTFT / token 显示逐字不变。
     */
    function createStatsShadow(react) {
      function StatsShadow(props) {
        var Original = props.Original;
        var useProjection = props.useProjection;
        var t = props.t;
        var usage = typeof useProjection === "function" ? useProjection("tokenUsage") : undefined;
        var view = computeView(usage);
        var percent = view === null ? null : view.percent;

        var patchedT = typeof react.useMemo === "function"
          ? react.useMemo(function () {
            return function (key, params) {
              if (key !== STATS_KEY || percent === null) return typeof t === "function" ? t(key, params) : key;
              return typeof t === "function" ? t(key, { percent: percent }) : percent;
            };
          }, [t, percent])
          : function (key, params) {
            if (key !== STATS_KEY || percent === null) return typeof t === "function" ? t(key, params) : key;
            return typeof t === "function" ? t(key, { percent: percent }) : percent;
          };

        // 拿不到原组件 / 拿不到 t 就整枚不渲染（宁可少一枚读数，也不弄坏 dock）。
        if (!isComponentType(Original)) return null;
        if (typeof t !== "function") return null;

        var forwarded = {};
        for (var name in props) {
          if (!Object.prototype.hasOwnProperty.call(props, name)) continue;
          if (name === "Original" || name === "t") continue;
          forwarded[name] = props[name];
        }
        forwarded.useProjection = useProjection;
        forwarded.t = patchedT;
        return react.createElement(Original, forwarded);
      }
      return typeof react.memo === "function" ? react.memo(StatsShadow) : StatsShadow;
    }

    /**
     * 尝试注册阴影。幂等：已注册或环境不支持时直接返回。
     * @returns true 表示阴影已生效（或本次注册成功）。
     */
    function ensureStatsShadow(ctx, handleRef) {
      var slots = ctx && ctx.slots;
      if (!slots || handleRef.current !== null) return shadowState.active;
      if (typeof slots.register !== "function" || typeof slots.entries !== "function" || typeof slots.spec !== "function") {
        return false; // 老版本 harness：没有这三个 API → 走降级路径
      }
      try {
        if (slots.spec(STATS_SLOT) === undefined) return false;
        var entries = slots.entries(STATS_SLOT);
        var original = findStatsEntry(entries);
        if (original === null) return false;
        handleRef.current = slots.register({
          name: STATS_SLOT,
          id: STATS_ID,
          priority: nextShadowPriority(entries),
          order: 0,
          locale: (original.options && original.options.locale) || STATS_NS_FALLBACK,
          inject: function () { return { Original: original.component }; }
        }, handleRef.component);
        shadowState.active = true;
        return true;
      } catch (e) {
        // 注册失败（撞 priority / slot 未声明 / 老版本不认识 inject）→ 降级，不抛给宿主。
        handleRef.current = null;
        shadowState.active = false;
        return false;
      }
    }
    // #endregion

    // #region window
    // 10 秒滑窗速率：纯算术，不碰 React/DOM。verify.mjs 按本区标记抽取做单测 —— 勿改标记。

    var WINDOW_MS = 10000;   // 滑窗长度：用户令「10s 内的平均输出速度」
    var SAMPLE_MS = 500;     // 采样间隔
    var MIN_SPAN_MS = 1000;  // 跨度不足 1s 不出数（两点斜率不可信）
    var RETAIN_MS = WINDOW_MS * 2; // 环形缓冲保留两倍窗长，够取窗沿锚点
    var RATIO_MIN = 0.05;    // tok/unit 标定下界
    var RATIO_MAX = 8;       // tok/unit 标定上界
    var NON_CJK_WEIGHT = 0.42; // 非 CJK 字符折成多少 unit（1 CJK 字符 = 1 unit）
    // RATIO_SEED 只作为「五类回归不可用」时的兜底标量（旧口径），
    // 与加权 unit 口径配套：纯中文 ≈ 0.80 tok/unit。
    // 2026-09-22 实机实测（gen4-lab 真实 DSH web，四次独立回答，产品权威值对照）：
    // 真实比 0.801 / 0.824 / 0.799 / 0.816 tok/unit —— 种子 0.80 与之相差 −0.1% ~ −2.9%。
    // v0.5.0 起估算主路径改走 RATE_PRIOR 五类回归；本值保留给 countsUnits 口径的 tooltip 读数与旧断言。
    var RATIO_SEED = 0.80;

    // --- v0.5.0：五类字符在线最小二乘标定 -----------------------------------
    // 单一标量比只在「同一种文体」下准；中英混排 / 代码 / 数字多的回答会偏。
    // 这里把正文拆成五类字符，各带一个 tok/char 先验，用带岭先验的在线最小二乘
    // 从本会话（以及 localStorage 里的历史会话）的结算数据里学。
    var CLASS_COUNT = 5;
    var CLASS_CJK = 0;       // 汉字 / 假名 / 谚文
    var CLASS_LETTER = 1;    // 拉丁字母
    var CLASS_DIGIT = 2;     // 数字
    var CLASS_PUNCT = 3;     // 标点与符号（含非 ASCII 杂项）
    var CLASS_SPACE = 4;     // 空白（空格 / 换行 / 制表）
    // 分类按 charCode 判定（见 classOfCode）—— 不在这里留正则，避免两套口径漂移。
    // 先验 tok/char。**字母 0.24 与汉字 0.80 是实测值**，不是推的：
//   - 汉字 0.80：v0.4.x 四轮中文实测的加权 unit 比 0.801/0.824/0.799/0.816；
//   - 字母 0.24：2026-09-22 v0.5.0 实测 —— 一篇纯英文回答 chars=2855、真值 682 tok → 0.2389 tok/char。
//     （v0.4.x 的 0.34 是「0.42 权重 × 0.80 种子」反推出来的，从未独立测过，实测证明它偏高 42%。）
// 其余三类暂无独立实测，按中英文标点的实际 tokenizer 行为取值：中文标点几乎逐字成 token（0.60），
// 英文空格常与后词合并（0.12），数字常 1~3 位成 token（0.30）。它们由岭回归在会话中继续修正。
var RATE_PRIOR = [0.80, 0.24, 0.30, 0.60, 0.12];
    var RATE_MIN = 0.02;
    var RATE_MAX = 2;
    // 岭先验的等效步数：λ = RIDGE_STEPS × Σ|x|²。3 步之内解基本贴着先验，
    // 之后逐步让位给实测 —— 单步数据解不出 5 个未知数时也不会解出荒唐值。
    var RIDGE_STEPS = 3;
    var CAL_KEY = "dsh-pulse:cal:v1";
    var CAL_VERSION = 1;

    function nonNeg(value) {
      return typeof value === "number" && isFinite(value) && value >= 0 ? value : 0;
    }

    /** 追加一个采样点并丢掉窗外旧点（原地改数组，返回同一个数组）。 */
    function pushSample(samples, t, exact, est, retainMs) {
      samples.push({ t: t, exact: exact, est: est });
      var floor = t - retainMs;
      var drop = 0;
      while (drop < samples.length - 2 && samples[drop + 1].t <= floor) drop += 1;
      if (drop > 0) samples.splice(0, drop);
      return samples;
    }

    /** 取窗内最老的点作为锚（保留紧邻窗外那点，让跨度尽量贴近窗长）。 */
    function windowAnchor(samples, now, windowMs) {
      var edge = now - windowMs;
      var i = 0;
      while (i < samples.length - 2 && samples[i + 1].t <= edge) i += 1;
      return samples[i];
    }

    /** 窗内某计数器的墙钟斜率。样本不足 / 计数器回退 → null（不猜）。 */
    function windowSlope(samples, now, field, windowMs, minSpanMs) {
      if (!samples || samples.length < 2) return null;
      var anchor = windowAnchor(samples, now, windowMs);
      var last = samples[samples.length - 1];
      var spanMs = last.t - anchor.t;
      if (!(spanMs >= minSpanMs)) return null;
      var delta = last[field] - anchor[field];
      if (!isFinite(delta) || delta < 0) return null;
      return { rate: delta / (spanMs / 1000), tokens: delta, spanMs: spanMs, points: samples.length };
    }

    /** 与产品 formatTokensPerSecond 同款：≥10 取整，<10 保留一位小数。 */
    function formatRate(rate) {
      if (typeof rate !== "number" || !isFinite(rate) || rate < 0) return null;
      return rate >= 10 ? String(Math.round(rate)) : String(Math.round(rate * 10) / 10);
    }

    /**
     * 本帧「会被看到的东西」的指纹：流式态带 ~ 前缀，无输出为 idle。
     * 采样循环拿它和上一帧比 —— 值没变就不 setState，空闲时渲染次数为 0。
     * 采样本身不停（10 秒窗必须持续滑动），但一次采样只是几十个数字的算术。
     */
    function displayKey(state, now, streaming) {
      var slope = windowSlope(state.samples, now, streaming ? "est" : "exact", WINDOW_MS, MIN_SPAN_MS);
      if (slope === null || !(slope.rate > 0)) return "idle";
      var rate = formatRate(slope.rate);
      if (rate === null) return "idle";
      // 前缀进 key：估计→真值的那一次切换本身必须触发重渲（旧版用空串，切换不可见）。
      return (streaming ? "~" : "=") + rate;
    }

    /** 标定比（tok / unit）：步骤结算后用「本步精确 tokens ÷ 本步加权字符数」重算，越界则保持旧值。 */
    function calibrateRatio(units, tokens, previous) {
      if (!(units > 0) || !(tokens > 0)) return previous;
      var ratio = tokens / units;
      if (!isFinite(ratio) || ratio <= 0) return previous;
      if (ratio < RATIO_MIN) return RATIO_MIN;
      if (ratio > RATIO_MAX) return RATIO_MAX;
      return ratio;
    }

    // --- v0.5.0 分类标定：纯算术，verify.mjs 按本区标记抽取做单测 ------------

    /**
     * 单字符分类（0..4）。按 charCode 判定而不是正则 —— 采样每 500ms 要扫一遍全文，
     * 四轮正则每字符的代价是可测的（实测 0.41 µs/拍 vs 0.22 µs/拍），charCode 比较便宜一个量级。
     * 代理对（emoji 等增补平面）两枚都落到标点类，与旧正则口径一致。
     */
    function classOfCode(code) {
      if (code >= 0x30 && code <= 0x39) return CLASS_DIGIT;
      if ((code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a)) return CLASS_LETTER;
      if (code === 0x20 || (code >= 0x09 && code <= 0x0d) || code === 0xa0 || code === 0x3000) return CLASS_SPACE;
      if ((code >= 0x4e00 && code <= 0x9fff) || (code >= 0x3400 && code <= 0x4dbf)
        || (code >= 0xf900 && code <= 0xfaff) || (code >= 0x3040 && code <= 0x30ff)
        || (code >= 0xac00 && code <= 0xd7af)) return CLASS_CJK;
      return CLASS_PUNCT;
    }

    /** 单字符分类（0..4）。非 ASCII 且非 CJK 的杂项按标点记。 */
    function classOf(ch) {
      if (typeof ch !== "string" || ch.length === 0) return CLASS_PUNCT;
      return classOfCode(ch.charCodeAt(0));
    }

    /** 把一段文本数成五类字符计数。into 可复用以省分配。 */
    function countClasses(text, into) {
      var counts = into || [0, 0, 0, 0, 0];
      if (typeof text !== "string") return counts;
      for (var i = 0; i < text.length; i += 1) counts[classOfCode(text.charCodeAt(i))] += 1;
      return counts;
    }

    /** 五类计数求和。 */
    function countsTotal(counts) {
      var total = 0;
      for (var i = 0; i < CLASS_COUNT; i += 1) total += nonNeg(counts[i]);
      return total;
    }

    /** 五类计数按 v0.4.x 的加权口径折成 unit（只给 tooltip 的 ratio 读数用）。 */
    function countsUnits(counts) {
      var units = 0;
      for (var i = 0; i < CLASS_COUNT; i += 1) {
        var n = nonNeg(counts[i]);
        units += i === CLASS_CJK ? n : n * NON_CJK_WEIGHT;
      }
      return units;
    }

    /** 估算累计输出 tokens = 本步起点精确值 + Σ(该类字符数 × 该类 tok/char)。 */
    function estimateTokens(stepStartTokens, counts, rates) {
      var total = nonNeg(stepStartTokens);
      for (var i = 0; i < CLASS_COUNT; i += 1) {
        var rate = rates && rates[i] > 0 ? rates[i] : RATE_PRIOR[i];
        total += nonNeg(counts[i]) * rate;
      }
      return total;
    }

    /** 岭回归累加器：xx = Σ x xᵀ（CLASS_COUNT² 个数，行主序），xy = Σ x·y，s = Σ |x|²，n = 观测步数。 */
    function createFit() {
      var xx = [];
      for (var i = 0; i < CLASS_COUNT * CLASS_COUNT; i += 1) xx.push(0);
      return { xx: xx, xy: [0, 0, 0, 0, 0], s: 0, n: 0 };
    }

    /**
     * 把一次步骤结算喂进累加器（原地改）。
     * 设计矩阵行 x = 该步五类字符数，观测 y = 该步 provider 上报的精确产出 tokens。
     */
    function fitAdd(fit, counts, tokens) {
      if (!(tokens > 0) || !(countsTotal(counts) > 0)) return fit;
      var i, j, norm = 0;
      for (i = 0; i < CLASS_COUNT; i += 1) {
        var xi = nonNeg(counts[i]);
        fit.xy[i] += xi * tokens;
        norm += xi * xi;
        for (j = 0; j < CLASS_COUNT; j += 1) {
          fit.xx[i * CLASS_COUNT + j] += xi * nonNeg(counts[j]);
        }
      }
      fit.s += norm;
      fit.n += 1;
      return fit;
    }

    /** 高斯消元（列主元）解 n×n 线性方程组；奇异 / 非有限解返回 null。 */
    function solveLinear(flat, rhs, n) {
      var m = [];
      var i, j;
      for (i = 0; i < n; i += 1) {
        var row = [];
        for (j = 0; j < n; j += 1) row.push(flat[i * n + j]);
        row.push(rhs[i]);
        m.push(row);
      }
      for (var col = 0; col < n; col += 1) {
        var pivot = col;
        for (var r = col + 1; r < n; r += 1) {
          if (Math.abs(m[r][col]) > Math.abs(m[pivot][col])) pivot = r;
        }
        if (!(Math.abs(m[pivot][col]) > 1e-9)) return null;
        var swap = m[col];
        m[col] = m[pivot];
        m[pivot] = swap;
        for (var r2 = col + 1; r2 < n; r2 += 1) {
          var factor = m[r2][col] / m[col][col];
          if (factor === 0) continue;
          for (var c = col; c <= n; c += 1) m[r2][c] -= factor * m[col][c];
        }
      }
      var out = [];
      for (var k = n - 1; k >= 0; k -= 1) {
        var sum = m[k][n];
        for (var c2 = k + 1; c2 < n; c2 += 1) sum -= m[k][c2] * out[c2];
        out[k] = sum / m[k][k];
      }
      return out;
    }

    /**
     * 由累加器解出五类 tok/char。
     * 岭先验权重 λ = RIDGE_STEPS × (Σ|x|² / 观测步数)：先验等价于 RIDGE_STEPS 步数据，
     * 所以数据每多一步就让位一分（1 步时先验占 3/4，3 步时一半，24 步时约 1/8）。
     * 注意不能拿 Σ|x|² 直接当 λ —— 那样先验权重会随步数一起涨，解永远贴着先验不动。
     * λ>0 保证对角被撑开，解永远存在；越界值夹回 [RATE_MIN, RATE_MAX]。
     */
    function fitRates(fit, prior) {
      var base = prior || RATE_PRIOR;
      // 零观测直接返回先验：省一次 5×5 消元，也避免消元引入的浮点尾数
      // （0.8000000000000002）漏进 data-pulse-rates 这类对外探针。
      if (!(fit.n > 0)) return base.slice();
      var steps = fit.n;
      var lambda = RIDGE_STEPS * Math.max(fit.s / steps, 1);
      var flat = [];
      var rhs = [];
      for (var i = 0; i < CLASS_COUNT; i += 1) {
        for (var j = 0; j < CLASS_COUNT; j += 1) {
          flat.push(fit.xx[i * CLASS_COUNT + j] + (i === j ? lambda : 0));
        }
        var anchor = base[i] > 0 ? base[i] : RATE_PRIOR[i];
        rhs.push(fit.xy[i] + lambda * anchor);
      }
      var solved = solveLinear(flat, rhs, CLASS_COUNT);
      if (solved === null) return base.slice();
      var out = [];
      for (var k = 0; k < CLASS_COUNT; k += 1) {
        var v = solved[k];
        if (!isFinite(v) || v <= 0) v = RATE_PRIOR[k];
        out.push(v < RATE_MIN ? RATE_MIN : (v > RATE_MAX ? RATE_MAX : v));
      }
      return out;
    }

    /** 读取持久化的累加器；无 storage / 版本不符 / 结构损坏 → 全新累加器（绝不抛）。 */
    function loadFit(storage, key) {
      try {
        if (!storage || typeof storage.getItem !== "function") return createFit();
        var raw = storage.getItem(key);
        if (typeof raw !== "string" || raw === "") return createFit();
        var parsed = JSON.parse(raw);
        if (!parsed || parsed.v !== CAL_VERSION) return createFit();
        if (!parsed.xx || parsed.xx.length !== CLASS_COUNT * CLASS_COUNT) return createFit();
        if (!parsed.xy || parsed.xy.length !== CLASS_COUNT) return createFit();
        var fit = createFit();
        for (var i = 0; i < fit.xx.length; i += 1) fit.xx[i] = nonNeg(parsed.xx[i]);
        for (var j = 0; j < fit.xy.length; j += 1) fit.xy[j] = nonNeg(parsed.xy[j]);
        fit.s = nonNeg(parsed.s);
        fit.n = nonNeg(parsed.n);
        return fit;
      } catch (e) {
        return createFit();
      }
    }

    /** 写回累加器；任何异常（配额 / 被禁 / 无 storage）都吞掉 —— 持久化是增强，不是依赖。 */
    function saveFit(storage, key, fit) {
      try {
        if (!storage || typeof storage.setItem !== "function") return false;
        storage.setItem(key, JSON.stringify({ v: CAL_VERSION, xx: fit.xx, xy: fit.xy, s: fit.s, n: fit.n }));
        return true;
      } catch (e) {
        return false;
      }
    }

    /** 取 localStorage；被禁（隐私模式 / 沙箱）时返回 null。 */
    function safeStorage() {
      try {
        if (typeof localStorage === "undefined" || localStorage === null) return null;
        return localStorage;
      } catch (e) {
        return null;
      }
    }

    /**
     * 惰性装载某个标定桶。key 变了（换模型）就换桶重解 —— 换模型只影响前 1~2 步。
     * 桶名一律挂在 CAL_KEY 命名空间下：模型 id 是外部字符串，直接当 localStorage 键
     * 会和同源其它应用的键撞名。
     * @returns 传入的 state（原地改）。
     */
    function ensureCalibration(state, key, storage) {
      var bucket = typeof key === "string" && key !== "" ? CAL_KEY + ":" + key : CAL_KEY;
      if (state.storageReady && state.fitKey === bucket) return state;
      state.storageReady = true;
      state.fitKey = bucket;
      state.storage = storage === undefined ? safeStorage() : storage;
      state.fit = loadFit(state.storage, bucket);
      state.rates = fitRates(state.fit, RATE_PRIOR);
      return state;
    }

    /** 五类 tok/char 的可读串，供 tooltip 摊开标定结果。 */
    function ratesText(rates) {
      var names = ["汉字", "字母", "数字", "标点", "空白"];
      var out = [];
      for (var i = 0; i < CLASS_COUNT; i += 1) {
        out.push(names[i] + " " + (Math.round(nonNeg(rates[i]) * 1000) / 1000));
      }
      return out.join(" / ");
    }

    /**
     * 取当前模型的标定桶名。`modelSelection` 投影的形状不对外承诺，所以只接受
     * 能直接当短字符串用的字段；认不出就退回全局桶（换模型时前 1~2 步重新收敛）。
     *
     * 2026-09-22 源码核对（dsh-client-ui-model-selection/lib/client.js）：
     * 该投影的实际形状是 `{ current, routable, groups, failures, status, error }`，
     * 当前模型在 **`current`** 里（`current = projected.next ?? catalog.value.default`），
     * 而 `current` 带 `provider` 与模型 id。v0.6.0 初版只看了顶层字段，一个都不匹配 →
     * 一直退回全局桶（实测 localStorage 里只有 `dsh-pulse:cal:v1`，没有按模型的桶）。
     * 现在优先读 `current`，并把 `provider/model` 拼成稳定的桶名。
     */
    function readModelKey(useProjection) {
      try {
        var selection = typeof useProjection === "function" ? useProjection("modelSelection") : undefined;
        if (typeof selection === "string") return shortKey(selection);
        if (selection === null || typeof selection !== "object") return "";

        var current = selection.current;
        if (typeof current === "string") return shortKey(current);
        if (current !== null && typeof current === "object") {
          var provider = firstString([current.provider, current.providerId, current.providerName]);
          var model = firstString([current.model, current.modelId, current.id, current.name]);
          if (provider !== "" && model !== "") return shortKey(provider + "/" + model);
          if (model !== "") return shortKey(model);
        }

        var candidates = [selection.rowId, selection.id, selection.modelId, selection.model, selection.selected, selection.value];
        for (var i = 0; i < candidates.length; i += 1) {
          if (typeof candidates[i] === "string" && candidates[i].length > 0) return shortKey(candidates[i]);
        }
      } catch (e) {
        /* 忽略：退回全局桶 */
      }
      return "";
    }

    /** 桶名只接受可当字符串用的短值，超长一律丢弃（不拿异常形状当桶名）。 */
    function shortKey(value) {
      return typeof value === "string" && value.length > 0 && value.length <= 64 ? value : "";
    }

    /** 取候选里第一个非空短字符串。 */
    function firstString(candidates) {
      for (var i = 0; i < candidates.length; i += 1) {
        var key = shortKey(candidates[i]);
        if (key !== "") return key;
      }
      return "";
    }

    /**
     * 数在飞步骤的可见输出字符：正文（text + reasoning）+ 工具调用参数（name / argsRaw）。
     *
     * v0.5.0 起把工具调用参数也算进来。理由：provider 上报的 `outputTokens` **包含**模型生成的
     * 工具调用 JSON，而 v0.4.x 只数正文 —— 2026-09-22 实测，一轮含工具调用的多步回答因此
     * 系统性低估 16.4%（真值 1363 tok，估算 1139 tok）。工具参数就是模型输出，必须计入。
     */
    function liveChars(partial) {
      if (partial === null || typeof partial !== "object") return 0;
      var blocks = partial.blocks;
      if (!blocks || typeof blocks.length !== "number") return 0;
      var total = 0;
      for (var i = 0; i < blocks.length; i += 1) {
        var block = blocks[i];
        if (block === null || typeof block !== "object") continue;
        if (block.kind === "text" || block.kind === "reasoning") {
          if (typeof block.text === "string") total += block.text.length;
        } else if (block.kind === "tool-call") {
          if (typeof block.name === "string") total += block.name.length;
          if (typeof block.argsRaw === "string") total += block.argsRaw.length;
        }
      }
      return total;
    }

    /** 与 liveChars 同口径的五类字符计数。 */
    function liveCounts(partial) {
      var counts = [0, 0, 0, 0, 0];
      if (partial === null || typeof partial !== "object") return counts;
      var blocks = partial.blocks;
      if (!blocks || typeof blocks.length !== "number") return counts;
      for (var i = 0; i < blocks.length; i += 1) {
        var block = blocks[i];
        if (block === null || typeof block !== "object") continue;
        if (block.kind === "text" || block.kind === "reasoning") {
          if (typeof block.text === "string") countClasses(block.text, counts);
        } else if (block.kind === "tool-call") {
          if (typeof block.name === "string") countClasses(block.name, counts);
          if (typeof block.argsRaw === "string") countClasses(block.argsRaw, counts);
        }
      }
      return counts;
    }

    /**
     * 加权字符数：CJK 字符记 1 unit，非 CJK 字符记 NON_CJK_WEIGHT。
     * v0.5.0 起只用于 tooltip 的 ratio 读数与旧断言，估算本身走五类回归。
     */
    function liveUnits(partial) {
      return countsUnits(liveCounts(partial));
    }

    /** 精确累计输出 tokens：sessionStats.decodeTokens 优先，tokenUsage.outputTokens 兜底。 */
    function exactOutputTokens(sessionStats, usage) {
      if (sessionStats !== null && typeof sessionStats === "object" && typeof sessionStats.decodeTokens === "number") {
        return nonNeg(sessionStats.decodeTokens);
      }
      if (usage !== null && typeof usage === "object" && typeof usage.outputTokens === "number") {
        return nonNeg(usage.outputTokens);
      }
      return null;
    }

    /** 采样器的全部状态。挂载期存活于 ref，不参与 React 状态树。 */
    function createMeterState() {
      return {
        samples: [],
        ratio: RATIO_SEED,
        rates: RATE_PRIOR.slice(),
        fit: createFit(),
        fitKey: CAL_KEY,
        storage: null,
        storageReady: false,
        modelKey: "",
        running: false,
        stepStartTokens: 0,
        stepStartTime: 0,
        stepFirstOutputTime: -1, // -1 = 本步还没见过内容（不能用 0 当哨兵，墙钟可能真是 0）
        stepPeakCounts: [0, 0, 0, 0, 0],
        lastStep: null,
        estTokens: 0,
        lastNow: 0,
        lastExact: null,
        lastChars: 0,
        lastUnits: 0,
        renderedKey: "",
        sessionStats: undefined,
        usage: undefined,
        partial: null
      };
    }

    /**
     * 推进一个采样点：维护步骤沿、五类标定与估算累计值。
     * 步骤开始 → 记下起点精确 tokens；步骤进行中 → 估算值随字符增长；
     * 步骤结算 → 把这一步喂进岭回归、重解五类 tok/char、记下这一步的真值速率，
     * 并按本步实测 token 数等比回填本步的估算曲线。
     * @param state - createMeterState() 的对象（原地改，返回同一对象）。
     * @param now - 墙钟毫秒。
     * @param exact - 精确累计输出 tokens；null 表示两个投影都不可用。
     * @param counts - 当前在飞步骤的五类字符计数（[CJK, 字母, 数字, 标点, 空白]）。
     * @param running - 是否处于流式进行中。
     */
    function stepMeter(state, now, exact, counts, running) {
      var i;
      if (running && !state.running) {
        state.running = true;
        state.stepStartTime = now;
        state.stepFirstOutputTime = -1;
        state.stepStartTokens = exact === null ? 0 : exact;
        state.stepPeakCounts = [0, 0, 0, 0, 0];
      }
      if (running) {
        var seen = 0;
        for (i = 0; i < CLASS_COUNT; i += 1) {
          var n = nonNeg(counts[i]);
          if (n > state.stepPeakCounts[i]) state.stepPeakCounts[i] = n;
          seen += n;
        }
        // 第一个有内容的采样点 ≈ 首 token 时刻：真值速率的分母从这里起算。
        if (seen > 0 && state.stepFirstOutputTime < 0) state.stepFirstOutputTime = now;
        state.estTokens = estimateTokens(state.stepStartTokens, state.stepPeakCounts, state.rates);
      } else {
        if (state.running) {
          state.running = false;
          var settled = exact === null ? 0 : exact;
          var produced = settled - state.stepStartTokens;
          var estimated = state.estTokens - state.stepStartTokens;
          var units = countsUnits(state.stepPeakCounts);
          // 结算：这一步的真值产出是回归的一条观测；解出的五类 tok/char 立刻生效。
          if (produced > 0 && units > 0) {
            fitAdd(state.fit, state.stepPeakCounts, produced);
            state.rates = fitRates(state.fit, RATE_PRIOR);
            state.ratio = calibrateRatio(units, produced, state.ratio);
            saveFit(state.storage, state.fitKey, state.fit);
          }
          // 本步真值速率：分子是 provider 上报的精确产出，分母是首 token → 结算的墙钟。
          var decodeMs = state.stepFirstOutputTime >= 0 ? now - state.stepFirstOutputTime : 0;
          state.lastStep = produced > 0 && decodeMs >= 1
            ? { tokens: produced, ms: decodeMs, rate: produced / (decodeMs / 1000) }
            : null;
          // 结算是一次性上报，不是瞬时吞吐。若把跳变直接喂进采样流，10 秒窗会把整步的
          // token 算成 ~1000 tok/s 并持续一整个窗口（2026-09-22 实机抓到 1115 tok/s）。
          // 这里按本步实测 token 数对本步曲线做等比回填：形状仍来自文本增长，
          // 量级对齐产品权威值 —— 曲线连续、无假尖峰。
          //
          // v0.5.0 修：**exact 线也要回填**。v0.4.x 只回填了 est，于是结算后切到 exact 线时
          // 读到的是原始阶跃 —— 实机实测 R1 结算后显示 `159 tok/s ✓` 并持续整个 10 秒窗，
          // 而该步真实速率是 37.8 tok/s（真值产出 1615 tok ÷ 38s）。「真值」被阶跃放大了 4 倍，
          // 正是本版要消灭的假象。两条线共用同一条重建曲线后，结算读数就是真实平均速率。
          if (produced > 0 && estimated > 0) {
            var k = produced / estimated;
            for (var si = 0; si < state.samples.length; si += 1) {
              var smp = state.samples[si];
              if (smp.t >= state.stepStartTime) {
                var rebuilt = state.stepStartTokens + (smp.est - state.stepStartTokens) * k;
                smp.est = rebuilt;
                smp.exact = rebuilt;
              }
            }
          }
          state.stepPeakCounts = [0, 0, 0, 0, 0];
        }
        state.estTokens = exact === null ? 0 : exact;
      }
      if (exact !== null) pushSample(state.samples, now, exact, state.estTokens, RETAIN_MS);
      state.lastExact = exact;
      state.lastNow = now;
      return state;
    }
    // #endregion

    var ZH = {
      "cachehit.pill": "缓存命中 {percent}%",
      "cachehit.title": "会话累计缓存命中 {percent}% ｜ 缓存读取 {read} tok ｜ 未缓存输入 {uncached} tok ｜ 缓存写入 {write} tok ｜ 计费输入 {denominator} tok",
      "tps.pill": "{tps} tok/s ✓",
      "tps.pillEst": "~{tps} tok/s",
      "tps.idle": "— tok/s",
      "tps.title": "近 {window} 秒平均输出速度 {tps} tok/s（真值：provider 上报 usage 后 sessionStats.decodeTokens 的墙钟斜率）｜ 窗口内输出 {tokens} tok ｜ 实测跨度 {span}s ｜ 采样 {points} 点 ｜ 本步真值 {stepTps} tok/s ｜ 五类标定 {rates} tok/char",
      "tps.titleEst": "近 {window} 秒平均输出速度约 {tps} tok/s（估计：流式进行中，宿主尚未上报 usage）｜ 窗口内估算输出 {tokens} tok ｜ 实测跨度 {span}s ｜ 采样 {points} 点 ｜ 五类标定 {rates} tok/char ｜ 上次结算真值 {stepTps} tok/s",
      "tps.titleIdle": "近 {window} 秒无输出（会话空闲，或刚进入流式还没采到两点）"
    };
    var EN = {
      "cachehit.pill": "Cache hit {percent}%",
      "cachehit.title": "Session cache hit {percent}% | cached input {read} tok | uncached input {uncached} tok | cache write {write} tok | billed input {denominator} tok",
      "tps.pill": "{tps} tok/s ✓",
      "tps.pillEst": "~{tps} tok/s",
      "tps.idle": "— tok/s",
      "tps.title": "Output speed over the last {window}s: {tps} tok/s (exact: wall-clock slope of sessionStats.decodeTokens after the provider reported usage) | {tokens} tok in window | measured span {span}s | {points} samples | last step exact {stepTps} tok/s | per-class rates {rates} tok/char",
      "tps.titleEst": "Output speed over the last {window}s: about {tps} tok/s (estimate: streaming, usage not reported yet) | ~{tokens} tok in window | measured span {span}s | {points} samples | per-class rates {rates} tok/char | last step exact {stepTps} tok/s",
      "tps.titleIdle": "No output in the last {window}s (idle, or fewer than two samples since streaming began)"
    };

    var ANCHOR_STYLE = {
      display: "inline-flex",
      alignItems: "center",
      gap: "6px"
    };
    var PILL_STYLE = {
      display: "inline-flex",
      alignItems: "center",
      gap: "4px",
      padding: "2px 8px",
      borderRadius: "999px",
      border: "1px solid rgba(128, 128, 128, 0.35)",
      color: "inherit",
      fontSize: "11px",
      lineHeight: "16px",
      fontFamily: "inherit",
      fontVariantNumeric: "tabular-nums",
      whiteSpace: "nowrap",
      userSelect: "none"
    };
    // 速度读数用同一枚 pill 的外观，另加固定最小宽度 —— 数字跳动时整条 dock 不抖。
    var TPS_STYLE = {
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "flex-end",
      gap: "4px",
      padding: "2px 8px",
      minWidth: "58px",
      borderRadius: "999px",
      border: "1px solid rgba(128, 128, 128, 0.35)",
      color: "inherit",
      fontSize: "11px",
      lineHeight: "16px",
      fontFamily: "inherit",
      fontVariantNumeric: "tabular-nums",
      whiteSpace: "nowrap",
      userSelect: "none"
    };
    // v0.5.0：估计值 / 真值必须一眼可分，不必读 tooltip。
    //   估计 —— 虚线边 + 降透明度 + ~ 前缀；
    //   真值 —— 实线边 + 高对比边色 + ✓ 后缀。
    var TPS_EST_STYLE = {
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "flex-end",
      gap: "4px",
      padding: "2px 8px",
      minWidth: "58px",
      borderRadius: "999px",
      border: "1px dashed rgba(128, 128, 128, 0.55)",
      color: "inherit",
      opacity: 0.72,
      fontSize: "11px",
      lineHeight: "16px",
      fontFamily: "inherit",
      fontVariantNumeric: "tabular-nums",
      whiteSpace: "nowrap",
      userSelect: "none"
    };
    var TPS_EXACT_STYLE = {
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "flex-end",
      gap: "4px",
      padding: "2px 8px",
      minWidth: "58px",
      borderRadius: "999px",
      border: "1px solid rgba(64, 160, 96, 0.75)",
      color: "inherit",
      fontSize: "11px",
      lineHeight: "16px",
      fontFamily: "inherit",
      fontVariantNumeric: "tabular-nums",
      whiteSpace: "nowrap",
      userSelect: "none"
    };
    /** 安全读取一个会话投影：key 不存在 / 未桥接时返回 undefined，绝不让 dock 崩。 */
    function readProjection(useProjection, key) {
      try {
        return typeof useProjection === "function" ? useProjection(key) : undefined;
      } catch (e) {
        return undefined;
      }
    }

    /**
     * 读取「在飞的助手步骤」：legacy.partial = { turn, step, blocks }。
     * 它由客户端独有的 assistant/live-chunk 折叠而来 —— 流式进行中宿主还没有 usage，
     * 只有这份实时文本可用。字段缺失 / 未桥接 → null，绝不让 dock 崩。
     */
    function readLivePartial(useChat) {
      try {
        if (typeof useChat !== "function") return null;
        var partial = useChat(function (s) {
          return s && s.legacy ? s.legacy.partial : null;
        });
        return partial === undefined ? null : partial;
      } catch (e) {
        return null;
      }
    }

    function count(value) {
      return typeof value === "number" && isFinite(value) && value >= 0 ? value : 0;
    }

    /** 从 tokenUsage 投影算出展示所需的最小标量集合；不可用时返回 null（不渲染）。 */
    function computeView(usage) {
      if (usage === null || typeof usage !== "object") return null;
      if (typeof usage.cacheReadTokens !== "number") return null;
      var read = count(usage.cacheReadTokens);
      var uncached = count(usage.uncachedInputTokens);
      var write = count(usage.cacheWriteTokens);
      var denominator = uncached + read + write;
      if (!(denominator > 0)) return null;
      var percent = formatCacheHitPercent(read, denominator, DP);
      if (percent === null) return null;
      return {
        percent: percent,
        read: read,
        uncached: uncached,
        write: write,
        denominator: denominator
      };
    }

    /** 取本地化文案；seat 缺失或未命中时退回字面量。 */
    function tr(seat, key, params, fallback) {
      try {
        if (typeof seat === "function") {
          var text = seat(key, params);
          if (typeof text === "string" && text !== "" && text !== key) return text;
        }
      } catch (e) {
        /* 忽略：退回 fallback */
      }
      var out = fallback;
      for (var name in params) {
        if (Object.prototype.hasOwnProperty.call(params, name)) {
          out = out.split("{" + name + "}").join(String(params[name]));
        }
      }
      return out;
    }

    function group(value) {
      return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    }

    /**
     * 把采样状态折算成这一帧要显示的速率文案与 tooltip。
     * @returns { key, text, title, source }，source ∈ "estimate" | "exact" | "idle" ——
     *   调用方靠它决定前缀、配色与 data-pulse-src 探针，绝不把估计值当真实值显示。
     */
    function readRate(state, now, running, seat) {
      var windowSec = String(WINDOW_MS / 1000);
      var slope = windowSlope(state.samples, now, running ? "est" : "exact", WINDOW_MS, MIN_SPAN_MS);
      if (slope !== null && slope.rate > 0) {
        var rate = formatRate(slope.rate);
        if (rate !== null) {
          var stepRate = state.lastStep === null || state.lastStep === undefined ? null : formatRate(state.lastStep.rate);
          var params = {
            window: windowSec,
            tps: rate,
            tokens: group(Math.round(slope.tokens)),
            span: (slope.spanMs / 1000).toFixed(1),
            points: String(slope.points),
            ratio: String(Math.round(state.ratio * 1000) / 1000),
            stepTps: stepRate === null ? "—" : stepRate,
            rates: ratesText(state.rates)
          };
          return {
            key: rate,
            source: running ? "estimate" : "exact",
            text: tr(seat, running ? "tps.pillEst" : "tps.pill", params, running ? "~{tps} tok/s" : "{tps} tok/s ✓"),
            // fallback 与 ZH 字典逐字同源：i18n 未命中时 tooltip 也必须写清口径来源。
            title: tr(
              seat,
              running ? "tps.titleEst" : "tps.title",
              params,
              running
                ? "近 {window} 秒平均输出速度约 {tps} tok/s（估计：流式进行中，宿主尚未上报 usage）｜ 窗口内估算输出 {tokens} tok ｜ 实测跨度 {span}s ｜ 采样 {points} 点 ｜ 五类标定 {rates} tok/char ｜ 上次结算真值 {stepTps} tok/s"
                : "近 {window} 秒平均输出速度 {tps} tok/s（真值：provider 上报 usage 后 sessionStats.decodeTokens 的墙钟斜率）｜ 窗口内输出 {tokens} tok ｜ 实测跨度 {span}s ｜ 采样 {points} 点 ｜ 本步真值 {stepTps} tok/s ｜ 五类标定 {rates} tok/char"
            )
          };
        }
      }
      return {
        key: "idle",
        source: "idle",
        text: tr(seat, "tps.idle", {}, "— tok/s"),
        title: tr(seat, "tps.titleIdle", { window: windowSec }, "近 {window} 秒无输出（会话空闲，或刚进入流式还没采到两点）")
      };
    }

    function PulseDock(props) {
      var seat = props.t;
      var usage = readProjection(props.useProjection, "tokenUsage");
      var sessionStats = readProjection(props.useProjection, "sessionStats");
      var partial = readLivePartial(props.useChat);
      var modelKey = readModelKey(props.useProjection);
      var view = computeView(usage);

      var tick = react.useState(0);
      var setTick = tick[1];
      var meterRef = react.useRef(null);
      if (meterRef.current === null) meterRef.current = createMeterState();

      // 渲染期只做观测赋值：投影 / 实时态一变就会重渲，ref 因此总是最新。
      var meter = meterRef.current;
      meter.sessionStats = sessionStats;
      meter.usage = usage;
      meter.partial = partial;
      meter.modelKey = modelKey;

      react.useEffect(function () {
        var id = setInterval(function () {
          var state = meterRef.current;
          var now = Date.now();
          // 换模型 → 换标定桶（从 localStorage 读回该模型自己的历史标定）。
          ensureCalibration(state, state.modelKey);
          var exact = exactOutputTokens(state.sessionStats, state.usage);
          var streaming = state.partial !== null && state.partial !== undefined;
          var countsNow = liveCounts(state.partial);
          state.lastChars = liveChars(state.partial);
          state.lastUnits = countsUnits(countsNow);
          stepMeter(state, now, exact, countsNow, streaming);
          // 值没变就不重渲：空闲时采样照跑（窗要滑动），但一帧都不出。
          var next = displayKey(state, now, streaming);
          if (next !== state.renderedKey) {
            state.renderedKey = next;
            setTick(function (n) { return n + 1; });
          }
        }, SAMPLE_MS);
        return function () {
          clearInterval(id);
        };
      }, []);

      var streamingNow = partial !== null && partial !== undefined;
      var rate = readRate(meter, Date.now(), streamingNow, seat);
      if (view === null && rate.key === "idle") return null;

      var children = [];
      // 阴影生效时内置统计行已经显示两位小数缓存命中 —— 这里绝不能再画一枚，
      // 否则用户又看到「99% + 99.87%」两枚读数（v0.5.0 的形态）。
      // 阴影不可用（老 harness / 注册失败）时才由本插件补上这一枚，作为降级。
      if (view !== null && !shadowState.active) {
        var params = {
          percent: view.percent,
          read: group(view.read),
          uncached: group(view.uncached),
          write: group(view.write),
          denominator: group(view.denominator)
        };
        var hitText = tr(seat, "cachehit.pill", params, "缓存命中 {percent}%");
        var hitTitle = tr(seat, "cachehit.title", params, "会话累计缓存命中 {percent}% ｜ 缓存读取 {read} tok ｜ 未缓存输入 {uncached} tok ｜ 缓存写入 {write} tok ｜ 计费输入 {denominator} tok");
        children.push(
          react.createElement(
            "span",
            {
              key: "cachehit",
              style: PILL_STYLE,
              title: hitTitle,
              "aria-label": hitTitle,
              role: "status"
            },
            hitText
          )
        );
      }
      children.push(
        react.createElement(
          "span",
          {
            key: "tps",
            style: rate.source === "estimate" ? TPS_EST_STYLE : (rate.source === "exact" ? TPS_EXACT_STYLE : TPS_STYLE),
            title: rate.title,
            "aria-label": rate.title,
            role: "status"
          },
          rate.text
        )
      );

      var stepRateText = meter.lastStep === null || meter.lastStep === undefined
        ? "na"
        : String(Math.round(meter.lastStep.rate * 10) / 10);

      return react.createElement(
        "span",
        {
          style: ANCHOR_STYLE,
          "data-pulse": view === null ? "na" : view.percent,
          "data-pulse-tps": rate.key,
          // 只读探针：暴露当前读数来源与两枚计数器的值，供外部实测与断言使用。
          // data-pulse-src 是本版新增的关键探针 —— estimate / exact / idle 三态可外部判定。
          "data-pulse-src": rate.source,
          "data-pulse-step-tps": stepRateText,
          "data-pulse-rates": meter.rates.join(","),
          "data-pulse-fit-s": String(Math.round(meter.fit.s)),
          // 阴影是否接管了内置统计行。CDP 实测靠它判定「页面上只剩一枚两位小数缓存命中」。
          "data-pulse-shadow": shadowState.active ? "on" : "off",
          // 标定桶名后缀（空 = 退回全局桶）。换模型是否换桶靠它判定。
          "data-pulse-bucket": meter.fitKey === CAL_KEY ? "" : meter.fitKey.slice(CAL_KEY.length + 1),
          "data-pulse-exact": meter.lastExact === null || meter.lastExact === undefined ? "na" : String(meter.lastExact),
          "data-pulse-est": String(Math.round(meter.estTokens)),
          "data-pulse-chars": String(meter.lastChars),
          "data-pulse-units": String(Math.round(meter.lastUnits))
        },
        children
      );
    }

    function apply(ctx) {
      ctx.effect(
        () => ctx.locale.register(NS, { zh: ZH, en: EN }),
        "ui-pulse: dictionaries"
      );

      // 阴影：先同步试一次（第一帧就不会多画一枚缓存命中），再订阅 slot 变化兜住加载顺序。
      var shadowHandle = { current: null, component: createStatsShadow(react) };
      ensureStatsShadow(ctx, shadowHandle);

      ctx.effect(function () {
        var slots = ctx.slots;
        if (!slots || typeof slots.subscribe !== "function") return undefined;
        ensureStatsShadow(ctx, shadowHandle);
        var unsubscribe = slots.subscribe(STATS_SLOT, function () {
          ensureStatsShadow(ctx, shadowHandle);
        });
        return function () {
          if (typeof unsubscribe === "function") unsubscribe();
          if (shadowHandle.current !== null) {
            try { shadowHandle.current(); } catch (e) { /* 卸载失败不影响宿主 */ }
            shadowHandle.current = null;
          }
          shadowState.active = false;
        };
      }, "ui-pulse: shadow the built-in stats line (2dp cache hit)");

      ctx.slots.inject("conversation.composer.dock", () =>
        ctx.slots.register(
          {
            name: "conversation.composer.dock",
            id: "pulse",
            order: 1, // 内置统计 pill 是 order 0 → 本枚紧随其后
            locale: NS
          },
          PulseDock
        )
      );
    }

    exports.name = "dsh-pulse";
    exports.inject = inject;
    exports.apply = apply;
    exports.__test = {
      formatCacheHitPercent: formatCacheHitPercent,
      computeView: computeView,
      createMeterState: createMeterState,
      stepMeter: stepMeter,
      windowSlope: windowSlope,
      formatRate: formatRate,
      displayKey: displayKey,
      calibrateRatio: calibrateRatio,
      estimateTokens: estimateTokens,
      liveChars: liveChars,
      liveUnits: liveUnits,
      liveCounts: liveCounts,
      classOf: classOf,
      classOfCode: classOfCode,
      countClasses: countClasses,
      countsTotal: countsTotal,
      countsUnits: countsUnits,
      createFit: createFit,
      fitAdd: fitAdd,
      solveLinear: solveLinear,
      fitRates: fitRates,
      loadFit: loadFit,
      saveFit: saveFit,
      ensureCalibration: ensureCalibration,
      ratesText: ratesText,
      readModelKey: readModelKey,
      // v0.6.0 阴影：纯函数部分可单测，注册部分靠假 ctx 单测。
      isComponentType: isComponentType,
      findStatsEntry: findStatsEntry,
      nextShadowPriority: nextShadowPriority,
      createStatsShadow: createStatsShadow,
      ensureStatsShadow: ensureStatsShadow,
      shadowState: shadowState,
      STATS_SLOT: STATS_SLOT,
      STATS_ID: STATS_ID,
      STATS_KEY: STATS_KEY,
      ORIGINAL_PRIORITY: ORIGINAL_PRIORITY,
      exactOutputTokens: exactOutputTokens,
      readRate: readRate,
      PulseDock: PulseDock
    };
    return module.exports;
  }
});
