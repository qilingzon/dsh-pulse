# dsh-pulse · 缓存命中两位小数（插件版）

> DeepSeek Harness 客户端插件：把「缓存命中」的百分比从整数读数升级为**两位小数**读数 —— 不改产品二进制、可版本化、可卸载。
>
> 仓库：<https://github.com/qilingzon/dsh-pulse> ｜ 许可：MIT ｜ 版本：0.1.0
>
> 前身是本地实验件 `dsh-cachehit-2dp`（A27），本仓库是它的正式发布形态。当时并行的另一条路线是 asar 最小增量补丁（未随仓库发布，仅存于本机实验目录）。两条路线的能力不同，见下面《能力边界》——**先看那张表再选**。

---

## 一、它做什么

在 `conversation.composer.dock` 注册一枚**只读** pill：

```
缓存命中 99.87%
```

- 数据来自 `useProjection("tokenUsage")` —— 与内置那枚**同一个投影**，不是估算、不是另算一份账。
- 口径与内置完全一致：`缓存读取 ÷ (未缓存输入 + 缓存读取 + 缓存写入)`；「部分命中绝不显示 100%」的诚实分支逐字同源。
- `title` / `aria-label` 给出精确明细：`会话累计缓存命中 99.87% ｜ 缓存读取 1,234,567 tok ｜ 未缓存输入 16,234 tok ｜ 缓存写入 0 tok ｜ 计费输入 1,250,801 tok`。
- 不写宿主、不碰 DOM、不引用产品 CSS 类名、不走 RPC、不注册服务。

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

只动你指定的 `<DshHome>`，**默认不碰生产 `C:\Users\you\.dsh`**。

```powershell
# 先看计划（不动盘）
powershell -ExecutionPolicy Bypass -File install.ps1 -DshHome "C:\Users\you\.dsh" -Profiles web -Plan

# 安装（三处解析位 + profile 注册；自动备份；逐字节回读；JSON 非法自动回滚）
powershell -ExecutionPolicy Bypass -File install.ps1 -DshHome "C:\Users\you\.dsh" -Profiles web

# 卸载
powershell -ExecutionPolicy Bypass -File uninstall.ps1 -DshHome "C:\Users\you\.dsh" -Profiles web
```

也可以不用脚本，直接把本目录当本地包挂进 profile：

```json
"dependencies": { "dsh-pulse": "file:<绝对或相对路径>/dsh-pulse" },
"dsh": { "profile": { "bundles": [ "...", "dsh-pulse" ] } }
```

装完按 B18/B20 的接棒四步收口：`cd <home>\profiles\<profile>` → `pnpm install` → 重启该 profile → **新开对话**（不是刷新旧会话）才见生效。

三处解析位（一个都不能少，B18/B23 的教训）：

```
<home>\node_modules\dsh-pulse
<home>\plugins\dsh-pulse
<home>\profiles\<profile>\node_modules\dsh-pulse
```

---

## 四、自证

```powershell
node verify.mjs
```

输出（实测，EXIT=0）：

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
=== 3. 注册面静态核对 ===
  PASS  注册目标 = conversation.composer.dock
  PASS  entry id = "pulse"（不与内置 "stats" 撞 id）
  PASS  order = 1（紧随内置 order 0）
  PASS  声明 locale 席位 → 组件拿到 t
  PASS  ModuleLoader id = dsh-pulse
  PASS  require("react")
  PASS  导出 inject / apply
  PASS  不碰 DOM / 不引用产品选择器
  PASS  不走宿主 RPC（纯读投影）
VERIFY-OK（全部断言通过）
```

---

## 五、已知风险

- **两枚读数**：与内置 pill 并存时，一枚 `99%`、一枚 `99.87%`。这是 slot 模型的硬约束，不是 bug（见《能力边界》）。
- **投影未桥接不渲染**：`tokenUsage` 缺失或 `cacheReadTokens` 非数字时返回 `null`，不崩、不占位。
- **上游改名即失效**：客户端半部依赖 `window.__ModuleLoader__`、slot 名 `conversation.composer.dock`、投影键 `tokenUsage`。上游换 kind / 改名会在加载期报 slot 错误（`<home>\logs` 可见），届时改 `client.js` 一行即可。
- **未经运行期实测**：本仓库内只过了静态自证（`verify.mjs`）；浏览器实弹要走 lab 的 web 实验窗。
