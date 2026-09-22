/* dsh-pulse · client half
 * 在 composer dock 增加一枚「缓存命中 99.87%」两位小数读数（含精确 token 明细 title）。
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

    var ZH = {
      "cachehit.pill": "缓存命中 {percent}%",
      "cachehit.title": "会话累计缓存命中 {percent}% ｜ 缓存读取 {read} tok ｜ 未缓存输入 {uncached} tok ｜ 缓存写入 {write} tok ｜ 计费输入 {denominator} tok"
    };
    var EN = {
      "cachehit.pill": "Cache hit {percent}%",
      "cachehit.title": "Session cache hit {percent}% | cached input {read} tok | uncached input {uncached} tok | cache write {write} tok | billed input {denominator} tok"
    };

    var ANCHOR_STYLE = {
      display: "inline-flex",
      alignItems: "center"
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

    /** 安全读取一个会话投影：key 不存在 / 未桥接时返回 undefined，绝不让 dock 崩。 */
    function readProjection(useProjection, key) {
      try {
        return typeof useProjection === "function" ? useProjection(key) : undefined;
      } catch (e) {
        return undefined;
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

    function PulseDock(props) {
      var seat = props.t;
      var usage = readProjection(props.useProjection, "tokenUsage");
      var view = computeView(usage);
      if (view === null) return null;

      var params = {
        percent: view.percent,
        read: group(view.read),
        uncached: group(view.uncached),
        write: group(view.write),
        denominator: group(view.denominator)
      };
      var text = tr(seat, "cachehit.pill", params, "缓存命中 {percent}%");
      var title = tr(seat, "cachehit.title", params, "会话累计缓存命中 {percent}% ｜ 缓存读取 {read} tok ｜ 未缓存输入 {uncached} tok ｜ 缓存写入 {write} tok ｜ 计费输入 {denominator} tok");

      return react.createElement(
        "span",
        { style: ANCHOR_STYLE, "data-pulse": view.percent },
        react.createElement(
          "span",
          {
            style: PILL_STYLE,
            title: title,
            "aria-label": title,
            role: "status"
          },
          text
        )
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
    exports.__test = { formatCacheHitPercent: formatCacheHitPercent, computeView: computeView };
    return module.exports;
  }
});
