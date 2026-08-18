# 本机打包脚本：输出到系统 TEMP 目录，绕过 D:\Documents 被同步盘/安全软件
# 持有句柄导致的 EBUSY/EPERM（electron-builder 在项目目录下解压后
# unlink/rename asar 文件会被锁死）。打包成功后自动把安装包复制回项目 dist\。
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$outDir = Join-Path $env:TEMP 'ai-pet-dist'
if (Test-Path $outDir) { Remove-Item $outDir -Recurse -Force }
Set-Location $root
node node_modules\electron-builder\cli.js --win --config.directories.output=$outDir
if ($LASTEXITCODE -ne 0) { Write-Host "打包失败 (exit $LASTEXITCODE)"; exit 1 }
$setup = Get-ChildItem $outDir -Filter '*Setup*.exe' | Sort-Object LastWriteTime -Descending | Select-Object -First 1
Copy-Item $setup.FullName (Join-Path $root "dist\$($setup.Name)") -Force
Write-Host "完成：dist\$($setup.Name)"
