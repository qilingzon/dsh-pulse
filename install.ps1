# install.ps1 — dsh-pulse 部署（三处解析位 + profile 注册；幂等，自动备份，逐字节回读）
#
# 用法：
#   powershell -ExecutionPolicy Bypass -File install.ps1 -DshHome "C:\Users\you\.dsh" -Profiles web
#   powershell -ExecutionPolicy Bypass -File install.ps1 -DshHome "<home>" -Profiles web -Remove
#   powershell -ExecutionPolicy Bypass -File install.ps1 -DshHome "<home>" -Profiles web -Plan   # 只打印计划
#
# 只动 <DshHome>；不写生产 C:\Users\you\.dsh，除非显式把 -DshHome 指过去。
param(
  [Parameter(Mandatory=$true)][string]$DshHome,
  [string[]]$Profiles = @('web'),
  [switch]$Remove,
  [switch]$Plan
)
$ErrorActionPreference = 'Stop'
$id  = 'dsh-pulse'
$src = $PSScriptRoot
$utf8 = New-Object System.Text.UTF8Encoding($false)

function Sha([string]$p) { return (Get-FileHash -LiteralPath $p -Algorithm SHA256).Hash }

if (-not (Test-Path $DshHome)) { Write-Output "[FAIL] DshHome 不存在: $DshHome"; exit 1 }
Write-Output "[i] DSH home : $DshHome"
Write-Output "[i] 源       : $src"
Write-Output "[i] 解析位   : <home>\node_modules\$id · <home>\plugins\$id · <home>\profiles\<p>\node_modules\$id"
Write-Output "[i] profile  : $($Profiles -join ', ')"

# ---------- 卸载 ----------
if ($Remove) {
  $targets = @(
    (Join-Path $DshHome "node_modules\$id"),
    (Join-Path $DshHome "plugins\$id")
  )
  foreach ($p in $Profiles) { $targets += (Join-Path $DshHome "profiles\$p\node_modules\$id") }
  foreach ($t in $targets) {
    if (Test-Path $t) { Remove-Item $t -Recurse -Force; Write-Output "[OK] 已移除 $t" }
    else { Write-Output "[i] 不存在（跳过）$t" }
  }
  foreach ($p in $Profiles) {
    $pj = Join-Path $DshHome "profiles\$p\package.json"
    if (-not (Test-Path $pj)) { Write-Output "[WARN] 无 $pj"; continue }
    Copy-Item $pj ($pj + '.bak-' + (Get-Date -Format 'yyyyMMdd-HHmmss')) -Force
    # JSON 语义删除（不是文本替换）：文本替换删不掉「逗号该不该留」，
    # 2026-09-22 实测会产出 `,"dsh-cachehit-2dp",,"dsh-pulse"]` 这种双逗号非法 JSON，
    # 导致 pnpm install 退出码 1。详见 profile-edit.cjs 顶部注释。
    $chk = & node (Join-Path $src 'profile-edit.cjs') remove $pj $id 2>&1
    if ($LASTEXITCODE -ne 0) { Write-Output "[FAIL] $p package.json 摘除失败: $chk"; exit 1 }
    Write-Output "[OK] $p $chk"
  }
  Write-Output "[完成] 重启 profile 生效。"
  exit 0
}

# ---------- 安装 ----------
$targets = @(
  (Join-Path $DshHome "node_modules\$id"),
  (Join-Path $DshHome "plugins\$id")
)
foreach ($p in $Profiles) { $targets += (Join-Path $DshHome "profiles\$p\node_modules\$id") }

if ($Plan) {
  foreach ($t in $targets) { Write-Output "[PLAN] copy $src -> $t" }
  foreach ($p in $Profiles) { Write-Output "[PLAN] patch $(Join-Path $DshHome "profiles\$p\package.json")" }
  Write-Output '[PLAN] 去掉 -Plan 即执行。'
  exit 0
}

$srcFiles = @('index.js', 'client.js', 'cordis.patch.yml', 'package.json')
foreach ($f in $srcFiles) {
  if (-not (Test-Path (Join-Path $src $f))) { Write-Output "[FAIL] 源缺文件: $f"; exit 1 }
}

foreach ($t in $targets) {
  $parent = Split-Path -Parent $t
  if (-not (Test-Path $parent)) { New-Item -ItemType Directory -Force -Path $parent | Out-Null }
  if (Test-Path $t) {
    $bak = $t + '.bak-' + (Get-Date -Format 'yyyyMMdd-HHmmss')
    Copy-Item $t $bak -Recurse -Force
    Write-Output "[i] 旧副本已备份: $bak"
    Remove-Item $t -Recurse -Force
  }
  New-Item -ItemType Directory -Force -Path $t | Out-Null
  foreach ($f in $srcFiles) { Copy-Item (Join-Path $src $f) (Join-Path $t $f) -Force }
  Write-Output "[OK] 已部署 $t"
}

# 逐字节回读（B18/B21：三处解析位必须与 workspace 源一致）
$bad = 0
foreach ($t in $targets) {
  foreach ($f in @('client.js', 'index.js', 'package.json', 'cordis.patch.yml')) {
    $a = Sha (Join-Path $src $f)
    $b = Sha (Join-Path $t $f)
    $flag = 'MATCH'
    if ($a -ne $b) { $flag = 'MISMATCH'; $bad++ }
    Write-Output ("  {0,-8} {1}\{2}" -f $flag, $t, $f)
  }
}
if ($bad -gt 0) { Write-Output "[FAIL] 回读不符 $bad 处 —— 请重跑或回滚 .bak-*"; exit 1 }
Write-Output '[OK] 三处解析位逐字节一致'

# profile 注册（dependencies + dsh.profile.bundles）—— 同样走 JSON 语义编辑
foreach ($p in $Profiles) {
  $pj = Join-Path $DshHome "profiles\$p\package.json"
  if (-not (Test-Path $pj)) { Write-Output "[WARN] 无 $pj —— 跳过注册"; continue }
  $c0 = [System.IO.File]::ReadAllText($pj, [System.Text.Encoding]::UTF8)
  if ($c0.Contains('"' + $id + '"')) { Write-Output "[i] $p 已含 $id（幂等跳过）"; continue }
  Copy-Item $pj ($pj + '.bak-' + (Get-Date -Format 'yyyyMMdd-HHmmss')) -Force
  $bakPj = (Get-ChildItem ($pj + '.bak-*') | Sort-Object Name -Descending | Select-Object -First 1).FullName
  $spec = 'file:../../plugins/' + $id
  $chk = & node (Join-Path $src 'profile-edit.cjs') add $pj $id $spec 2>&1
  if ($LASTEXITCODE -ne 0) {
    Copy-Item $bakPj $pj -Force
    Write-Output "[FAIL] $p package.json 注册失败（已回滚）: $chk"
    exit 1
  }
  # JSON 合法性闸门：写回后必须还能被 JSON.parse 且确实含本插件
  $gate = & node -e "const fs=require('fs');const j=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));const b=(j.dsh&&j.dsh.profile&&j.dsh.profile.bundles)||[];const d=j.dependencies||{};console.log('OK bundles='+b.length+' dep='+(d['$id']||'MISSING'))" $pj 2>&1
  if ($LASTEXITCODE -ne 0) {
    Copy-Item $bakPj $pj -Force
    Write-Output "[FAIL] $p package.json 补丁后 JSON 非法（已回滚）: $gate"
    exit 1
  }
  Write-Output "[OK] $p package.json 已注册（备份保留）: $chk / $gate"
}

Write-Output ''
Write-Output '[完成] 下一步：'
Write-Output ("  1) cd `"$DshHome\profiles\<profile>`" ; pnpm install")
Write-Output  '  2) 重启该 profile（web 实验窗），浏览器刷新后应在输入框下方的统计 pill 旁看到「缓存命中 xx.xx%」'
Write-Output ("  卸载：powershell -ExecutionPolicy Bypass -File `"$src\install.ps1`" -DshHome `"$DshHome`" -Profiles $($Profiles -join ',') -Remove")
