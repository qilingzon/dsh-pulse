# dsh-pulse · 缓存命中两位小数 + 10 秒输出速度

> DeepSeek Harness 客户端插件：在 composer dock 增加两枚只读读数 —— **缓存命中两位小数** 与 **10 秒滑窗平均输出速度（tok/s）**。不改产品二进制、可版本化、可卸载。
>
> 仓库：<https://github.com/qilingzon/dsh-pulse> ｜ 许可：MIT ｜ 版本：0.3.0
>
> 前身是本地实验件 `dsh-cachehit-2dp`（A27），本仓库是它的正式发布形态。当时并行的另一条路线是 asar 最小增量补丁（未随仓库发布，仅存于本机实验目录）。两条路线的能力不同，见下面《能力边界》——**先看那张表再选**。

---

## 一、它做什么

在 `conversation.composer.dock` 注册两枚**只读** pill：

```
缓存命中 99.87%   42.7 tok/s
```

### 1. 缓存命中（两位小数）

- 数据来自 `useProjection("tokenUsage")` —— 与内置那枚**同一个投影**，不是估算、不是另算一份账。
- 口径与内置完全一致：`缓存读取 ÷ (未缓存输入 + 缓存读取 + 缓存写入)`；「部分命中绝不显示 100%」的诚实分支逐字同源。
- `title` / `aria-label` 给出精确明细：`会话累计缓存命中 99.87% ｜ 缓存读取 1,234,567 tok ｜ 未缓存输入 16,234 tok ｜ 缓存写入 0 tok ｜ 计费输入 1,250,801 tok`。
- 不写宿主、不碰 DOM、不引用产品 CSS 类名、不走 RPC、不注册服务。

### 2. 10 秒滑窗平均输出速度（tok/s）

- **窗口**：10000 ms 墙钟，采样间隔 500 ms，环形缓冲保留两倍窗长（取窗沿锚点，跨度尽量贴满 10s）。
- **格式**：与产品 `formatTokensPerSecond` 同款 —— `≥10` 取整（`43 tok/s`），`<10` 保留一位小数（`9.9 tok/s`）。
- **空闲**：窗内没有新增输出 → 显示 `— tok/s`，不显示假的 `0.0`。
- **跨度不足 1s** 或**计数器回退** → 不出数（`—`），不拿两点算斜率、不报负数。
- `title` / `aria-label` 写清本帧的口径来源、窗口内 tokens、实测跨度、采样点数。

**两条数据线（这是本读数的关键设计）：**

| | 来源 | 何时前进 | 显示 |
|---|---|---|---|
| **精确线** | `useProjection("sessionStats").decodeTokens` 的墙钟斜率 | 只在 `assistant/message` 落盘（步骤结算、provider 上报 usage）时 | `43 tok/s` |
| **估算线** | `useChat(s => s.legacy.partial)` 的实时正文字符数增量 × 标定比 | 每个 `assistant/live-chunk`（流式进行中） | `~43 tok/s` |

估算线**自标定**：每次步骤结算时，用「本步精确 tokens ÷ 本步字符数」重算 `chars/token`（夹紧在 `[0.05, 8]`），下一步的实时折算就用这个实测比。步骤一结算，估算值立刻收敛回精确值 —— 两条线是同一根累计曲线，不会跳变。

> **为什么必须有估算线**：宿主在流式进行中**根本不知道 token 数**。`sessionStats.decodeTokens` 只在 `assistant/message` 事件落盘时 +usage（见 `sessionStatsProjectionDefinition.apply` 的 `case "assistant/message"`）；流式阶段走的是客户端独有的 transient `assistant/live-chunk`，**只带文本块和时间戳，不带 usage**。所以「流式进行中显示一个精确 tok/s」在这个宿主上不可能 —— 唯一可用的活信号就是文本增长速度。本插件把它标成 `~` 而不是假装精确。

---

## 二、能力边界：**能加，不能顶替**

「做成插件，把内置那枚改成两位小数」——**做不到**。三条硬证据（都可回读复核）：

| # | 证据 | 位置 |
|---|---|---|
| 1 | **精度在模块内部就定死了，且函数不导出**：`formatCacheHitPercent(cacheReadTokens, promptTokens, decimalPlaces = 0)` 是模块私有；该包只导出 `EMPTY_CHAT_SNAPSHOT / apply / inject / isRunningTool / isSettledTool` —— 插件没有任何可替换的入口 | `@deepseek-ai/dsh-client-ui-chat/lib/client.js:3361`、文件尾 `exports.*` |
| 2 | **i18n 拿到的是已经四舍五入好的字符串**：内置 pill 走 `t("stats.cacheHit", { percent: cacheHit })`，`{percent}` 已经是 `"99"` —— 就算插件覆盖 `ui-chat` 命名空间的文案，也补不回精度 | 同上 `:4019`、`:2630` |
| 3 | **slot 是 list 型，没有可顶替的席位**：`conversation.composer.dock` 声明为 `{ kind: "list", scope: "session" }`，`ui-chat` 已用 `id: "stats"` 占位；注册表对 list 型的重复判定是 `id + priority`，换 priority 注册只是**并列多一枚**；渲染侧对 list 型是 `[...rows].sort(by order)` **全量渲染**，不是择优 | `dsh-client-ui-conversation/lib/client.js:16744`、`dsh-client-ui-slots/lib/index.js:91-93`、`dsh-client-ui-renderer/lib/client.js:866` |

**取舍表：**

| 诉求 | 插件（本包） | asar 补丁（本机实验路线，未随仓库发布） |
|---|---|---|
| 缓存命中显示到两位小数 | ✅（另加一枚读数） | ✅（直接改内置那枚） |
| 库里只剩**一个**「缓存命中」读数 | ❌ | ✅ |
| DSH 升级后仍存活 | ✅ | ❌（升级整体换 asar，补丁消失，需按新版重打） |
| 需要改产品二进制 / 关闭宿主 | 不需要 | 需要（`app.asar` 被运行中宿主独占） |
| 可版本化 / 可卸载 / 走《发布标准》 | ✅ | ❌ |

> 一句话：**要「就一个数、且是两位小数」→ asar 补丁；要「耐升级、可维护、可卸载」→ 插件。** 两者可并存，但并存会出现两枚读数（`99%` 与 `99.87%`）。

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

### `verify.mjs`（实测，EXIT=0，63 条断言全 PASS）

```
=== 1. 语法检查 ===
  PASS  node --check index.js
  PASS  node --check client.js
=== 2. 抽取 formatter 做行为断言（两位小数） ===
  PASS  全命中 = 100（语义不变）  f(10000, 10000, 2) = "100"
  PASS  两位小数                  f(8743, 10000, 2) = "87.43"
  PASS  两位上界                  f(9999, 10000, 2) = "99.99"
  PASS  末位 0 补齐两位            f(8740, 10000, 2) = "87.40"
  PASS  前导 0 补齐两位            f(8705, 10000, 2) = "87.05"
  PASS  整值不带小数点             f(8700, 10000, 2) = "87"
  PASS  零命中                    f(0, 10000, 2) = "0"
  PASS  1 位调用者行为不变         f(8743, 10000, 1) = "87.4"
  PASS  0 位调用者行为不变         f(8743, 10000, 0) = "87"
  PASS  无计费输入 → null          f(1, 0, 2) = null
  PASS  部分命中不伪装 100：f(99999, 100000, 2) = "99.999"
  PASS  部分命中不伪装 100：f(999996, 1000000, 2) = "99.9996"
=== 3. 10 秒滑窗速率（抽取 window 区做行为断言） ===
  PASS  liveChars 只数 text+reasoning（5+2=7），不数 tool-call 参数
  PASS  exactOutputTokens 优先 sessionStats = 120
  PASS  exactOutputTokens 回退 tokenUsage = 9
  PASS  两个投影都缺 → null（不出数，不猜）
  PASS  formatRate(42.7) = "43"（≥10 取整，同产品 formatTokensPerSecond）
  PASS  formatRate(9.87) = "9.9"（<10 保留一位小数）
  PASS  calibrateRatio 越界夹紧（下界 0.05 / 上界 8）
  PASS  pushSample 裁掉窗外旧点：剩 6 点、最老 t=5000
  PASS  满窗斜率：100 tok / 10s = 10 tok/s
  PASS  窗沿锚点取到 t=2000：80 tok / 8s = 10 tok/s
  PASS  跨度不足 1s → null（两点斜率不可信）
  PASS  计数器回退 → null（不报负数）
  PASS  步骤结算 → 标定比 = 600 tokens / 500 字符 = 1.2
  PASS  结算后估算收敛回精确值 600（不跳变）
  PASS  第二步用新比：600 + 100 × 1.2 = 720
  PASS  估算窗斜率 = 720 tok / 4s = 180 tok/s
  PASS  精确窗斜率 = 600 tok / 4s = 150 tok/s（流式段仍是平线，故低于估算）
=== 4. 注册面静态核对 ===
  PASS  注册目标 = conversation.composer.dock
  PASS  entry id = "pulse"（不与内置 "stats" 撞 id）
  PASS  order = 1（紧随内置 order 0）
  PASS  滑窗 = 10000ms（用户令「10s 内」）
  PASS  读 sessionStats 投影（精确输出 tokens 的唯一权威来源）
  PASS  读 legacy.partial（流式进行中宿主没有 usage，只有这份实时文本）
  PASS  采样循环随卸载清理（不泄漏定时器）
  PASS  速度读数带 data-pulse-tps 探针
  PASS  ModuleLoader id = dsh-pulse
  PASS  不碰 DOM / 不引用产品选择器
  PASS  不走宿主 RPC（纯读投影）
VERIFY-OK（全部断言通过）
```

### `smoke.mjs`（实测，EXIT=0，22 条断言全 PASS）

真装载 `client.js`（走 `window.__ModuleLoader__.load`），用假 React 渲染 `PulseDock`：

```
  PASS  ModuleLoader id = dsh-pulse
  PASS  根 span 下有两枚 pill（缓存命中 + 速度）
  PASS  缓存命中 pill = "缓存命中 87.43%"
  PASS  无采样时速度 pill = "— tok/s"
  PASS  两个数据源都缺 → 返回 null（不占位）
  PASS  流式估算文案 = "~180 tok/s"
  PASS  估算态 title 明示「流式进行中」／带标定比
  PASS  结算后精确文案 = "150 tok/s"（不带 ~）／title 写明口径来源
  PASS  挂载后启动了采样定时器；卸载时 clearInterval 被调用（不泄漏）
  PASS  两拍（0s/2s，100→500 字符）→ 200 估算 tok / 2s = 100 tok/s
  PASS  流式 pill 带 ~ 前缀："~100 tok/s"
SMOKE-OK（组件层全部通过）
```

---

## 五、性能负担（实测，不是估算）

`npm run harness:bench` 可复算。测法：把窗口塞满 41 个采样点、处于流式态，循环 20 万次 `stepMeter + displayKey`（即 interval 回调做的全部事），取平均。

```
=== 1. 采样一拍的开销（含满窗 41 点的算术） ===
  满窗采样点数 = 41（RETAIN_MS / SAMPLE_MS + 1）
  每拍 = 0.22 µs  （stepMeter + displayKey，200000 次平均）
  20 万拍后缓冲仍为 41 点 → 环形裁剪生效，不随时间增长

=== 2. 折算到真实运行 ===
  采样频率 = 2 次/秒（SAMPLE_MS = 500）
  持续 CPU = 0.43 µs/秒 = 0.000043% 单核
  跑满 1 小时 = 0.002 ms CPU

=== 3. 常驻内存 ===
  环形缓冲 = 41 个采样点 × 3 个 number = 123 个数值
  粗估堆占用 ≈ 0.96 KiB
  其余状态：ratio / running / stepStartTokens / stepPeakChars / estTokens / renderedKey —— 6 个标量

=== 4. 发布体积 ===
  client.js  23011 B → gzip 7849 B
  index.js     769 B → gzip  616 B
  cordis.patch.yml 48 B → gzip 60 B
  package.json 1569 B → gzip 766 B
  合计       25397 B → gzip 9291 B (9.1 KiB)
```

**四条让它轻的硬约束：**

1. **渲染闸门**：采样循环每拍算一个 `displayKey` 指纹，**和上一帧一样就不 `setState`**。空闲时渲染 **0 帧/秒**；流式时最多 2 帧/秒（且数字没变就不渲）。挂载期间不会出现「为了刷新一个不变的数字而每 500ms 重渲」。
2. **环形缓冲有界**：`RETAIN_MS = 20000`，缓冲恒为 41 点，**不随时间增长**（20 万拍后仍是 41）。
3. **宿主侧零增量**：`index.js` 是空实现 —— 不注入提示词、不注册服务、不落盘、不开线程。**VPS 上的 DSH 进程不因本插件多花一个指令。**
4. **浏览器自带节流**：标签页切到后台时，浏览器会把 `setInterval` 节流到约 1 次/分钟 —— 后台挂着更省。

> **对 VPS 部署的含义**：本插件是**客户端（`client.platform: web`）**插件，采样循环跑在**访问者的浏览器**里，不跑在服务器上。VPS 只多传一次 9.1 KiB 的 gzip 静态资源（且随客户端 bundle 缓存），之后 CPU / 内存 / IO 增量都是 0。上面那 0.000043% 单核是**浏览器**的账，不是 VPS 的账。

> 数字取自本机 Node 20 的 `process.hrtime`；浏览器 JIT 与它同量级。要自己复算：`node bench.mjs`。

---

## 六、已知风险

- **两枚读数**：与内置 pill 并存时，一枚 `99%`、一枚 `99.87%`。这是 slot 模型的硬约束，不是 bug（见《能力边界》）。
- **投影未桥接不渲染**：`tokenUsage` 缺失或 `cacheReadTokens` 非数字时返回 `null`，不崩、不占位。
- **速度读数在流式段是估算**：`~` 前缀即声明这一点。首步未标定前用种子比 `0.5 chars/token`（中英混排经验值），误差可能到 ±50%；一个步骤结算后即换成本会话实测比，误差随之收敛。
- **速度读数在流式段可能滞后一拍**：采样器读的是「最近一次渲染观测到的 `legacy.partial`」。真实运行时每个 `assistant/live-chunk` 都会触发重渲，所以最坏滞后约一个 chunk；若上游改成批量派发 live chunk，滞后会放大到派发间隔。
- **上游改名即失效**：客户端半部依赖 `window.__ModuleLoader__`、slot 名 `conversation.composer.dock`、投影键 `tokenUsage` / `sessionStats`、store 字段 `legacy.partial`。上游换 kind / 改名会在加载期报 slot 错误（`<home>\logs` 可见），届时改 `client.js` 一行即可；`legacy.partial` 缺失只会让速度读数退回精确线（流式段显示 `—`），不会崩。
- **未经运行期实测**：本仓库内过了静态自证（`verify.mjs`）与组件层冒烟（`smoke.mjs`），但**没有在真实浏览器里跑过**；实弹要走 lab 的 web 实验窗。

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

### 第二档 · 本机实测（数字是真的，但测的不是浏览器）

| 数字 | 怎么来的 | 边界 |
|---|---|---|
| 每拍 0.21–0.22 µs | `process.hrtime`，20 万次平均，满窗 41 点 | 测的是**纯算术**，**不含** React 渲染成本 |
| 缓冲恒 41 点 | 20 万拍后复查 `samples.length` | 与平台无关，可靠 |
| gzip 9.1 KiB | `zlib.gzipSync(level:9)` | 可靠 |
| 63 + 22 条断言全 PASS | `verify.mjs` / `smoke.mjs` | 断言本身可信；但 smoke 用的是**假 React** |
| 0.000043% 单核 | 由上两条折算 | **只算采样算术**，不含渲染 |

> 诚实备注：`bench.mjs` 初版把时间步长写成 1 ms/拍，导致环形缓冲不裁剪、测出「95.58 µs / 20001 点」的退化值。修正为真实 500 ms/拍后才是上面的数字。README 里从未出现过那组错值。

### 第三档 · 未验证的推断（必须承认）

| 事项 | 状态 |
|---|---|
| **在真实浏览器里跑起来了吗** | **没有**。从未在真实 DSH 中加载过本插件，只过了假 React 冒烟。 |
| **tok/s 准不准** | **没测过**。精确线用的是产品自己的账，可信；估算线的 `chars/token` 种子 `0.5` 是经验值，README《已知风险》里写的「±50%」同样是估的，**不是实测**。 |
| 「空闲 0 帧/秒」 | 代码层推论（`displayKey` 闸门 + 单测覆盖），非浏览器实测。 |
| 「浏览器后台节流约 1 次/分钟」 | 通用行为，未在本机验证具体浏览器版本。 |
| 首帧延迟、视觉抖动、数字跳动 | 全部未观察过。 |

**要把第三档转成第一/第二档，只需要做一件事**：把插件装进 lab 的 web 实验窗，开一个长回答，录下流式期间的读数与真实 `usage.outputTokens` 对照。本仓库目前没有这个数据，所以不声称有。
