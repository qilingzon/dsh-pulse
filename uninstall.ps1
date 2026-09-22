# uninstall.ps1 — dsh-pulse 卸载（等价于 install.ps1 -Remove）
# 用法：
#   powershell -ExecutionPolicy Bypass -File uninstall.ps1 -DshHome "C:\Users\you\.dsh" -Profiles web
param(
  [Parameter(Mandatory=$true)][string]$DshHome,
  [string[]]$Profiles = @('web')
)
$ErrorActionPreference = 'Stop'
$install = Join-Path $PSScriptRoot 'install.ps1'
if (-not (Test-Path $install)) { Write-Output "[FAIL] 找不到 install.ps1（应与本文件同目录）"; exit 1 }
& $install -DshHome $DshHome -Profiles $Profiles -Remove
exit $LASTEXITCODE
