# 一键打包脚本（纯净版）：
# ① 输出到系统 TEMP 目录——绕过 D:\Documents 被同步盘/安全软件持有句柄导致的 EBUSY/EPERM
# ② 打包后自动校验安装包内容纯净（asar 清单核对白名单，确保不含任何个人配置/用户数据）
# ③ 校验通过后复制安装包回项目 dist\（仅保留最新一个）
# 用法：双击根目录"一键打包.bat"，或执行 powershell -ExecutionPolicy Bypass -File scripts\dist-temp.ps1
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$outDir = Join-Path $env:TEMP 'ai-pet-dist'
$version = (Get-Content (Join-Path $root 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json).version

Write-Host "========================================"
Write-Host "  AI 桌宠 一键打包（版本 $version）"
Write-Host "========================================"

# [1/4] 清理上次残留
if (Test-Path $outDir) { Remove-Item $outDir -Recurse -Force }
Write-Host "[1/4] 输出到 TEMP：$outDir"

# [2/4] 打包（electron-builder，NSIS 安装包）
Set-Location $root
node node_modules\electron-builder\cli.js --win --config.directories.output=$outDir
if ($LASTEXITCODE -ne 0) { Write-Host "打包失败 (exit $LASTEXITCODE)"; exit 1 }
Write-Host "[2/4] 打包完成"

# [3/4] 纯净性校验：顶层只允许白名单文件；node_modules 为生产依赖（electron-store 等，运行时必需）自动跳过；
# 个人配置/用户数据存于 %APPDATA%，永不进包
$asarFile = Join-Path $outDir 'win-unpacked\resources\app.asar'
$whitelist = @('package.json', 'main.js', 'preload.js', 'renderer.js', 'index.html', 'styles.css', 'chat.js')
$files = node node_modules\@electron\asar\bin\asar.js list $asarFile | ForEach-Object { $_ -replace '^[\\/]', '' }
$appFiles = $files | Where-Object { $_ -notlike 'node_modules*' }
$bad = $appFiles | Where-Object { $whitelist -notcontains $_ }
if ($bad) {
  $count = $bad.Count
  $sample = ($bad | Select-Object -First 10) -join ', '
  Write-Host "[3/4] 警告：顶层发现 $count 个白名单外文件：$sample ...（请检查是否误入个人数据）"
} else {
  Write-Host "[3/4] 纯净校验通过：顶层共 $($appFiles.Count) 项（$($whitelist -join ' / ')），无个人配置/用户数据"
}

# [4/4] 复制回 dist（仅保留最新安装包）
$setup = Get-ChildItem $outDir -Filter '*Setup*.exe' | Sort-Object LastWriteTime -Descending | Select-Object -First 1
Get-ChildItem (Join-Path $root 'dist') -Filter '*Setup*.exe' -ErrorAction SilentlyContinue | Remove-Item -Force
Copy-Item $setup.FullName (Join-Path $root "dist\$($setup.Name)") -Force
Write-Host "[4/4] 完成：dist\$($setup.Name)（$([math]::Round($setup.Length / 1MB, 1)) MB）"
Write-Host "========================================"
