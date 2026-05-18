$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ConfigFile = Join-Path $ScriptDir "config.json"
$ConfigExample = Join-Path $ScriptDir "config.example.json"
$SubscriptionsFile = Join-Path $ScriptDir "data\subscriptions.json"
$StateFile = Join-Path $ScriptDir "data\state.json"
$DataDir = Join-Path $ScriptDir "data"

Write-Host ""
Write-Host "========================================="
Write-Host "  NexusPHP 聚合查询助手 - 初始化重置"
Write-Host "========================================="
Write-Host ""
Write-Host "将要清除以下内容："
Write-Host "  - $ConfigFile"
Write-Host "  - $SubscriptionsFile"
Write-Host "  - $StateFile"
Write-Host ""
Write-Host "清除后将从 config.example.json 重建默认配置。"
Write-Host ""

$confirm = Read-Host "确认清除所有数据和配置？(y/N)"
if ($confirm -notin @("y", "Y", "yes", "YES", "Yes")) {
    Write-Host "已取消。"
    exit 0
}

if (!(Test-Path $DataDir)) {
    New-Item -ItemType Directory -Path $DataDir -Force | Out-Null
}

Write-Host "重置 config.json ..."
if (Test-Path $ConfigExample) {
    Copy-Item -Path $ConfigExample -Destination $ConfigFile -Force
    Write-Host "  已从 config.example.json 重建。"
} else {
    $defaultConfig = @{
        port = 3010
        timeoutMs = 60000
        checkIntervalMs = 600000
        searchMaxPages = 5
        downloadEnabled = $true
        sites = @()
    } | ConvertTo-Json
    Set-Content -Path $ConfigFile -Value $defaultConfig -Encoding UTF8
    Write-Host "  config.example.json 不存在，已创建最小配置。"
}

Write-Host "清空订阅数据 ..."
Set-Content -Path $SubscriptionsFile -Value "[]" -Encoding UTF8

Write-Host "清空运行日志和状态 ..."
Set-Content -Path $StateFile -Value '{"logs":[]}' -Encoding UTF8

Write-Host ""
Write-Host "========================================="
Write-Host "  初始化完成"
Write-Host "========================================="
Write-Host ""
Write-Host "已清除："
Write-Host "  [OK] config.json 已重置为默认值"
Write-Host "  [OK] data\subscriptions.json 已清空"
Write-Host "  [OK] data\state.json 已清空"
Write-Host ""
Write-Host "请编辑 config.json 填写站点 Cookie 和 Transmission 等配置。"
Write-Host "配置文件：$ConfigFile"
