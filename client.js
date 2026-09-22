/* dsh-pulse · client half
 * 在 composer dock 增加两枚只读读数：
 *   1) 「缓存命中 99.87%」两位小数读数（含精确 token 明细 title）；
 *   2) 「42.7 tok/s」10 秒滑窗平均输出速度。
 *
 * 速度读数的两条数据线（口径写死在 title 里，不混报）：
 *   精确线 —— sessionStats.decodeTokens 的墙钟斜率。该计数只在 assistant/message 落盘
 *             （即步骤结算、provider 上报 usage）时前进，所以流式进行中它是平的。
 *   估算线 —— 流式进行中改读 legacy.partial（客户端独有的 assistant/live-chunk 折叠）
 *             的实时文本增量，按上一次步骤标定出的 chars/token 折算；带 ~ 前缀。
 *             步骤一结算，估算线立刻收敛回精确线（同一根累计曲线，不会跳变）。
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

    // #region window
    // 10 秒滑窗速率：纯算术，不碰 React/DOM。verify.mjs 按本区标记抽取做单测 —— 勿改标记。

    var WINDOW_MS = 10000;   // 滑窗长度：用户令「10s 内的平均输出速度」
    var SAMPLE_MS = 500;     // 采样间隔
    var MIN_SPAN_MS = 1000;  // 跨度不足 1s 不出数（两点斜率不可信）
    var RETAIN_MS = WINDOW_MS * 2; // 环形缓冲保留两倍窗长，够取窗沿锚点
    var RATIO_MIN = 0.05;    // tok/unit 标定下界
    var RATIO_MAX = 8;       // tok/unit 标定上界
    var NON_CJK_WEIGHT = 0.42; // 非 CJK 字符折成多少 unit（1 CJK 字符 = 1 unit）
    var CJK_RE = /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\u3040-\u30FF\uAC00-\uD7AF]/;
    // 未标定前的种子比（tok / unit）。加权口径让同一套比同时适配中英：
    // 纯中文 ≈ 0.80 tok/char，纯英文 ≈ 0.34 tok/char。
    // 2026-09-22 实机实测（gen4-lab 真实 DSH web，三次独立长/中/短回答，产品权威值对照）：
    // 真实比 0.801 / 0.824 / 0.799 tok/unit —— 种子 0.80 与之相差 -0.1% ~ -2.9%（旧种子 0.5 相差 -23.9%）。
    var RATIO_SEED = 0.80;

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
      return (streaming ? "~" : "") + rate;
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

    /** 估算累计输出 tokens = 本步起点精确值 + 本步实时加权字符数 × 标定比。 */
    function estimateTokens(stepStartTokens, units, ratio) {
      return nonNeg(stepStartTokens) + nonNeg(units) * (ratio > 0 ? ratio : RATIO_SEED);
    }

    /** 从 legacy.partial 的 blocks 里数正文字符（text + reasoning），不数工具调用参数。 */
    function liveChars(partial) {
      if (partial === null || typeof partial !== "object") return 0;
      var blocks = partial.blocks;
      if (!blocks || typeof blocks.length !== "number") return 0;
      var total = 0;
      for (var i = 0; i < blocks.length; i += 1) {
        var block = blocks[i];
        if (block === null || typeof block !== "object") continue;
        if (block.kind !== "text" && block.kind !== "reasoning") continue;
        if (typeof block.text === "string") total += block.text.length;
      }
      return total;
    }

    /**
     * 加权字符数：CJK 字符记 1 unit，非 CJK 字符记 NON_CJK_WEIGHT。
     * 同一个 tokenizer 下中文约 1.5 字符/token、英文约 4 字符/token，
     * 用加权口径后一套种子比就能同时覆盖两种语言，不必按语言分支。
     */
    function liveUnits(partial) {
      if (partial === null || typeof partial !== "object") return 0;
      var blocks = partial.blocks;
      if (!blocks || typeof blocks.length !== "number") return 0;
      var units = 0;
      for (var i = 0; i < blocks.length; i += 1) {
        var block = blocks[i];
        if (block === null || typeof block !== "object") continue;
        if (block.kind !== "text" && block.kind !== "reasoning") continue;
        if (typeof block.text !== "string") continue;
        var text = block.text;
        for (var j = 0; j < text.length; j += 1) {
          units += CJK_RE.test(text.charAt(j)) ? 1 : NON_CJK_WEIGHT;
        }
      }
      return units;
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
        running: false,
        stepStartTokens: 0,
        stepPeakUnits: 0,
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
     * 推进一个采样点：维护步骤沿、标定比与估算累计值。
     * 步骤开始 → 记下起点精确 tokens；步骤进行中 → 估算值随字符数增长；
     * 步骤结算 → 重标 ratio，并按本步实测 token 数等比回填本步的估算曲线。
     * @param state - createMeterState() 的对象（原地改，返回同一对象）。
     * @param now - 墙钟毫秒。
     * @param exact - 精确累计输出 tokens；null 表示两个投影都不可用。
     * @param units - 当前在飞步骤的实时加权字符数。
     * @param running - 是否处于流式进行中。
     */
    function stepMeter(state, now, exact, units, running) {
      if (running && !state.running) {
        state.running = true;
        state.stepPeakUnits = 0;
        state.stepStartTime = now;
        state.stepStartTokens = exact === null ? 0 : exact;
      }
      if (running) {
        if (units > state.stepPeakUnits) state.stepPeakUnits = units;
        state.estTokens = estimateTokens(state.stepStartTokens, units, state.ratio);
      } else {
        if (state.running) {
          state.running = false;
          var settled = exact === null ? 0 : exact;
          var produced = settled - state.stepStartTokens;
          var estimated = state.estTokens - state.stepStartTokens;
          state.ratio = calibrateRatio(state.stepPeakUnits, produced, state.ratio);
          // 结算是一次性上报，不是瞬时吞吐。若把跳变直接喂进采样流，10 秒窗会把整步的
          // token 算成 ~1000 tok/s 并持续一整个窗口（2026-09-22 实机抓到 1115 tok/s）。
          // 这里按本步实测 token 数对本步估算曲线做等比回填：形状仍来自文本增长，
          // 量级对齐产品权威值 —— 曲线连续、无假尖峰，这一步在窗里显示的是真实平均速率。
          if (produced > 0 && estimated > 0) {
            var k = produced / estimated;
            for (var si = 0; si < state.samples.length; si += 1) {
              var smp = state.samples[si];
              if (smp.t >= state.stepStartTime) {
                smp.est = state.stepStartTokens + (smp.est - state.stepStartTokens) * k;
              }
            }
          }
          state.stepPeakUnits = 0;
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
      "tps.pill": "{tps} tok/s",
      "tps.pillEst": "~{tps} tok/s",
      "tps.idle": "— tok/s",
      "tps.title": "近 {window} 秒平均输出速度 {tps} tok/s ｜ 窗口内输出 {tokens} tok ｜ 实测跨度 {span}s ｜ 采样 {points} 点 ｜ 口径：精确（sessionStats.decodeTokens 的墙钟斜率）",
      "tps.titleEst": "近 {window} 秒平均输出速度约 {tps} tok/s（流式进行中，宿主尚未上报 usage）｜ 窗口内估算输出 {tokens} tok ｜ 实测跨度 {span}s ｜ 采样 {points} 点 ｜ 折算比 {ratio} tok/unit（加权字符），由上一次步骤结算时标定",
      "tps.titleIdle": "近 {window} 秒无输出（会话空闲，或刚进入流式还没采到两点）"
    };
    var EN = {
      "cachehit.pill": "Cache hit {percent}%",
      "cachehit.title": "Session cache hit {percent}% | cached input {read} tok | uncached input {uncached} tok | cache write {write} tok | billed input {denominator} tok",
      "tps.pill": "{tps} tok/s",
      "tps.pillEst": "~{tps} tok/s",
      "tps.idle": "— tok/s",
      "tps.title": "Output speed over the last {window}s: {tps} tok/s | {tokens} tok in window | measured span {span}s | {points} samples | exact (wall-clock slope of sessionStats.decodeTokens)",
      "tps.titleEst": "Output speed over the last {window}s: about {tps} tok/s (streaming; usage not reported yet) | ~{tokens} tok in window | measured span {span}s | {points} samples | {ratio} tok/unit (weighted chars), calibrated at the previous step settle",
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

    /** 把采样状态折算成这一帧要显示的速率文案与 tooltip。 */
    function readRate(state, now, running, seat) {
      var windowSec = String(WINDOW_MS / 1000);
      var slope = windowSlope(state.samples, now, running ? "est" : "exact", WINDOW_MS, MIN_SPAN_MS);
      if (slope !== null && slope.rate > 0) {
        var rate = formatRate(slope.rate);
        if (rate !== null) {
          var params = {
            window: windowSec,
            tps: rate,
            tokens: group(Math.round(slope.tokens)),
            span: (slope.spanMs / 1000).toFixed(1),
            points: String(slope.points),
            ratio: String(Math.round(state.ratio * 1000) / 1000)
          };
          return {
            key: rate,
            text: tr(seat, running ? "tps.pillEst" : "tps.pill", params, running ? "~{tps} tok/s" : "{tps} tok/s"),
            // fallback 与 ZH 字典逐字同源：i18n 未命中时 tooltip 也必须写清口径来源。
            title: tr(
              seat,
              running ? "tps.titleEst" : "tps.title",
              params,
              running
                ? "近 {window} 秒平均输出速度约 {tps} tok/s（流式进行中，宿主尚未上报 usage）｜ 窗口内估算输出 {tokens} tok ｜ 实测跨度 {span}s ｜ 采样 {points} 点 ｜ 折算比 {ratio} tok/unit（加权字符），由上一次步骤结算时标定"
                : "近 {window} 秒平均输出速度 {tps} tok/s ｜ 窗口内输出 {tokens} tok ｜ 实测跨度 {span}s ｜ 采样 {points} 点 ｜ 口径：精确（sessionStats.decodeTokens 的墙钟斜率）"
            )
          };
        }
      }
      return {
        key: "idle",
        text: tr(seat, "tps.idle", {}, "— tok/s"),
        title: tr(seat, "tps.titleIdle", { window: windowSec }, "近 {window} 秒无输出（会话空闲，或刚进入流式还没采到两点）")
      };
    }

    function PulseDock(props) {
      var seat = props.t;
      var usage = readProjection(props.useProjection, "tokenUsage");
      var sessionStats = readProjection(props.useProjection, "sessionStats");
      var partial = readLivePartial(props.useChat);
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

      react.useEffect(function () {
        var id = setInterval(function () {
          var state = meterRef.current;
          var now = Date.now();
          var exact = exactOutputTokens(state.sessionStats, state.usage);
          var streaming = state.partial !== null && state.partial !== undefined;
          var unitsNow = liveUnits(state.partial);
          state.lastChars = liveChars(state.partial);
          state.lastUnits = unitsNow;
          stepMeter(state, now, exact, unitsNow, streaming);
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
      if (view !== null) {
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
            style: TPS_STYLE,
            title: rate.title,
            "aria-label": rate.title,
            role: "status"
          },
          rate.text
        )
      );

      return react.createElement(
        "span",
        {
          style: ANCHOR_STYLE,
          "data-pulse": view === null ? "na" : view.percent,
          "data-pulse-tps": rate.key,
          // 只读探针：暴露两枚计数器的当前值，供外部实测与断言使用（不影响任何显示逻辑）。
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
      exactOutputTokens: exactOutputTokens,
      readRate: readRate,
      PulseDock: PulseDock
    };
    return module.exports;
  }
});
