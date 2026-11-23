
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$Root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path

$Package = Get-Content (Join-Path $Root 'package.json') -Raw | ConvertFrom-Json
$Version = [string]$Package.version

$Dist = Join-Path $Root 'dist'
$Publish = Join-Path $Dist 'win-publish'
$NodeStage = Join-Path $Dist 'node-stage'
$RuntimeDir = Join-Path $Publish 'runtime'

$Installer = Join-Path $Dist "TwitchChat-$Version-x64-setup.exe"

$NodeVersion = '24.22.3'

$NodeZip = Join-Path $Dist "node-v$NodeVersion-win-x64.zip"
$NodeExtract = Join-Path $Dist "node-v$NodeVersion-win-x64"

# Постоянный кеш WebView2 — не зависит от папки dist.
$BuildCache = Join-Path $env:LOCALAPPDATA 'TwitchChatBuildCache'
$WebViewStandalone = Join-Path $BuildCache 'MicrosoftEdgeWebView2RuntimeInstallerX64.exe'
$WebViewDownloadTemp = Join-Path $BuildCache 'MicrosoftEdgeWebView2RuntimeInstallerX64.download'

# Копия для NSIS.
$WebViewPublish = Join-Path $Publish 'MicrosoftEdgeWebView2RuntimeInstallerX64.exe'

$WebViewStandaloneUrl = 'https://go.microsoft.com/fwlink/?linkid=2124701'


function Require-Command([string]$Name) {
    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "Required command not found: $Name"
    }
}


function Test-WebViewInstaller([string]$Path) {
    if (-not (Test-Path $Path -PathType Leaf)) {
        return $false
    }

    $File = Get-Item $Path

    if ($File.Length -lt 10MB) {
        return $false
    }

    # Проверяем сигнатуру исполняемого файла Windows (MZ).
    $Stream = [System.IO.File]::OpenRead($Path)

    try {
        $FirstByte = $Stream.ReadByte()
        $SecondByte = $Stream.ReadByte()

        return ($FirstByte -eq 0x4D -and $SecondByte -eq 0x5A)
    }
    finally {
        $Stream.Dispose()
    }
}


Require-Command 'dotnet'
Require-Command 'npm'
Require-Command 'makensis'


$Sdks = & dotnet --list-sdks 2>$null

if (-not $Sdks -or -not ($Sdks | Where-Object {
    $_ -match '^8\.' -or
    $_ -match '^9\.' -or
    $_ -match '^10\.'
})) {
    throw 'Install .NET SDK 8 or newer.'
}


New-Item -ItemType Directory -Force -Path $Dist | Out-Null
New-Item -ItemType Directory -Force -Path $BuildCache | Out-Null


# Очистка предыдущей публикации.

if (Test-Path $Publish) {
    Remove-Item $Publish -Recurse -Force
}

if (Test-Path $NodeStage) {
    Remove-Item $NodeStage -Recurse -Force
}


# --------------------------------------------------
# 1. Публикация Avalonia.
# --------------------------------------------------

Write-Host "[1/5] Publishing Avalonia ($Version)..." -ForegroundColor Cyan

& dotnet publish (Join-Path $Root 'windows/TwitchChat.csproj') `
    -c Release `
    -r win-x64 `
    --self-contained true `
    "-p:Version=$Version" `
    -o $Publish

if ($LASTEXITCODE -ne 0) {
    throw 'dotnet publish failed.'
}


# --------------------------------------------------
# 2. Подготовка Node.js.
# --------------------------------------------------

Write-Host "[2/5] Preparing Node.js $NodeVersion..." -ForegroundColor Cyan

if (-not (Test-Path (Join-Path $NodeExtract 'node.exe'))) {

    if (-not (Test-Path $NodeZip)) {

        Write-Host 'Downloading Node.js...' -ForegroundColor Yellow

        Invoke-WebRequest -UseBasicParsing `
            -Uri "https://nodejs.org/dist/v$NodeVersion/node-v$NodeVersion-win-x64.zip" `
            -OutFile $NodeZip
    }

    if (Test-Path $NodeExtract) {
        Remove-Item $NodeExtract -Recurse -Force
    }

    Expand-Archive -Path $NodeZip -DestinationPath $Dist -Force
}


New-Item -ItemType Directory -Force -Path $RuntimeDir | Out-Null

Copy-Item `
    (Join-Path $NodeExtract 'node.exe') `
    $RuntimeDir `
    -Force

$NodeLicense = Join-Path $NodeExtract 'LICENSE'

if (Test-Path $NodeLicense) {
    Copy-Item `
        $NodeLicense `
        (Join-Path $RuntimeDir 'LICENSE') `
        -Force
}


# --------------------------------------------------
# 3. Установка production-зависимостей Node.js.
# --------------------------------------------------

Write-Host '[3/5] Installing production Node.js dependencies...' -ForegroundColor Cyan

New-Item -ItemType Directory -Force -Path $NodeStage | Out-Null

Copy-Item (Join-Path $Root 'package.json') $NodeStage -Force
Copy-Item (Join-Path $Root 'package-lock.json') $NodeStage -Force


Push-Location $NodeStage

try {
    & npm ci --omit=dev --no-audit --no-fund

    if ($LASTEXITCODE -ne 0) {
        throw 'npm ci failed.'
    }
}
finally {
    Pop-Location
}


Copy-Item `
    (Join-Path $NodeStage 'node_modules') `
    $Publish `
    -Recurse `
    -Force


# --------------------------------------------------
# 4. Подготовка WebView2 Standalone Installer.
# --------------------------------------------------

Write-Host '[4/5] Preparing WebView2 Standalone Installer x64...' -ForegroundColor Cyan

$DownloadRequired = $true

if (Test-WebViewInstaller $WebViewStandalone) {

    $DownloadRequired = $false

    Write-Host 'Using permanent WebView2 cache. No download required.' -ForegroundColor Green
}
else {

    Write-Host 'WebView2 cache is missing or invalid.' -ForegroundColor Yellow

    if (Test-Path $WebViewStandalone) {
        Remove-Item $WebViewStandalone -Force
    }
}


if ($DownloadRequired) {

    if (Test-Path $WebViewDownloadTemp) {
        Remove-Item $WebViewDownloadTemp -Force
    }

    Write-Host 'Downloading WebView2 Evergreen Standalone Installer...' -ForegroundColor Yellow

    Invoke-WebRequest -UseBasicParsing `
        -Uri $WebViewStandaloneUrl `
        -OutFile $WebViewDownloadTemp

    if (-not (Test-WebViewInstaller $WebViewDownloadTemp)) {

        if (Test-Path $WebViewDownloadTemp) {
            Remove-Item $WebViewDownloadTemp -Force
        }

        throw 'Downloaded WebView2 installer is invalid or unexpectedly small.'
    }

    # Сохраняем скачанный файл в постоянный кеш.
    Move-Item `
        $WebViewDownloadTemp `
        $WebViewStandalone `
        -Force

    Write-Host 'WebView2 installer saved to permanent cache.' -ForegroundColor Green
}


# Копируем кешированный установщик в публикацию для NSIS.
Copy-Item `
    $WebViewStandalone `
    $WebViewPublish `
    -Force


# --------------------------------------------------
# 5. Создание NSIS-установщика.
# --------------------------------------------------

Write-Host '[5/5] Creating NSIS installer...' -ForegroundColor Cyan

& makensis `
    "/DVERSION=$Version" `
    "/DPUBLISHDIR=$Publish" `
    "/DOUTFILE=$Installer" `
    (Join-Path $Root 'windows/twitchchat.nsi')


if ($LASTEXITCODE -ne 0) {
    throw 'NSIS installer creation failed.'
}


if (-not (Test-Path $Installer)) {
    throw 'Installer was not created.'
}


$InstallerInfo = Get-Item $Installer
$CacheInfo = Get-Item $WebViewStandalone

Write-Host ''
Write-Host '========================================' -ForegroundColor Green
Write-Host '       BUILD COMPLETED SUCCESSFULLY' -ForegroundColor Green
Write-Host '========================================' -ForegroundColor Green
Write-Host "Version: $Version"
Write-Host "Installer: $($InstallerInfo.FullName)"
Write-Host "Installer size: $([math]::Round($InstallerInfo.Length / 1MB, 2)) MB"
Write-Host "WebView2 cache: $($CacheInfo.FullName)"
Write-Host "WebView2 size: $([math]::Round($CacheInfo.Length / 1MB, 2)) MB"
Write-Host ''
