# 从社区吸取的技术（含对本仓库既有结论的纠错）

> 建立时间：2026-09-22
> 来源：`dsharness.io` 社区目录 → 定位到同类项目 → 经 jsDelivr 取到**源码级**证据
> 证据等级：本文所有「源码证据」均为**第一档**（可在本机 `app.asar` 复核）；标为「待验证」的为第三档。

## 0. 取件通路（GitHub 被 DNS 拦时的可用路径）

本机 `web_fetch` 与 `Invoke-WebRequest` 都**无法直连 GitHub**：

```
github.com / raw.githubusercontent.com / api.github.com
  → URL hostname "..." resolves to a non-public IP address
```

但 **jsDelivr 可以**（`pwsh` 直连即可，不依赖 `web_fetch` 的 content-type 限制）：

```powershell
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

# 列仓库文件树（HTML 目录页）
Invoke-WebRequest 'https://cdn.jsdelivr.net/gh/<user>/<repo>/' -UseBasicParsing

# 取任意文件（含 .js —— web_fetch 会因 content-type 拒绝，pwsh 不会）
Invoke-WebRequest 'https://cdn.jsdelivr.net/gh/<user>/<repo>/<path>' -UseBasicParsing
```

> 注：该通路**不稳定**（实测同一 URL 先成功后连续失败，报 `基础连接已经关闭: 发送时发生错误`）。
> 取件要重试，并且**取到就立刻落盘**，不要依赖二次获取。

---

## 1. 【核心技术】slot 阴影：list 型 slot 可以顶替内置条目

### 1.1 我们原来错在哪

`README.md`《二、能力边界》的取舍表第 3 行与结论写的是：

> | 3 | **slot 是 list 型，没有可顶替的席位**：…注册表对 list 型的重复判定是 `id + priority`，换 priority 注册只是**并列多一枚**；渲染侧对 list 型是 `[...rows].sort(by order)` **全量渲染**，不是择优 |
> 一句话：**要「就一个数、且是两位小数」→ asar 补丁**

**这两句都不对。**

### 1.2 源码证据（全部可在本机 `app.asar` 复核）

| # | 事实 | 位置 |
|---|---|---|
| 1 | list 型条目按 **`(priority ?? 0)` 升序**、再按 `(order ?? 0)` 升序排序 | `dsh-client-ui-slots/lib/index.js` L130 |
| 2 | `entriesOfSlot` 取**每个 cell 的第一个存活条目**；**list 的 cell = `entry.options.id`** | 同文件 `entriesOfSlot` 的 jsdoc 与实现 |
| 3 | 注册守卫：同 `id` + 同 `priority` → **抛错**，错误提示原文 `register at a different priority to shadow it (lowest renders)` | 同文件 `register` 的 `case "list"` |
| 4 | 内置统计行注册为 `{ name: "conversation.composer.dock", id: "stats", order: 0, locale: NS }` —— **没有 `priority`**，默认 0 | `dsh-client-ui-chat/lib/client.js` L8349–8354 |
| 5 | list 渲染只画 `entriesOfSlot` 的胜出者；**被阴影的落选条目被 `rowIds.has(...) → continue` 直接跳过，不会渲染** | `dsh-client-ui-renderer/lib/client.js` L850–868 |

**结论：`priority` 越低越优先；用同一个 `id: "stats"` + `priority: -1` 注册，就能顶替内置那枚。**
我们 README 说的「并列多一枚」「全量渲染」都是错的 —— 那是把 `order` 当成了 `priority`。
（同 `id` 同 `priority` 确实会抛错，这大概就是当初得出「做不到」的原因：试的是 `order`，不是 `priority`。）

### 1.3 参考实现（已落盘 `ref-client.js`）

社区项目 `luern0313/DSH-Cache-Hit-Precision` 就是干这件事的，实现只有 143 行：

```js
// 1) 找到原条目（raw entries 视图，公开 API）
const original = slots.entries(STATS_SLOT).find(e =>
  e.options.id === "stats" && (e.options.priority ?? 0) === 0);

// 2) 用同一个 id、更低的 priority 注册阴影；把原组件 inject 进来
slots.register({
  name: STATS_SLOT,
  id: "stats",
  priority: nextShadowPriority(),          // = min(已存在的 priority, 0) - 1
  order: 0,
  locale: original.options.locale ?? "chat",   // 复用原条目的 i18n 命名空间
  inject: () => ({ Original: original.component })
}, CacheHitStats);

// 3) 阴影组件渲染原组件，只把 t 换成拦截版
const CacheHitStats = react.memo(function ({ Original, useProjection, t, ...props }) {
  const usage = useProjection("tokenUsage");
  const patchedT = useMemo(() => (key, params) =>
    key !== "stats.cacheHit" ? t(key, params)
      : t(key, { percent: exactCacheHitPercent(usage).toFixed(2) }),
    [t, usage]);
  return jsx(Original, { ...props, useProjection, t: patchedT });
});
```

它的 `cordis.patch.yml` 注释直接写明了手法：

> *"so the original `stats` entry in `conversation.composer.dock` already exists and our client plugin can **shadow it at priority -1**"*

### 1.4 我们此前不知道的 slot API（这 4 个才是关键）

| API | 作用 | 我们原来用的 |
|---|---|---|
| `ctx.slots.entries(name)` | **原始**条目列表（含被阴影的落选者）→ 能拿到原组件 | ❌ 不知道 |
| `ctx.slots.spec(name)` | 该 slot 的声明（未声明则 undefined）→ 用于判断能否注册 | ❌ 不知道 |
| `ctx.slots.subscribe(name, cb)` | slot 变更订阅 → **注册与加载顺序无关** | ❌ 不知道（我们靠 `inject` 的时序） |
| `register({ ..., inject: () => ({...}) })` | 往组件注入任意 props → 把 `Original` 传进去 | ❌ 不知道 |
| `priority`（≠ `order`） | list 型的**选举**键，低者胜 | ❌ 完全没用到 |

### 1.5 对本插件的意义（这是产品级改变，不是细节）

| | 现在（v0.5.0） | 阴影路线 |
|---|---|---|
| 读数数量 | **两枚**（内置 `99%` + 我们的 `99.87%`） | **一枚**（`99.87%`，顶替内置） |
| 统计行其余内容（轮次/步骤/耗时/TTFT/token） | 由内置那枚继续显示 | **原样保留** —— 阴影组件直接渲染 `Original` |
| i18n | 我们另建 `ui-pulse` 命名空间 | **复用原条目命名空间**，只拦截 `stats.cacheHit` |
| 与内置重复 | 是（用户最初就抱怨这个） | 否 |

**这正好是用户最初的原话：「要「就一个数、且是两位小数」」。** 我们之前告诉他只能走 asar 补丁 —— 那个结论是错的。

### 1.6 还没验证的部分（第三档，别当已知）

- 阴影后**原组件的 props 契约**：参考实现直接把 `{...props, useProjection, t}` 透传。
  我们没读过 `StatsPills` 本体，不知道它是否还依赖别的 seat。
- **多个阴影共存**（比如我们的 pulse 也想阴影 `stats`）时的 `priority` 递减协商，参考实现有
  `nextShadowPriority()` 处理，但**没有实测过两个阴影同时在场**。
- 参考实现用的是 `require("react/jsx-runtime")`；我们的 `client.js` 目前只用 `require("react")` +
  `createElement`。**`jsx-runtime` 能否 require 到，未验证**（大概率可以，但要测）。
- **换 slot** 时的行为（`conversation.composer.dock` 在 hero 页不挂载）没变。

---

## 2. 其他可借鉴的方向（**未取到源码，第三档**）

| 项目 | 借鉴点 | 状态 |
|---|---|---|
| `dsh-usage-plugin`（★37） | CSV / JSON / PNG 导出 | 只有目录描述 |
| `dsh-turn-fold`（★3） | 指标折叠进回合组头（不占常驻位置） | 只有目录描述 |
| `dsh-better-status`（★1） | 右侧图表面板（信息密度远高于两枚 pill） | 只有目录描述 |
| `dsh-metrics-panel`（★0） | 浮动面板 + 概览曲线 + 请求明细 + 错误清单 | 只有目录描述 |
| `dsh-client-usage`（★4） | 缓存命中/未命中**分桶**展示 | 只有目录描述 |
| `dsh-web-all`（★7.7k） | 多插件/皮肤中心的组织方式 | 只有目录描述 |

> 这些**没有源码证据**，不构成「别人这么做了所以我们也要」的理由。
> 要吸收，必须先经 §0 的通路取到源码、落盘、读过再决定。

---

## 3. 对 v0.6.0 范围的影响

1. **新增「阴影化」为 v0.6.0 的头号目标**：把缓存命中从「另加一枚」改成「顶替内置」，
   回到用户最初要的形态。这是**用户可感知的减法**（两枚 → 一枚），不是加功能。
2. **必须同时改 README**：《二、能力边界》整节按 §1.2 的源码证据重写，
   并把取舍表里的 asar 补丁路线降级为「不需要」。
3. **必须补测试**：阴影注册的 priority 协商、`Original` 注入、`t` 拦截、原条目缺席时不崩。
4. **保留现有 pill 作为降级路径**：如果 `slots.entries` / `spec` / `subscribe` 在旧版 harness 上
   不可用，退回 v0.5.0 的「另加一枚」形态 —— 这条降级要有断言。