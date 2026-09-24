# dsh-pulse · 缓存命中两位小数（顶替内置）+ 精确输出速度

> DeepSeek Harness 客户端插件，做两件事：
> 1. 用 **slot 阴影顶替内置统计行**，把「缓存命中」显示为**两位小数** —— 页面上只留**一枚**读数；
> 2. 另加一枚只读的 **10 秒滑窗平均输出速度（tok/s）**，区分「流中估计」与「结算后 provider 真值」两态。
>
> 不改产品二进制、可版本化、可卸载。
>
> 仓库：<https://github.com/qilingzon/dsh-pulse> ｜ 许可：MIT ｜ 版本：0.6.0
>
> 前身是本地实验件 `dsh-cachehit-2dp`（A27）。曾经并行的另一条路线是 asar 最小增量补丁 —— v0.6.0 起
> **不再需要它**（插件路线现在也能做到「就一个数、且是两位小数」，还额外耐升级、可卸载）。
> 结论与源码证据见《能力边界》与 `TECHNIQUES.md`。

---

## 一、它做什么

```
缓存命中 99.87%   ~42.7 tok/s     ← 流式进行中：估计值，虚线边
缓存命中 99.87%   41.8 tok/s ✓    ← 步骤结算后：provider 真值，实线边
```

**左边那枚不是新增的** —— 它是被本插件**顶替**的内置统计行（未安装时它显示 `99%`）。
本插件只贡献右边那枚 tok/s。

### 1. 缓存命中（两位小数，顶替内置）

- **做法**：以同一个 `id: "stats"` + 更低的 `priority` 注册一个**阴影**条目顶替内置那枚，
  阴影组件把内置组件本体原样渲染，只把 `stats.cacheHit` 的 percent 换成两位小数。
  轮次 / 步骤 / 耗时 / TTFT / token 等显示**逐字不变**。机制与源码证据见《能力边界》§2.2–2.3。
- **实测**：gen4-lab 真实 DSH web 上，页面上可见的缓存命中读数**恰好 1 枚**，且为两位小数
  （证据 `shadow-verify.json`：`shadowActive / exactlyOneCacheHitReading / thatReadingIsTwoDecimal /
  readingComesFromBuiltinNotPulse` 四项全 `true`）。
- 数据来自 `useProjection("tokenUsage")` —— 与内置那枚**同一个投影**，不是估算、不是另算一份账。
- 口径与内置完全一致：`缓存读取 ÷ (未缓存输入 + 缓存读取 + 缓存写入)`；「部分命中绝不显示 100%」的诚实分支逐字同源。
- `title` / `aria-label` 给出精确明细：`会话累计缓存命中 99.87% ｜ 缓存读取 1,234,567 tok ｜ 未缓存输入 16,234 tok ｜ 缓存写入 0 tok ｜ 计费输入 1,250,801 tok`。
- **降级**：阴影不可用（老版本 harness / slot 未声明 / 注册抛错）时自动退回「自己补一枚」，
  此时会出现两枚读数 —— `data-pulse-shadow` 探针报 `off` 即可判定。
- 不写宿主、不碰 DOM、不引用产品 CSS 类名、不走 RPC、不注册服务。

### 2. 10 秒滑窗平均输出速度（tok/s）· v0.5.0「精确速度」

- **窗口**：10000 ms 墙钟，采样间隔 500 ms，环形缓冲保留两倍窗长（取窗沿锚点，跨度尽量贴满 10s）。
- **格式**：与产品 `formatTokensPerSecond` 同款 —— `≥10` 取整（`43 tok/s`），`<10` 保留一位小数（`9.9 tok/s`）。
- **空闲**：窗内没有新增输出 → 显示 `— tok/s`，不显示假的 `0.0`。
- **跨度不足 1s** 或**计数器回退** → 不出数（`—`），不拿两点算斜率、不报负数。
- `title` / `aria-label` 写清本帧的口径来源、窗口内 tokens、实测跨度、采样点数。

**估计与真值彻底分离（v0.5.0 的核心）：**

| 态 | 显示 | 样式 | 来源 |
|---|---|---|---|
| 流式进行中 | `~43 tok/s` | 虚线边 + 降透明度 | `legacy.partial` 实时文本 × 五类标定 |
| 步骤结算后 | `43 tok/s ✓` | 实线边 + 高对比边色 | `sessionStats.decodeTokens` 墙钟斜率（provider 真值） |
| 空闲 | `— tok/s` | 常规 | 无 |

三态由 `data-pulse-src` 探针（`estimate` / `exact` / `idle`）对外暴露，脚本可判定当前读数是不是真值 —— **绝不拿估计冒充真值**。

**每个步骤结算瞬间的「本步真值速率」**：`provider 上报的精确产出 ÷ (首 token → 结算的墙钟)`，写进 tooltip 并暴露为 `data-pulse-step-tps`。不依赖 10 秒窗，结算即可见。

**五类字符在线标定（替代 v0.4.x 的单一标量比）：**

把正文拆成五类 —— 汉字/假名/谚文、拉丁字母、数字、标点符号、空白 —— 每类带一个 `tok/char` 先验：

```
汉字 0.8 / 字母 0.24 / 数字 0.3 / 标点 0.6 / 空白 0.12
```

其中 **汉字 0.80 与字母 0.24 是实测值**：汉字来自 v0.4.x 四轮中文实测的加权 unit 比（0.801 / 0.824 / 0.799 / 0.816）；字母来自 2026-09-22 v0.5.0 实测 —— 一篇纯英文回答 `chars=2855`、真值 `682 tok` → `0.2389 tok/char`。**v0.4.x 的 0.34 是「0.42 权重 × 0.80 种子」反推出来的，从未独立测过，实测证明它偏高 42%** —— 这是 v0.5.0 修掉的一个真错。其余三类暂无独立实测，按中英文标点的实际 tokenizer 行为取值，由回归在会话中继续修正。

每次步骤结算，把「本步五类字符数 → 本步 provider 精确产出」作为一条观测喂进**带岭先验的在线最小二乘**，解出五类速率；解永远存在（λ>0 撑开对角），越界值夹紧到 `[0.02, 2]`。先验权重等价于 3 步数据（`λ = 3 × Σ|x|² ÷ 步数`），所以：

- 先验本来就对时（本机实测情形），残差接近 0，**回归几乎不动** —— 不会拿单步噪声把已经准的先验带偏（verify 有一条专门断言：先验正确时 24 步数据 `Σ|Δ| < 0.02`）；
- 先验错时（换模型 / 换文体），解朝实测方向单调移动。合成数据实测：最坏情形（五类计数 i.i.d. 均匀 → 设计矩阵高度共线）24 步把总误差压掉 **19%**，真实文体分布下压掉 **26%~29%**。

> **诚实说明**：五类速率是弱可辨识的（各步类占比相关），所以这个回归是**保守精修器，不是快速学习器**。它的价值在于「先验对时不动、先验错时朝对的方向走」，而不是几步之内学会一个新模型的 tokenizer。

标定结果按模型 id（`modelSelection` 投影）持久化到 `localStorage`，键 `dsh-pulse:cal:v1`；**新会话第一步就带校准**，不再吃种子误差。换模型自动换桶；投影形状认不出就退回全局桶。`localStorage` 被禁 / 配额满 / 数据损坏 / 被投毒，一律静默降级到先验，绝不崩。

字符分类走 `charCodeAt` 比较而不是正则 —— 采样每 500 ms 要把在飞正文重数一遍，四轮正则每字符的代价是可测的（实测 `0.41 µs/拍` vs `0.24 µs/拍`）。

> **为什么必须有估算线**：宿主在流式进行中**根本不知道 token 数**。`sessionStats.decodeTokens` 只在 `assistant/message` 事件落盘时 +usage（见 `sessionStatsProjectionDefinition.apply` 的 `case "assistant/message"`）；流式阶段走的是客户端独有的 transient `assistant/live-chunk`，**只带文本块和时间戳，不带 usage**。provider 侧同样如此：DeepSeek 适配器发 `stream_options: { include_usage: true }`，源码注释写明 usage 来自 *"the finish chunk or the trailing usage-only chunk"*。所以「流式进行中显示一个精确 tok/s」在这个宿主上**物理不可能** —— 唯一可用的活信号就是文本增长速度。本插件把它标成 `~` 而不是假装精确。

---

## 二、能力边界：**能顶替，不需要 asar 补丁**

> ⚠️ **本节在 v0.6.0 被整节重写过。** v0.5.0 及之前这里写的是「做成插件把内置那枚改成两位小数 —— 做不到」，
> 并据此建议走 asar 补丁路线。**那个结论是错的**，错在把 slot 的 `order` 当成了 `priority`。
> 详见 `TECHNIQUES.md` §1，下面只列结论与证据。

### 2.1 为什么当初以为做不到（两条仍然成立的事实）

| # | 事实 | 位置 |
|---|---|---|
| 1 | **精度在模块内部就定死了，且函数不导出**：`formatCacheHitPercent(cacheReadTokens, promptTokens, decimalPlaces = 0)` 是模块私有；该包只导出 `EMPTY_CHAT_SNAPSHOT / apply / inject / isRunningTool / isSettledTool` | `@deepseek-ai/dsh-client-ui-chat/lib/client.js:3361`、文件尾 `exports.*` |
| 2 | **i18n 拿到的是已经四舍五入好的字符串**：内置 pill 走 `t("stats.cacheHit", { percent: cacheHit })`，`{percent}` 已经是 `"99"` | 同上 `:4019`、`:2630` |

这两条本身没错 —— 所以**不能改内置组件**。但它们推不出「不能顶替它」。

### 2.2 真正的情况：list 型 slot 支持阴影

| # | 事实 | 位置（本机 `app.asar` 可复核） |
|---|---|---|
| 1 | list 型条目按 **`(priority ?? 0)` 升序**、再按 `(order ?? 0)` 升序排序 | `dsh-client-ui-slots/lib/index.js` **L130** |
| 2 | `entriesOfSlot` 取**每个 cell 的第一个存活条目**；**list 的 cell = `entry.options.id`** | 同文件投影实现 |
| 3 | 注册守卫：同 `id` + 同 `priority` 才抛错，提示原文 `register at a different priority to shadow it (lowest renders)` | 同文件 `register` 的 `case "list"` |
| 4 | 内置统计行是 `{ id: "stats", order: 0 }`，**没有 `priority`**（默认 0） | `dsh-client-ui-chat/lib/client.js:8349-8354` |
| 5 | list 渲染只画胜出者，**被阴影的落选条目被 `rowIds.has(...) → continue` 直接跳过** | `dsh-client-ui-renderer/lib/client.js:850-868` |

**结论：`priority` 越低越优先。用同一个 `id: "stats"` + 更低的 `priority` 注册，就能顶替内置那枚，
而且页面上不会出现第二枚。**

### 2.3 本插件怎么做的（v0.6.0）

```js
// 找内置那枚（原始条目视图，含被阴影的落选者）
const original = slots.entries("conversation.composer.dock").find(e =>
  e.options.id === "stats" && (e.options.priority ?? 0) === 0);

// 同 id + 更低 priority 注册阴影；把原组件 inject 进来
slots.register({
  name: "conversation.composer.dock",
  id: "stats",
  priority: Math.min(0, ...已有同 id 的 priority) - 1,
  order: 0,
  locale: original.options.locale ?? "chat",     // 复用内置 i18n 命名空间
  inject: () => ({ Original: original.component })
}, StatsShadow);

// 阴影组件原样渲染内置组件，只把 t 换成拦截版
function StatsShadow({ Original, useProjection, t, ...props }) {
  const usage = useProjection("tokenUsage");
  const view = computeView(usage);               // 本插件的两位小数实现
  const patchedT = (key, params) =>
    key !== "stats.cacheHit" || view === null ? t(key, params)
                                              : t(key, { percent: view.percent });
  return react.createElement(Original, { ...props, useProjection, t: patchedT });
}
```

轮次 / 步骤 / 耗时 / TTFT / token 等显示**逐字不变**（因为渲染的就是内置组件本体），
只有 `stats.cacheHit` 那一个数字被换成两位小数。

### 2.4 取舍表（重写后）

| 诉求 | 本插件（v0.6.0） | asar 补丁（本机实验路线，未随仓库发布） |
|---|---|---|
| 缓存命中显示到两位小数 | ✅（**顶替**内置那枚） | ✅（直接改内置那枚） |
| 库里只剩**一个**「缓存命中」读数 | ✅（实测：可见读数恰好 1 枚） | ✅ |
| DSH 升级后仍存活 | ✅ | ❌（升级整体换 asar，补丁消失，需按新版重打） |
| 需要改产品二进制 / 关闭宿主 | 不需要 | 需要（`app.asar` 被运行中宿主独占） |
| 可版本化 / 可卸载 / 走《发布标准》 | ✅ | ❌ |
| 两个阴影插件同时抢 `stats` | ✅ 用 `priority` 递减协商（`min(已存在) - 1`） | — |

> 一句话：**两条路线现在都能做到「就一个数、且是两位小数」；插件路线还额外耐升级、可卸载。**
> asar 补丁路线因此**不再有存在理由**。

### 2.5 降级路径（这条必须留着）

阴影依赖 `ctx.slots.entries` / `spec` / `subscribe` / `register({inject})`。任一不可用
（老版本 harness、slot 未声明、注册抛错）时，本插件**自动退回 v0.5.0 形态**：
自己补一枚缓存命中 pill（此时会出现内置 `99%` + 本插件 `99.87%` 两枚）。
这条路径由 `verify.mjs` 与 `smoke.mjs` 的降级断言覆盖，且 `data-pulse-shadow` 探针会报 `off`。

---

## 三、装 / 卸

### 从 GitHub 取件

```powershell
git clone https://github.com/qilingzon/dsh-pulse.git
cd dsh-pulse
node verify.mjs            # 先自证：期望 VERIFY-OK / EXIT=0
```

### 装到某个 DSH home

只动你指定的 `<DshHome>`，**默认不碰生产 `~/.dsh`**。

**Linux / macOS / VPS：**

```bash
./install.sh --plan                                   # 先看计划（不动盘）
./install.sh                                          # 用 $DSH_HOME（未设则 ~/.dsh），profile = web
./install.sh --dsh-home /opt/dsh --profiles web,gen4-lab
./install.sh --dsh-home /opt/dsh --profiles web --remove
```

**Windows：**

```powershell
powershell -ExecutionPolicy Bypass -File install.ps1 -DshHome "C:\Users\you\.dsh" -Profiles web -Plan
powershell -ExecutionPolicy Bypass -File install.ps1 -DshHome "C:\Users\you\.dsh" -Profiles web
powershell -ExecutionPolicy Bypass -File uninstall.ps1 -DshHome "C:\Users\you\.dsh" -Profiles web
```

两个脚本行为等价：三处解析位 + profile 注册；**先备份再覆盖**；**逐字节 sha256 回读**；`package.json` 补丁后过 JSON 合法性闸门，**不合法立即回滚**；重复执行幂等。JSON 闸门优先用 `node`，退到 `python3`，都没有才做括号配对粗检（会打印提示）。

也可以不用脚本，直接把本目录当本地包挂进 profile：

```json
"dependencies": { "dsh-pulse": "file:<绝对或相对路径>/dsh-pulse" },
"dsh": { "profile": { "bundles": [ "...", "dsh-pulse" ] } }
```

装完按 B18/B20 的接棒四步收口：`cd <home>/profiles/<profile>` → `pnpm install` → 重启该 profile → **新开对话**（不是刷新旧会话）才见生效。

> ⚠️ **v0.6.0 实测警告：`pnpm install` 这一步有破坏性，不要无脑跑。**
> 2026-09-22 在真实 `gen4_home` 上走查该步时：profile 里**别的**依赖
> （`@deepseek-ai/dsh-session`、`@deepseek-ai/dsh-invariants`）把版本范围钉在 `>=0.1.2 <0.2.0-0`，
> 而 npm 上没有落在这个范围的发布版，于是 `pnpm install` 报 `ERR_PNPM_NO_MATCHING_VERSION` 退出码 1；
> **pnpm 在失败前已经把 `node_modules` 重建了** —— 该 profile 里其它插件（`@linxin666/dsh-web-all`、
> `dshmarket` 等）全部消失，profile 直接起不来（`cannot resolve profile bundle`）。
>
> **安全做法**：只有当该 profile 的**全部**依赖都能解析时才跑 `pnpm install`。
> 本插件的三处解析位里，`<home>/node_modules` 与 `<home>/plugins` 两处**不依赖 pnpm**，
> 只要 profile 的 bundle 注册还在（`install.ps1` 已写），**通常直接重启 profile 就能生效，不需要跑 pnpm**。
> 完整实测记录与恢复步骤见 `STABILITY.md` §2.1。

三处解析位（一个都不能少，B18/B23 的教训）：

```
<home>/node_modules/dsh-pulse
<home>/plugins/dsh-pulse
<home>/profiles/<profile>/node_modules/dsh-pulse
```

---

## 四、自证

```powershell
node verify.mjs   # 纯函数断言：语法 + 两位小数 formatter + 10 秒滑窗算术 + 注册面
node smoke.mjs    # 组件层冒烟：真装载 client.js，假 React 下渲染 PulseDock
node bench.mjs    # 性能实测：每拍开销 / 常驻内存 / 发布体积
npm run harness:test   # verify + smoke 都跑
```

### `verify.mjs`（实测，EXIT=0，200 条断言全 PASS）

按 `// #region` 标记把纯算术区从 `client.js` 里抽出来求值做行为断言（不是文本匹配）。节选：

```
=== 1. 语法检查 ===
  PASS  node --check index.js
  PASS  node --check client.js
=== 2. 抽取 formatter 做行为断言（两位小数） ===
  PASS  两位小数                  f(8743, 10000, 2) = "87.43"
  PASS  部分命中不伪装 100：f(99999, 100000, 2) = "99.999"
  PASS  部分命中不伪装 100：f(999996, 1000000, 2) = "99.9996"
=== 3. 10 秒滑窗速率 + v0.5.0 五类标定（抽取 window 区做行为断言） ===
  PASS  readRate 抽取成功（视图段依赖 windowSlope/formatRate/ratesText 注入）
  PASS  exactOutputTokens 优先 sessionStats = 120
  PASS  exactOutputTokens 回退 tokenUsage = 9
  PASS  formatRate(42.7) = "43"（≥10 取整，同产品 formatTokensPerSecond）
  PASS  满窗斜率：100 tok / 10s = 10 tok/s
  PASS  跨度不足 1s → null（两点斜率不可信）
  PASS  CLASS_COUNT = 5（CJK / 字母 / 数字 / 标点 / 空白）
  PASS  classOfCode 与 classOf 同口径（charCode 快路径，采样每拍要扫全文）
  PASS  全角空格 / 不换行空格 → 空白类
  PASS  countClasses("中文ab12 \n!") = [2,2,2,1,2] 实得 [2,2,2,1,2]
  PASS  countsTotal = 9（等于字符串长度，五类互斥且完备）
  PASS  纯中文 500 字 × 实测先验 0.80 = 400
  PASS  纯英文 400 字 × 实测先验 0.24 = 96（v0.4.x 的 0.34 实测偏高 42%）
  PASS  零数据 → 解恒等于先验（λ 撑开对角，解永远存在）
  PASS  solveLinear 解 2x2：x=[1.6, 1.8] 实得 [1.600000, 1.800000]
  PASS  奇异矩阵 → null（不返回 NaN 解）
  PASS  24 步合成数据（真值 [0.5, 0.25, 0.3, 0.3, 0.1]，先验是错的）→ 总误差 0.6300 → 0.5127（19%）
  PASS  解全部落在 [RATE_MIN, RATE_MAX] 内（夹紧生效，不会解出负数或爆炸值）
  PASS  先验正确时 24 步数据几乎不推动解：Σ|Δ| = 0.00000 < 0.02（回归不能把准的先验带偏）
  PASS  单步拟合把该步预测误差从 84.2 降到 63.2（岭解至少不比先验差）
  PASS  单步只做有限修正：Σ|Δ| = 0.0811 < 1（先验 = 3 步等效，不会被单步数据带飞）
  PASS  被投毒的负数 / NaN → 全部归零（不污染标定）
  PASS  storage 抛错（被禁 / 配额满）→ 静默降级，不崩
  PASS  模型 id 一律挂在 CAL_KEY 命名空间下（不与同源其它应用的键撞名）
  PASS  结算后 CJK 速率 0.80 → 0.90（朝实测 1.2 走 25%）；实得 0.9000
  PASS  本步真值速率 = 600 tok ÷ 2.0s = 300 tok/s；实得 300.0
  PASS  流式态 source = estimate／结算态 source = exact／空态 source = idle
  PASS  结算态 displayKey = =150（= 前缀标记真值）
  PASS  估计↔真值切换必须换指纹 → 不会漏掉 ~ 的消失
=== 4. 注册面静态核对 ===
  PASS  注册目标 = conversation.composer.dock
  PASS  带 data-pulse-src 探针（estimate / exact / idle 三态可外部判定）
  PASS  带 data-pulse-step-tps 探针（本步 provider 真值速率）
  PASS  估计态 / 真值态各有独立样式（虚线 vs 实线）
  PASS  localStorage 访问全部包在 try/catch 里（被禁 / 隐私模式不崩）
  PASS  不发网络请求（分词器 / 词表一律不下载）
VERIFY-OK（全部断言通过）
```

### `smoke.mjs`（实测，EXIT=0，44 条断言全 PASS）

真装载 `client.js`（走 `window.__ModuleLoader__.load`），用假 React 渲染 `PulseDock`：

```
  PASS  ModuleLoader id = dsh-pulse
  PASS  根 span 下有两枚 pill（缓存命中 + 速度）
  PASS  缓存命中 pill = "缓存命中 87.43%"
  PASS  无采样时速度 pill = "— tok/s"
  PASS  空闲态 data-pulse-src = idle（真值 / 估计 / 空闲三态可外部判定）
  PASS  五类标定探针初始就是先验五值：0.8,0.24,0.3,0.6,0.12
  PASS  两个数据源都缺 → 返回 null（不占位）
  PASS  流式估算文案 = "~173 tok/s"／流式态 source = estimate
  PASS  估算态 title 摊开五类标定（结算后 CJK 0.80→0.90）
  PASS  估算态 title 带上本步 provider 真值 300 tok/s
  PASS  结算后精确文案 = "150 tok/s ✓"（带 ✓ 标记真值）／结算态 source = exact
  PASS  空态 source = idle（不拿估计冒充真值）
  PASS  挂载后启动了采样定时器；卸载时 clearInterval 被调用（不泄漏）
  PASS  两拍（0s/2s，100→500 ASCII 字）→ 48 tok/s，实得 48
  PASS  流式 pill 带 ~ 前缀："~48 tok/s"
  PASS  加权 unit 探针仍按旧口径（500 × 0.42 = 210）：210
SMOKE-OK（组件层全部通过）
```

---

## 五、性能负担（实测，不是估算）

`npm run harness:bench` 可复算。测法：把窗口塞满 41 个采样点、处于流式态，循环 20 万次 `stepMeter + displayKey`（即 interval 回调做的全部事），取平均。

```
=== 1. 采样一拍的开销（含满窗 41 点的算术） ===
  满窗采样点数 = 41（RETAIN_MS / SAMPLE_MS + 1）
  最坏一拍 displayKey = ~68
  每拍 = 0.24 µs  （stepMeter + displayKey，200000 次平均）
  20 万拍后缓冲仍为 41 点 → 环形裁剪生效，不随时间增长
  其中 displayKey = 0.04 µs

=== 1b. 五类字符重数（v0.5.0 新增，与正文长度成正比） ===
  样本正文长度 = 9750 字符
  数一遍 9750 字 = 31.12 µs（3.19 ns/字符）
  流式一拍合计（重数 + stepMeter + displayKey）≈ 31.36 µs

=== 2. 折算到真实运行 ===
  采样频率 = 2 次/秒（SAMPLE_MS = 500）
  流式持续 CPU = 62.71 µs/秒 = 0.006271% 单核（按 8000 字正文的上界）
  空闲持续 CPU = 0.48 µs/秒（正文为空，不数字符）
  跑满 1 小时 = 0.226 ms CPU
  跑满 24 小时 = 5.4 ms CPU

=== 3. 常驻内存 ===
  环形缓冲 = 41 个采样点 × 3 个 number = 123 个数值
  粗估堆占用 ≈ 0.96 KiB
  其余状态：ratio / rates[5] / fit（25+5+2 个数）/ stepPeakCounts[5] / lastStep / … —— 常数个标量与定长数组

=== 4. 发布体积 ===
  client.js         45748 B → gzip 15512 B
  index.js            769 B → gzip   616 B
  cordis.patch.yml     48 B → gzip    60 B
  package.json       1870 B → gzip   953 B
  合计              48435 B → gzip 17141 B (16.7 KiB)
```

**五条让它轻的硬约束：**

1. **渲染闸门**：采样循环每拍算一个 `displayKey` 指纹，**和上一帧一样就不 `setState`**。空闲时渲染 **0 帧/秒**；流式时最多 2 帧/秒（且数字没变就不渲）。挂载期间不会出现「为了刷新一个不变的数字而每 500ms 重渲」。v0.5.0 把「估计→真值」也编进指纹，否则那次切换不会重渲。
2. **环形缓冲有界**：`RETAIN_MS = 20000`，缓冲恒为 41 点，**不随时间增长**（20 万拍后仍是 41）。
3. **字符重数是 O(正文长度) 的**：每拍要把在飞正文重数一遍五类字符。9750 字 ≈ 31 µs，即 3.19 ns/字符；2 拍/秒下相当于 `0.0063%` 单核。**这是 v0.5.0 相对 v0.4.x 唯一新增的持续开销**（v0.4.x 是 `0.00004%`）。分类走 `charCodeAt` 而不是正则，实测把这一项从 `0.41 µs/拍`（四轮正则）降到 `0.24 µs/拍`。
4. **宿主侧零增量**：`index.js` 是空实现 —— 不注入提示词、不注册服务、不落盘、不开线程。**VPS 上的 DSH 进程不因本插件多花一个指令。**
5. **浏览器自带节流**：标签页切到后台时，浏览器会把 `setInterval` 节流到约 1 次/分钟 —— 后台挂着更省。

> **对 VPS 部署的含义**：本插件是**客户端（`client.platform: web`）**插件，采样循环跑在**访问者的浏览器**里，不跑在服务器上。VPS 只多传一次 16.7 KiB 的 gzip 静态资源（且随客户端 bundle 缓存），之后 CPU / 内存 / IO 增量都是 0。上面那 0.0063% 单核是**浏览器**的账，不是 VPS 的账。

> 数字取自本机 Node 24 的 `process.hrtime`；浏览器 JIT 与它同量级。要自己复算：`node bench.mjs`。

---

## 六、已知风险

- **两枚读数**：与内置 pill 并存时，一枚 `99%`、一枚 `99.87%`。这是 slot 模型的硬约束，不是 bug（见《能力边界》）。
- **投影未桥接不渲染**：`tokenUsage` 缺失或 `cacheReadTokens` 非数字时返回 `null`，不崩、不占位。
- **速度读数在流式段是估算**：`~` 前缀 + 虚线边即声明这一点，`data-pulse-src` 探针可外部判定。**这个宿主在流式进行中物理上拿不到真值 token 数**（源码证据见《一、2》末尾的引用块），所以任何插件都做不到「流中精确」。本插件能做的是：把估计值和真值在视觉上、探针上、tooltip 上都彻底分开，并让估计值尽快收敛。
- **估计精度取决于内容语言**：汉字 0.80 / 字母 0.24 是实测值，中文与英文回答都在 ±5% 量级（见《七》第二档实机实测表）；**代码、表格、大量数字类内容没有独立实测**，标点 0.6 / 空白 0.12 / 数字 0.3 三类先验是按 tokenizer 行为取的，尚未单独验证。
- **含工具调用的步骤会被低估**：`liveCounts` 只数正文（`text` + `reasoning`），不数 `tool-call` 的参数 —— 而 provider 的 `outputTokens` 把它们算在内。实测一轮含工具调用的多步回答误差 **−13.7%**。这是**口径差**不是 bug，但用户需要知道。
- **回归是保守精修器**：五类速率弱可辨识，24 步最多压掉 19%~29% 的总误差（见《一、2》）。它的价值是「先验对时不动、先验错时朝对的方向走」。
- **速度读数在流式段可能滞后一拍**：采样器读的是「最近一次渲染观测到的 `legacy.partial`」。真实运行时每个 `assistant/live-chunk` 都会触发重渲，所以最坏滞后约一个 chunk；若上游改成批量派发 live chunk，滞后会放大到派发间隔。
- **上游改名即失效**：客户端半部依赖 `window.__ModuleLoader__`、slot 名 `conversation.composer.dock`、投影键 `tokenUsage` / `sessionStats` / `modelSelection`、store 字段 `legacy.partial`。上游换 kind / 改名会在加载期报 slot 错误（`<home>\logs` 可见），届时改 `client.js` 一行即可；`legacy.partial` 缺失只会让速度读数退回精确线（流式段显示 `—`），不会崩；`modelSelection` 形状认不出只会让标定退回全局桶，不影响正确性。
- **`localStorage` 被禁时标定不跨会话**：隐私模式 / 存储被禁 → 每次新会话都从先验起步（回归仍在会话内生效）。这是静默降级，不是错误。

---

## 七、数据真实性分级

本仓库的每个数字都能被归到下面三档之一。**不把第三档说成第一档**是这个项目的底线。

### 第一档 · 源码核对（可复现，证据在 `app.asar`）

| 结论 | 证据 |
|---|---|
| `tokenUsage` 投影字段是 `{ uncachedInputTokens, outputTokens, cacheReadTokens, cacheWriteTokens }` | `tokenUsageOf` 的 totals 初始化 + `TokenUsage` 接口声明 |
| 计费输入口径 = `uncachedInputTokens + cacheReadTokens + cacheWriteTokens` | `function billedInputTokens(usage)` 函数体 |
| 内置那枚只可能是整数 | `cacheHitPercent` 调 `formatCacheHitPercent(usage.cacheReadTokens, billedInputTokens(usage))`，而该函数签名是 `(…, decimalPlaces = 0)`，且模块私有不导出 |
| 速度格式 = ≥10 取整 / <10 一位小数 | `function formatTokensPerSecond(tps)` |
| `sessionStats` 字段 = `{ turns, steps, llmMs, toolMs, ttftMs, ttftSteps, decodeMs, decodeTokens }` | `sessionStatsProjectionDefinition` 的 `wire.view` |
| **`decodeTokens` 只在步骤结算时前进** | 同定义的 `apply`：仅 `case "assistant/message"` 且 `usageOutputTokens(...)` 非空时 `next.decodeTokens += outputTokens` |
| `sessionStats` 只在 `assistant/message` / `tool/result` / `step/end` 推送 | 投影推送分支 `if (type === "assistant/message" \|\| …)` |
| 流式文本走 client-only transient，持久消息在流结束后才 append | `agent-loop.js`：`for await (const chunk of stream) live.push(chunk)`；架构文档「loop 会在 committed end frame 前把完整紧凑 stream 提交为一个 `assistant/message` 或 `assistant/attempt`」 |
| slot `conversation.composer.dock` = `{ kind: "list", scope: "session" }`，契约 props 含 `useChat` / `useProjection` / `t` | 该 slot 的契约登记项（`slots.ts:170`） |
| **插件式占用者确实拿到会话工具包** | `todoDockEntry` 用与本插件**完全相同**的注册形状（`ctx.slots.register({ name, id, order }, Comp)`），组件签名 `{ useProjection, t }` |
| `legacy.partial` = 在飞助手步骤 `{ turn, step, blocks }` | `legacyContribution` 的 `case "assistant-step"` → `data.status === "running"` 分支 |
| block 形状 `{ kind: "text" \| "reasoning" \| "image" \| "tool-call" \| "other", text? }` | `toAssistantBlock` |
| **provider 的 usage 只在流末到达**，流式进行中一个字节都没有 | `dsh-llm-deepseek/lib/index.js`：请求体 `stream_options: { include_usage: true }`；`mapUsage` 的 jsdoc 原文 *"wire usage from the finish chunk or the trailing usage-only chunk"* |
| **harness 自身没有任何分词器** | `dsh-token-meter/lib/types/estimate.js` 的 `CHARS_PER_TOKEN = 4`（整个 harness 的定价都走这个固定密度启发式）；`app.asar` 全部 22094 个条目里没有 `tokenizer.json` / `vocab.json` / tiktoken / `countTokens` 调用 |
| 工具调用块的参数字段是 `argsRaw` | `toAssistantBlock` 的 `case "tool-call"` → `argsRaw: block.arguments` |

### 第二档 · 本机实测（数字是真的，但测的不是浏览器）

| 数字 | 怎么来的 | 边界 |
|---|---|---|
| 每拍 0.24–0.25 µs | `process.hrtime`，20 万次平均，满窗 41 点 | 测的是**纯算术**（`stepMeter + displayKey`），**不含** React 渲染成本 |
| 3.19 ns/字符 | 9750 字正文重数五类字符，5000 次平均 | v0.5.0 新增项，与正文长度成正比；`charCodeAt` 快路径 |
| 缓冲恒 41 点 | 20 万拍后复查 `samples.length` | 与平台无关，可靠 |
| gzip 16.7 KiB | `zlib.gzipSync(level:9)` | 可靠 |
| 200 + 44 条断言全 PASS | `verify.mjs` / `smoke.mjs` | 断言本身可信；但 smoke 用的是**假 React** |
| 0.0063% 单核 | 由上三条按 2 拍/秒折算 | **只算采样算术**，不含渲染 |

> 诚实备注：`bench.mjs` 初版把时间步长写成 1 ms/拍，导致环形缓冲不裁剪、测出「95.58 µs / 20001 点」的退化值。修正为真实 500 ms/拍后才是上面的数字。README 里从未出现过那组错值。

### 第二档（续）· 实机实测（2026-09-22，gen4-lab 真实 DSH web）

环境：`gen4_home` / profile `gen4-lab` / headless Chrome 153 经 CDP 驱动 / 探针读 `data-pulse-*` / 模型 `glm-5.3-flash`。
权威值取自产品自己的 `sessionStats.decodeTokens`（结算后读取），不是我的估算。

**A. v0.3.1 → v0.4.0：标定比从拍脑袋到实测（四条独立回答）**

| 运行 | 代码版本 | 种子比 | 加权 unit | 真实产出 | 真实 tok/unit | 估算误差 |
|---|---|---|---|---|---|---|
| 1 | v0.3.1（原始字符） | 0.5 | chars=16586 | 10896 | ≈0.80（折算） | **−23.9%** |
| 2 | v0.4.0 | 0.62 | 3074 | 2532 | 0.824 | **−24.7%** |
| 3 | v0.4.0 | 0.62 | 467 | 373 | 0.799 | **−22.4%** |
| 4 | v0.4.0 | **0.80** | 490 | 400 | 0.816 | **−2.0%** |

真实折算比稳定在 0.80 ~ 0.82 tok/unit（0.801 / 0.824 / 0.799 / 0.816，极差 3%）。

**B. v0.5.0：三轮不同文体实测（含一轮多步 + 工具调用）**

| 轮次 | 内容 | 步数 | 真值产出 | 估算产出 | **估算误差** | 流中读数 | 结算首帧 | 本步真值 |
|---|---|---|---|---|---|---|---|---|
| R1 | 中文说明文 | 1 | 614 tok | 605 tok | **−1.5%** | `~35 tok/s` | `32 tok/s ✓` | 34.1 tok/s |
| R2 | 英文散文 | 1 | 560 tok | 578 tok | **+3.2%** | `~29 tok/s` | `26 tok/s ✓` | 29.1 tok/s |
| R3 | 中文 + 写文件工具调用 | 3 | 2338 tok | 2477 tok | **+5.9%** | `~57 tok/s` | `39 tok/s ✓` | 52.2 tok/s |

三轮 `data-pulse-src` 迁移序列（探针实测，非推断）：

```
R1  estimate→idle→exact→idle
R2  idle→estimate→idle→exact→idle
R3  idle→estimate→idle→exact→estimate→exact→idle→estimate→idle→exact→idle    ← 三步，逐步正确翻转
```

**结论一：估计值与真值已彻底分离且可外部判定。** 三轮都在 ±6% 以内；`~` / `✓` 两种标记与 `data-pulse-src` 三态一一对应。

**结论二：修掉了一个真 bug —— 结算后的「真值」假尖峰。** v0.4.x 只对估算线做等比回填，`exact` 线仍是 provider 的**阶跃计数器**：一次性 usage 上报被 10 秒窗读成瞬时吞吐。v0.5.0 首轮实测抓到 R1 结算后显示 **`159 tok/s ✓` 并持续整个 10 秒窗**，而该步真实速率是 **37.8 tok/s** —— 放大了 **4 倍**。改为两条线共用同一条重建曲线后，结算首帧 / 本步真值的比值降到 **0.94 / 0.89 / 0.75**。

**结论三：字母先验 0.34 是错的，实测应为 0.24。** v0.4.x 的 `0.34 tok/char` 是「0.42 权重 × 0.80 种子」反推出来的，从未独立测过。v0.5.0 首轮实测一篇纯英文回答 `chars=2855`、真值 `682 tok` → `0.2389 tok/char`，**旧先验偏高 42%**，导致英文回答估算 **+39.1%**。改为 0.24 后降到 **+3.2%**。

**结论四：工具调用参数必须计入。** v0.4.x 只数正文，而 provider 的 `outputTokens` 包含工具调用 JSON。一轮含工具调用的多步回答因此**低估 16.4%**。计入 `name` / `argsRaw` 后变为 **+5.9%**。

**结论五：回归在先验正确时确实不动。** 三轮结算后 `data-pulse-rates` 实测：

```
先验     0.80    / 0.24    / 0.30    / 0.60    / 0.12
R1 结算后 0.80255 / 0.24211 / 0.30036 / 0.60069 / 0.12053
R2 结算后 0.80084 / 0.23764 / 0.30001 / 0.60000 / 0.11951
R3 结算后 0.79884 / 0.21903 / 0.30026 / 0.59815 / 0.11623
```

—— 与先验同量级，没有漂移。这正是 verify 里那条 `Σ|Δ| < 0.02` 断言的实机对照。

复现脚本见 `.diag\dsh-pulse-upload\`（`cdp_measure5.mjs` / `analyze5.mjs`），未随仓库发布。

### 第三档 · 仍未验证的推断（必须承认）

| 事项 | 状态 |
|---|---|
| 「空闲 0 帧/秒」 | 代码层推论（`displayKey` 闸门 + 单测覆盖），未在浏览器里数帧。 |
| 「浏览器后台节流约 1 次/分钟」 | 通用行为，未在本机验证具体浏览器版本。 |
| 首帧延迟、视觉抖动、数字跳动 | 只观察了采样序列，没有逐帧目视。 |
| **其他模型** | 全部实测都在 `glm-5.3-flash`（lab 默认）上。换模型时前 1~2 步会重新收敛，但**未在第二个模型上验证过**。 |
| **标点 / 空白 / 数字三类先验** | 汉字 0.80 与字母 0.24 是实测值；标点 0.60 / 空白 0.12 / 数字 0.30 按 tokenizer 行为取值，**没有独立实测**。 |
| **`pnpm install` 收口步** | ✅ **已走查（v0.6.0）** —— 结论是它在本 lab profile 上**跑不通且有破坏性**，见《装 / 卸》的警告框与 `STABILITY.md` §2.1 |
| **对真实 gen4_home 的 `--remove`** | 只在假 home 执行过。 |
| **React 真实调度 / 卸载竞态** | smoke 用的是假 React 替身。 |
| **生产 `C:\Users\qiling\.dsh`** | 按 C10/C11 全程未触碰。 |

> 估计帧滞后：DOM 上的 `data-pulse-est` 最多比内部状态旧 **0.6~1.2 秒**（渲染闸门只在「格式化后的数字」变化时才重渲）。上表的估算误差已包含这段滞后。结算瞬间数字收敛到真值，偏差不累积。
