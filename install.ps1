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
    $q = '"' + $id + '"'
    $c = [System.IO.File]::ReadAllText($pj, [System.Text.Encoding]::UTF8)
    $c2 = $c.Replace($q + ': "file:../../plugins/' + $id + '",', '').Replace(', ' + $q, '').Replace($q, '')
    if ($c2 -ne $c) {
      Copy-Item $pj ($pj + '.bak-' + (Get-Date -Format 'yyyyMMdd-HHmmss')) -Force
      [System.IO.File]::WriteAllText($pj, $c2, $utf8)
      Write-Output "[OK] $p package.json 已摘除（文件级替换；跑一次 pnpm install 收敛 node_modules）"
    } else { Write-Output "[i] $p package.json 未含本插件" }
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

# profile 注册（dependencies + dsh.profile.bundles）
foreach ($p in $Profiles) {
  $pj = Join-Path $DshHome "profiles\$p\package.json"
  if (-not (Test-Path $pj)) { Write-Output "[WARN] 无 $pj —— 跳过注册"; continue }
  $c = [System.IO.File]::ReadAllText($pj, [System.Text.Encoding]::UTF8)
  if ($c.Contains('"' + $id + '"')) { Write-Output "[i] $p 已含 $id（幂等跳过）"; continue }
  Copy-Item $pj ($pj + '.bak-' + (Get-Date -Format 'yyyyMMdd-HHmmss')) -Force
  $bakPj = (Get-ChildItem ($pj + '.bak-*') | Sort-Object Name -Descending | Select-Object -First 1).FullName
  $dep = '"' + $id + '": "file:../../plugins/' + $id + '",'
  $c2 = $c -replace '("dependencies"\s*:\s*\{)', ('$1' + "`r`n    " + $dep)
  $bundle = '"' + $id + '"'
  $c3 = $c2 -replace '(?s)("bundles"\s*:\s*\[)(.*?)(\])', ('$1$2,' + $bundle + '$3')
  [System.IO.File]::WriteAllText($pj, $c3, $utf8)
  # JSON 合法性闸门：不合法立即回滚该 profile 的 package.json
  $chk = & node -e "const fs=require('fs');const j=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));const b=(j.dsh&&j.dsh.profile&&j.dsh.profile.bundles)||[];const d=j.dependencies||{};console.log('OK bundles='+b.length+' dep='+(d['$id']||'MISSING'))" $pj 2>&1
  if ($LASTEXITCODE -ne 0) {
    Copy-Item $bakPj $pj -Force
    Write-Output "[FAIL] $p package.json 补丁后 JSON 非法（已回滚）: $chk"
    exit 1
  }
  Write-Output "[OK] $p package.json 已注册（备份保留）: $chk"
}

Write-Output ''
Write-Output '[完成] 下一步：'
Write-Output ("  1) cd `"$DshHome\profiles\<profile>`" ; pnpm install")
Write-Output  '  2) 重启该 profile（web 实验窗），浏览器刷新后应在输入框下方的统计 pill 旁看到「缓存命中 xx.xx%」'
Write-Output ("  卸载：powershell -ExecutionPolicy Bypass -File `"$src\install.ps1`" -DshHome `"$DshHome`" -Profiles $($Profiles -join ',') -Remove")
