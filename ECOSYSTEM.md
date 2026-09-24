# dsh-pulse 同类项目盘点（社区生态）

> 检索时间：2026-09-22
> 检索范围：<https://dsharness.io/zh> 社区插件目录（收录 13,160 个经 GitHub 数据核验的 dsh 插件）
> 检索关键词：`token`(571) · `缓存命中`(20) · `实时速度`(0) · 分类「界面增强」(1,786)

## ⚠️ 证据等级声明（先说边界）

本文件的对比**只基于插件目录里的一行描述**，**没有读过任何一个同类项目的源码**：

| 想做的事 | 结果 |
|---|---|
| 抓 `github.com/<repo>` 页面 | ❌ 被拦：`URL hostname "github.com" resolves to a non-public IP address` |
| 抓 `raw.githubusercontent.com` | ❌ 同样被拦 |
| 抓 `api.github.com` 搜索接口 | ❌ 同样被拦 |
| 抓 dsharness.io 目录页 | ✅ 可用（本文件全部信息的来源） |

所以下面对「别人怎么实现的」的推断，**属于本仓库《七、数据真实性分级》里的第三档**。
任何「我们比他们强」的说法在没有读过对方代码之前都不成立。**本文件不下这种结论。**

---

## 一、直接撞车：同一个需求已经有人做了

| 项目 | Star | 目录描述 | 与 dsh-pulse 的重叠 |
|---|---|---|---|
| **`DSH-Cache-Hit-Precision`** <br>luern0313 | ★1 | 「dsh状态栏显示**两位小数缓存命中率**」 | **完全撞车** —— 这正是 dsh-pulse 的第一枚 pill（用户最初的诉求） |
| **`dsh-turn-fold`** <br>Winter-And-You-Gone | ★3 | 「回合结束后整回合收成一个大组头，显示耗时/token/**tok/s**/**缓存命中率**指标」 | **两枚 pill 都撞** —— 缓存命中 + tok/s |
| **`dsh-better-status`** <br>Yaing-Yan | ★1 | 「把文本形式的会话统计（轮/步、LLM/工具耗时、首 token、**tok/s**、缓存命中、输入/输出 token）替换为图表面板」 | **两枚 pill 都撞**，且覆盖更广 |
| **`dsh-cost-balance`** <br>zoumutou | ★3 | 「**输入框下方** iOS 风格统计条 —— 会话花费、账户余额、**缓存命中**、Token 用量」 | 撞车，且**同一位置**（composer dock 区域） |
| **`dsh-plugin-duwg`** <br>Yolotd | ★1 | 「**输入框下方**显示当天 Token 用量与**缓存命中率**」 | 撞车 + 同位置 |

**结论一：dsh-pulse 的两枚读数，在社区里都不是新东西。** 「两位小数缓存命中」这一个具体诉求至少有 1 个完全同名同义的实现。

## 二、相邻项目：缓存命中 / token 用量 / 速度（数量很多）

| 项目 | Star | 描述要点 |
|---|---|---|
| `dsh-web-all`（zhu1090093659） | ★7.7k | Web UI 合集：任务板、Git 图、右侧栏、宠物、**live token stats**、皮肤中心 |
| `dsh-cc-tui`（ccch1mneyyy） | ★3.1k | Claude Code 风格 TUI：状态栏、上下文进度条、**TPS 仪表盘** |
| `dsh-usage-plugin`（feiyang-dev） | ★37 | 每次调用 token 用量 / **缓存命中**统计、峰谷计费、余额、CSV/JSON/PNG 导出 |
| `dsh-usage-stats`（Make0209） | ★27 | 热力图 + Token / **缓存命中** / 余额看板 |
| `DshCockpit`（Lxiayu） | ★23 | 托盘常驻、Token 用量与成本统计、预算报警 |
| `context-vista`（GooodWei） | ★12 | 右侧悬浮栏 + `/context`，环形图实时展示上下文 token 用量 |
| `dsh-ui-progress`（lhh010） | ★8 | 会话进度条：todos 进度 / **实时 token 速率** |
| `dsh-gauge`（noone89A） | ★4 | 「**精确**缓存命中率、token 用量与费用估算」 |
| `dsh-client-usage`（jLeon-account） | ★4 | **实时**展示会话级 token 用量，缓存命中/未命中**分桶** |
| `dsh-metrics-panel`（bulai-z） | ★0 | 浮动面板，**实时**统计每次 API 调用用量、缓存命中、费用、延迟 |
| `dsh-cache-cost-monitor`（eurt-nano） | ★1 | 前缀缓存命中率监控、token 消耗与成本估算 |
| `dsh-plugin-usage`（GHJIVHIDD） | ★2 | 会话视图环新增「用量」页签，**实时**跟踪输入/输出/缓存命中 |
| `lingmu-dsh-plugin`（BigGayJiuMo） | ★0 | 悬浮窗**实时**显示 Token 用量、余额、缓存命中与费用 |
| `dsh-token-usage`（vector-sunlight） | ★0 | 缓存命中率进度条、峰谷计价、费用精确到两位小数 |
| `dsh-cost-widget`（zhangshaobo608） | ★1 | 悬浮面板：每百万 token 平均费用与缓存命中率 |
| `dsh-conversation-cost`（Ayaka157） | ★2 | 对话底部统计行**实时**显示用量费用（含缓存命中） |
| `dsh-Agent 工作流`（xuanyuanzhifeng） | ★82 | 按用户轮次展示请求/响应/工具调用/耗时与 Token 缓存统计 |

> 注：`dsh-usage-stats` 有 3 个同名不同作者的仓库（Ychris12138 / Make0209 / lanlandeli），
> 说明这个位置**已经卷到重名**。

## 三、dsh-pulse 真正不同的地方（需要证据才能算数）

下面每条都标了「证据在哪」，**没有证据的一律标为待验证**：

| 差异点 | 现状 | 证据等级 |
|---|---|---|
| **估计 / 真值三态分离 + `data-pulse-src` 探针** | 目录描述里没有任何一个同类项目提到这件事 | 第三档（只说明「没人宣传」，不等于「没人做」） |
| **10 秒滑窗**速率（而非每回合平均） | 同类多写「实时」，但没说窗口口径 | 第三档 |
| **五类字符在线标定 + localStorage 跨会话持久化** | 未在目录描述中出现 | 第三档 |
| **结算阶跃假尖峰的修复**（exact 线也要等比回填） | 未在目录描述中出现；这类 bug 一般不会被写进 README | 第三档 |
| **可复现的实机测量 + 三档数据真实性分级** | 未在目录描述中出现 | 第三档（本仓库的 `README《七》` + `.diag` 复现脚本是第一档，但那是「我们做了」，不是「别人没做」） |
| **性能实测**（0.24 µs/拍、0.0063% 单核、16.7 KiB） | 同类未公开数字 | 第三档 |

## 四、可以借鉴的（如果有机会读到源码）

1. **`dsh-web-all`（★7.7k）** —— 生态里最大的 Web UI 合集，值得看它怎么组织多插件与皮肤中心。
2. **`dsh-usage-plugin`（★37）** —— 有导出（CSV/JSON/PNG）与峰谷计费；dsh-pulse 完全没有导出能力。
3. **`dsh-better-status`（★1）** —— 把统计做成右侧图表面板；dsh-pulse 只有两枚 pill。
4. **`dsh-turn-fold`（★3）** —— 把指标折叠进回合组头；这是「不占常驻位置」的另一种产品形态。
5. **`dsh-metrics-panel`（★0）** —— 面板 + 曲线 + 请求明细；信息密度远高于 dsh-pulse。

## 五、这次盘点对 dsh-pulse 的直接影响

1. **「两位小数缓存命中」这个卖点已经没了** —— 至少 `DSH-Cache-Hit-Precision` 就是同一件事。README 的定位不能再靠它。
2. **「缓存命中 + tok/s」组合也不稀缺** —— `dsh-turn-fold` / `dsh-better-status` 都覆盖。
3. **真正的差异只在「口径诚实」这一层** —— 估计与真值分不分开、结算尖峰修没修、误差有没有实测。
   这一层是**可以验证的工程事实**，也是唯一值得继续投入的方向。
4. **本次盘点没改变 v0.6.0「成熟稳定」的方向**，反而加强了它：在一个已经很挤的位置上，
   唯一站得住的护城河是「别人声称实时，我们证明实时到哪一步」——而这需要安装闭环、换模型、
   异常路径全都测过才敢说。
5. **待办**：把本文件的结论按证据等级同步进 `README`（新增一节「同类项目」），并明确写出
   「未读源码，故不作优劣断言」。