# HARNESS_PLUGIN · dsh-pulse

**一句话**：在 composer dock 加两枚只读读数 —— 「缓存命中」百分比升级为**两位小数**，并新增 **10 秒滑窗平均输出速度（tok/s）** —— 以**客户端插件**形式落地，不改产品二进制。

## What the plugin provides

- `client.js`（客户端半部）—— 往 `conversation.composer.dock` 注册 `id: "pulse"`、`order: 1`，渲染两枚 pill：
  1. `缓存命中 99.87%` —— 只读 `useProjection("tokenUsage")`，与内置那枚同一投影同一口径；`title` 给出精确 token 明细。
  2. `42.7 tok/s` —— 10 秒墙钟滑窗（500ms 采样）。**估计与真值两态分离**：
     流式进行中走 `useChat(s => s.legacy.partial)` 的实时字符增量 × 五类标定，显示 `~42.7 tok/s`（虚线边）；
     步骤结算后走 `useProjection("sessionStats").decodeTokens` 的墙钟斜率，显示 `41.8 tok/s ✓`（实线边）。
     两态由 `data-pulse-src` 探针（`estimate` / `exact` / `idle`）对外判定。结算时用 provider 真值等比回填
     **两条线**的曲线，消除「一次性 usage 上报被当成瞬时吞吐」的假尖峰。
- `index.js`（宿主半部）—— **故意为空**：本插件没有宿主侧贡献（不注入提示词、不注册服务、不落盘）。
- `cordis.patch.yml` —— bundle 行：`insert: [{ id: pulse, name: dsh-pulse }]`。
- `verify.mjs` —— 语法 + formatter 行为断言 + 滑窗算术 + 五类标定 + 持久化 + 注册面静态核对（200 条）。
- `smoke.mjs` —— 组件层冒烟：真装载 `client.js`，假 React 下渲染 `PulseDock`（44 条）。
- `bench.mjs` —— 性能实测：每拍开销 / 字符重数 / 常驻内存 / 发布体积。
- `TEST_COVERAGE.md` —— 测试覆盖矩阵：六层测试的覆盖/边界/未测项（回答「全面吗」以此为准）。
- `install.sh` / `install.ps1` —— Linux 与 Windows 两套等价安装器（三处解析位 + profile 注册 + 备份 + 回读 + JSON 回滚）。

## 不改变什么

- 不改内置那枚统计 pill（做不到，理由见 README《能力边界》）。
- 不改宿主计量、不改投影、不改任何产品包、不改主题。
- 不引用产品 CSS 类名、不操作 `document`、不走 Host RPC。
- 速度读数的估算线**不写回**任何投影或会话状态：它只活在本组件的 ref 里，纯粹用于显示。

## Package facts

| 项 | 值 |
|---|---|
| 包名 / `dsh.id` | `dsh-pulse`（**name == 注册 id**，规避 B23） |
| 版本 | `0.6.0` |
| 平台 | `client.platform: web`，`immediately: true` |
| 依赖 | 仅 `react`（由 `require("react")` 从宿主取） |
| 注入 | `slots`、`locale` |
| 座位 | `conversation.composer.dock` / `pulse` / order `1` / locale `ui-pulse` |
| 读取的 slot props | `t`、`useProjection`、`useChat`（均为该 slot 契约内声明提供的标准工具包） |
| 滑窗参数 | `WINDOW_MS = 10000`、`SAMPLE_MS = 500`、`MIN_SPAN_MS = 1000` |
| 标定参数 | 五类先验 `[0.80, 0.24, 0.30, 0.60, 0.12]` tok/char（汉字 / 字母 / 数字 / 标点 / 空白）；岭先验 = 3 步等效；解夹紧到 `[0.02, 2]`；持久化键 `dsh-pulse:cal:v1` |
| 运行位置 | 采样循环在**浏览器**（客户端插件）；宿主侧 `index.js` 空实现 → VPS 进程零增量 |
| 实测开销 | 0.25 µs/拍（算术）+ 3.19 ns/字符（重数）；2 拍/秒下约 0.0063% 单核；常驻 ≈ 1 KiB；gzip 16.7 KiB |

## Local verification

```powershell
node --check index.js; node --check client.js   # 双绿 = 语法通过
node verify.mjs                                  # 纯函数断言 + VERIFY-OK
node smoke.mjs                                   # 组件层冒烟 + SMOKE-OK
node bench.mjs                                   # 性能实测
npm run harness:test                             # verify + smoke 都跑
```

## Install

见 `README.md`《装 / 卸》——三处解析位 + profile 注册，`install.ps1` 幂等且带 JSON 合法性回滚。
