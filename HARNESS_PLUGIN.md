# HARNESS_PLUGIN · dsh-pulse

**一句话**：在 composer dock 加两枚只读读数 —— 「缓存命中」百分比升级为**两位小数**，并新增 **10 秒滑窗平均输出速度（tok/s）** —— 以**客户端插件**形式落地，不改产品二进制。

## What the plugin provides

- `client.js`（客户端半部）—— 往 `conversation.composer.dock` 注册 `id: "pulse"`、`order: 1`，渲染两枚 pill：
  1. `缓存命中 99.87%` —— 只读 `useProjection("tokenUsage")`，与内置那枚同一投影同一口径；`title` 给出精确 token 明细。
  2. `42.7 tok/s` —— 10 秒墙钟滑窗（500ms 采样）。精确线走 `useProjection("sessionStats").decodeTokens` 的斜率；
     流式进行中宿主没有 usage，改走 `useChat(s => s.legacy.partial)` 的实时文本增量 × 自标定 `chars/token`，带 `~` 前缀。
- `index.js`（宿主半部）—— **故意为空**：本插件没有宿主侧贡献（不注入提示词、不注册服务、不落盘）。
- `cordis.patch.yml` —— bundle 行：`insert: [{ id: pulse, name: dsh-pulse }]`。
- `verify.mjs` —— 语法 + formatter 行为断言 + 10 秒滑窗算术 + 注册面静态核对（72 条）。
- `smoke.mjs` —— 组件层冒烟：真装载 `client.js`，假 React 下渲染 `PulseDock`（22 条）。
- `bench.mjs` —— 性能实测：每拍开销 / 常驻内存 / 发布体积。
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
| 版本 | `0.4.0` |
| 平台 | `client.platform: web`，`immediately: true` |
| 依赖 | 仅 `react`（由 `require("react")` 从宿主取） |
| 注入 | `slots`、`locale` |
| 座位 | `conversation.composer.dock` / `pulse` / order `1` / locale `ui-pulse` |
| 读取的 slot props | `t`、`useProjection`、`useChat`（均为该 slot 契约内声明提供的标准工具包） |
| 滑窗参数 | `WINDOW_MS = 10000`、`SAMPLE_MS = 500`、`MIN_SPAN_MS = 1000`、`RATIO ∈ [0.05, 8]`、种子 `0.80 tok/unit`（实机实测） |
| 运行位置 | 采样循环在**浏览器**（客户端插件）；宿主侧 `index.js` 空实现 → VPS 进程零增量 |
| 实测开销 | 0.22 µs/拍 × 2 拍/秒 = 0.000043% 单核；常驻 ≈ 1 KiB；gzip 9.1 KiB |

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
