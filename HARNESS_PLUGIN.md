# HARNESS_PLUGIN · dsh-pulse

**一句话**：把「缓存命中」的百分比从整数读数升级为**两位小数**读数 —— 以**客户端插件**形式落地，不改产品二进制。

## What the plugin provides

- `client.js`（客户端半部）—— 往 `conversation.composer.dock` 注册 `id: "pulse"`、`order: 1`，
  只读 `useProjection("tokenUsage")`，渲染 `缓存命中 99.87%`；`title` 给出精确 token 明细。
- `index.js`（宿主半部）—— **故意为空**：本插件没有宿主侧贡献（不注入提示词、不注册服务、不落盘）。
- `cordis.patch.yml` —— bundle 行：`insert: [{ id: pulse, name: dsh-pulse }]`。
- `verify.mjs` —— 语法 + formatter 行为断言 + 注册面静态核对。

## 不改变什么

- 不改内置那枚统计 pill（做不到，理由见 README《能力边界》）。
- 不改宿主计量、不改投影、不改任何产品包、不改主题。
- 不引用产品 CSS 类名、不操作 `document`、不走 Host RPC。

## Package facts

| 项 | 值 |
|---|---|
| 包名 / `dsh.id` | `dsh-pulse`（**name == 注册 id**，规避 B23） |
| 版本 | `0.1.0` |
| 平台 | `client.platform: web`，`immediately: true` |
| 依赖 | 仅 `react`（由 `require("react")` 从宿主取） |
| 注入 | `slots`、`locale` |
| 座位 | `conversation.composer.dock` / `pulse` / order `1` / locale `ui-pulse` |

## Local verification

```powershell
node --check index.js; node --check client.js   # 双绿 = 语法通过
node verify.mjs                                  # 全断言 + VERIFY-OK
```

## Install

见 `README.md`《装 / 卸》——三处解析位 + profile 注册，`install.ps1` 幂等且带 JSON 合法性回滚。
