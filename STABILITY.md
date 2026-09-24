# dsh-pulse 稳定性与降级矩阵

> 建立时间：2026-09-22 ｜ 版本：v0.6.0
> 目的：把「什么情况下会降级 / 降级后用户看到什么 / 怎么恢复」写成一张能查的表，
> 并把 2026-09-22 实机走查发现的**危险操作**明确标出来。
> 证据等级：本文件的实测结论均为**第一档**（本机 `gen4_home` 上真实执行，日志见 `.diag/dsh-pulse-upload/`）。

---

## 一、降级矩阵

| 触发条件 | 本插件的行为 | 用户看到什么 | 判定探针 | 怎么恢复 |
|---|---|---|---|---|
| 一切正常 | 阴影顶替内置统计行 + 补一枚 tok/s | `缓存命中 53.76%` + `26 tok/s ✓` | `data-pulse-shadow="on"` | — |
| `ctx.slots.entries` / `spec` / `subscribe` / `register({inject})` 任一不存在（老版本 harness） | **不注册阴影**，退回「自己补一枚缓存命中」 | 两枚缓存命中：内置 `54%` + 本插件 `53.76%` | `data-pulse-shadow="off"` | 升级 harness |
| slot `conversation.composer.dock` 尚未声明（本插件比内置先加载） | 先不注册，`slots.subscribe` 等到声明后**自动补注册** | 短暂只有 tok/s，随后出现两位小数缓存命中 | `off` → `on` | 无需干预 |
| 阴影注册抛错（priority 撞车等） | **吞掉异常**，清 handle，退回降级路径 | 同「老版本 harness」那一行 | `off` | 检查是否有别的插件也抢 `stats` |
| 拿不到原组件（`Original` 不是组件类型） | 阴影组件**整枚不渲染** | 统计行消失（但 dock 不崩、tok/s 仍在） | `on` 但无缓存命中读数 | 报 issue；临时 `-Remove` 本插件 |
| 拿不到 `t`（i18n 席位缺失） | 同上 | 同上 | 同上 | 同上 |
| `tokenUsage` 投影缺失 / `cacheReadTokens` 非数字 | 不渲染缓存命中读数（不猜、不显示 0%） | 只有 tok/s | — | 等投影就绪 |
| `legacy.partial` 缺失（宿主改名） | 速度读数退回精确线，流式段显示 `—` | `— tok/s` | `data-pulse-src="idle"` | 改 `client.js` 一行 |
| `localStorage` 被禁（隐私模式）/ 配额满 / 数据损坏 / 被投毒 | **静默降级**：标定只在本会话内生效，坏数据全部归零 | 无差异（读数照常，只是不跨会话学习） | `data-pulse-rates` 等于先验 | 无需干预 |
| `sessionStats` 与 `tokenUsage` 都不可用 | `PulseDock` 返回 `null` | dock 不占位 | — | 等投影就绪 |
| 采样器读到计数器回退 / 跨度不足 1s | 不出数 | `— tok/s` | `data-pulse-src="idle"` | 无需干预 |

**降级的总原则：宁可少一枚读数，也绝不弄坏 dock。** 所有宿主侧调用都包在 `try/catch` 里，
所有投影读取都走 `readProjection` 之类的防御性封装，`ensureStatsShadow` 的 catch 会清 handle 并复位状态。

---

## 二、安装 / 卸载闭环实测（2026-09-22，真实 `gen4_home`）

完整日志：`.diag/dsh-pulse-upload/install-closure.log`

| 步骤 | 结果 |
|---|---|
| 安装前快照 | 三处解析位存在；profile `package.json` 555 字符 / sha256 `6A165ACB…` |
| `install.ps1 -Remove` | 三处解析位**全部清空** ✅；profile 摘除成功 ✅ |
| 卸载后 JSON 合法性 | ✅（v0.6.0 修掉文本替换的双逗号 bug 之前，这一步产出**非法 JSON**） |
| `install.ps1` 重装 | 三处解析位 **sha256 12/12 MATCH** ✅ |
| profile 注册 | `bundles=7 dep=file:../../plugins/dsh-pulse` ✅ JSON 合法 |
| `pnpm install` | ❌ **退出码 1**，见下 |

### ⚠️ 2.1 `pnpm install` 这一步在 lab profile 上**跑不通**，而且**有破坏性**

```
ERR_PNPM_NO_MATCHING_VERSION
No matching version found for @deepseek-ai/dsh-session@>=0.1.2 <0.2.0-0
  The latest release of @deepseek-ai/dsh-session is "0.0.1-rc.1"
  Other releases are: alpha: 0.1.7-alpha.2 / next: 0.1.7-rc.2
```

- **原因与本插件无关**：profile 里别的依赖（`@deepseek-ai/dsh-session`、`@deepseek-ai/dsh-invariants`）
  把版本范围钉在 `>=0.1.2 <0.2.0-0`，而 npm 上没有落在这个范围的发布版。
- **破坏性**：pnpm 在解析失败前会**重建 `node_modules`**。实测结果：
  `profiles/gen4-lab/node_modules` 从「一堆包」变成只剩 `.ignored / dsh-pulse / .package-map.json /
  .pnpm-workspace-state-v1.json` —— 其余插件（`@linxin666/dsh-web-all`、`dshmarket`、
  `dsh-infinite-gen-4`、`dsh-cachehit-2dp`）**全部消失**，profile 直接起不来：
  ```
  dsh: cannot resolve profile bundle "@linxin666/dsh-web-all" from the dsh installation
       or D:\...\gen4_home\profiles\gen4-lab
  ```
- **恢复办法**（本次实际采用）：把 profile 的 `bundles` 收敛到能从安装目录解析的官方 bundle + 本插件，
  即 `["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "dsh-pulse"]`，
  `dependencies` 只留 `{"dsh-pulse": "file:../../plugins/dsh-pulse"}`，然后重启。
  重启后阴影**仍然生效**（`data-pulse-shadow="on"`，缓存命中读数 1 枚两位小数）。

> **给用户的警告（README《装 / 卸》应据此修改）**：
> **不要在已经有其它本地插件的 profile 上跑 `pnpm install`**，除非你确认该 profile 的所有依赖
> 都能解析。它失败时会把 `node_modules` 清掉一半，比不做还糟。
> 本插件的三处解析位里，`<home>/node_modules` 与 `<home>/plugins` 两处**不依赖 pnpm**，
> 所以即使 `pnpm install` 失败，只要 profile 的 bundle 注册还在，插件通常仍能加载。

### 2.2 `install.sh` 与 `install.ps1` 的差异（已对齐）

| | 注册/摘除 profile 的方式 |
|---|---|
| `install.sh` | 本来就用 `node -e` / `python3 -c` 做 **JSON 语义编辑**，另有 sed 兜底 |
| `install.ps1` | v0.5.0 及之前用**文本替换** → 实测产出 `,"dsh-cachehit-2dp",,"dsh-pulse"]` 双逗号非法 JSON；v0.6.0 起改为调用 `profile-edit.cjs` |

---

## 三、编码：同一类坑踩了四次，现在有断言钉死

| # | 时间 | 文件 | 症状 | 原因 |
|---|---|---|---|---|
| 1 | v0.4.0 | `install.ps1` | Windows PowerShell 5.1 解析失败（中文引号打断） | UTF-8 **无 BOM**，5.1 按 ANSI 读 |
| 2 | v0.6.0 本轮 | `package.json` | `dsh` profile 加载器硬失败：`Unexpected token '锘?, "锘縶"name"...` | 被 `Set-Content -Encoding UTF8` 写出了 **BOM** |
| 3 | v0.6.0 本轮 | `install_closure.ps1`（临时脚本） | PS 5.1 解析失败 | `write` 工具写的 `.ps1` **无 BOM** |
| 4 | v0.6.0 本轮 | `install.ps1`（被我 edit 过） | 安装器自身解析失败 → 部署中断 | **`edit` 工具改过的 `.ps1` 会丢 BOM** |

**规则（现已由 `verify.mjs` 第 7 节强制执行）**：

- **`.json` 文件一律不许带 BOM**（否则 dsh 的 profile 加载器 `JSON.parse` 硬失败）。
- **`.ps1` 文件一律必须带 BOM**（否则 Windows PowerShell 5.1 按 ANSI 读中文注释而解析失败）。
  断言会**扫描仓库里所有 `.ps1`**，而不只是已知的两个 —— 因为第 4 次就是这么漏掉的。

---

## 四、异常路径覆盖（哪些测过、哪些没有）

| 异常 | 覆盖方式 | 状态 |
|---|---|---|
| 阴影 API 缺失 | `verify.mjs` 假 ctx（`noEntriesApi`） | ✅ |
| slot 未声明 | `verify.mjs` 假 ctx（`specValue: undefined`） | ✅ |
| 注册抛错 | `verify.mjs` 假 ctx（`throwOnRegister`） | ✅ |
| `ctx` 为 `null` / 无 `slots` | `verify.mjs` | ✅ |
| 拿不到原组件 / 拿不到 `t` | `verify.mjs` + `smoke.mjs` | ✅ |
| `localStorage` 被禁 / 配额满 | `verify.mjs`（`badStorage` 抛错） | ✅ |
| localStorage 数据损坏 / 版本不符 / 维度不符 / 被投毒 | `verify.mjs`（4 种坏输入） | ✅ |
| `tokenUsage` 缺失 / 非数字 | `verify.mjs` + `smoke.mjs` | ✅ |
| 计数器回退 / 跨度不足 | `verify.mjs` | ✅ |
| 阴影生效 / 关闭时 pill 数量 | `smoke.mjs`（1 枚 / 2 枚） | ✅ |
| **流式中断（用户取消）** | — | ❌ **未测**（需要真人点取消） |
| **连续挂载 / 卸载** | — | ❌ **未测**（只有 smoke 的单次挂载-卸载） |
| **超长会话（数千轮）** | — | ❌ **未测** |
| **两个阴影插件同时抢 `stats`** | — | ❌ **未测**（priority 协商逻辑有，但没实机对撞过） |
| **换模型** | — | ❌ **未测**（全部实测都在 `glm-5.3-flash`） |

---

## 五、一句话总结

**能降级的地方都降级了，降级后不弄坏 dock；安装器会改坏 profile 的那条路已经被 JSON 语义编辑修掉；
编码类的坑踩了四次，现在有断言扫描全仓库。**
仍然没测的集中在「需要真人操作」与「多插件对撞」两类，见第四节最后五行。