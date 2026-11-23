param(
    [switch]$SkipInstallerDependencies
)

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
$InstallerDir = Join-Path $Root 'installer'
$InstallerOutput = Join-Path $Dist 'installer'
$Installer = Join-Path $InstallerOutput "TwitchChat-Setup-$Version-win-x64.exe"

$NodeVersion = '24.22.3'
$NodeZip = Join-Path $Dist "node-v$NodeVersion-win-x64.zip"
$NodeExtract = Join-Path $Dist "node-v$NodeVersion-win-x64"

$BuildCache = Join-Path $env:LOCALAPPDATA 'TwitchChatBuildCache'
$WebViewStandalone = Join-Path $BuildCache 'MicrosoftEdgeWebView2RuntimeInstallerX64.exe'
$WebViewDownloadTemp = Join-Path $BuildCache 'MicrosoftEdgeWebView2RuntimeInstallerX64.download'
$WebViewPublish = Join-Path $Publish 'MicrosoftEdgeWebView2RuntimeInstallerX64.exe'
$WebViewStandaloneUrl = 'https://go.microsoft.com/fwlink/?linkid=2124701'

function Require-Command([string]$Name) {
    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "Required command not found: $Name"
    }
}

function Test-WebViewInstaller([string]$Path) {
    if (-not (Test-Path $Path -PathType Leaf)) { return $false }
    $File = Get-Item $Path
    if ($File.Length -lt 10MB) { return $false }

    $Stream = [System.IO.File]::OpenRead($Path)
    try {
        return ($Stream.ReadByte() -eq 0x4D -and $Stream.ReadByte() -eq 0x5A)
    }
    finally {
        $Stream.Dispose()
    }
}

Require-Command 'dotnet'
Require-Command 'npm'
Require-Command 'node'

$Sdks = & dotnet --list-sdks 2>$null
if (-not $Sdks -or -not ($Sdks | Where-Object {
    $_ -match '^8\.' -or $_ -match '^9\.' -or $_ -match '^10\.'
})) {
    throw 'Install .NET SDK 8 or newer.'
}

if (-not (Test-Path (Join-Path $InstallerDir 'package.json'))) {
    throw 'Папка installer отсутствует или в ней нет package.json.'
}

New-Item -ItemType Directory -Force -Path $Dist | Out-Null
New-Item -ItemType Directory -Force -Path $BuildCache | Out-Null

if (Test-Path $Publish) { Remove-Item $Publish -Recurse -Force }
if (Test-Path $NodeStage) { Remove-Item $NodeStage -Recurse -Force }

# 1. Публикация приложения.
Write-Host "[1/5] Publishing Avalonia ($Version)..." -ForegroundColor Cyan
& dotnet publish (Join-Path $Root 'windows/TwitchChat.csproj') `
    -c Release -r win-x64 --self-contained true `
    "-p:Version=$Version" -o $Publish
if ($LASTEXITCODE -ne 0) { throw 'dotnet publish failed.' }

# 2. Подготовка Node.js.
Write-Host "[2/5] Preparing Node.js $NodeVersion..." -ForegroundColor Cyan
if (-not (Test-Path (Join-Path $NodeExtract 'node.exe'))) {
    if (-not (Test-Path $NodeZip)) {
        Write-Host 'Downloading Node.js...' -ForegroundColor Yellow
        $NodeUrl = "https://nodejs.org/dist/v$NodeVersion/node-v$NodeVersion-win-x64.zip"
        try {
            Invoke-WebRequest -UseBasicParsing -Uri $NodeUrl -OutFile $NodeZip
        }
        catch {
            throw "Не удалось скачать Node.js. Скачай архив вручную: $NodeUrl и сохрани его как $NodeZip. Ошибка: $($_.Exception.Message)"
        }
    }

    if (Test-Path $NodeExtract) { Remove-Item $NodeExtract -Recurse -Force }
    Expand-Archive -Path $NodeZip -DestinationPath $Dist -Force
}

New-Item -ItemType Directory -Force -Path $RuntimeDir | Out-Null
Copy-Item (Join-Path $NodeExtract 'node.exe') $RuntimeDir -Force
$NodeLicense = Join-Path $NodeExtract 'LICENSE'
if (Test-Path $NodeLicense) {
    Copy-Item $NodeLicense (Join-Path $RuntimeDir 'LICENSE') -Force
}

# 3. Production-зависимости приложения.
Write-Host '[3/5] Installing production Node.js dependencies...' -ForegroundColor Cyan
New-Item -ItemType Directory -Force -Path $NodeStage | Out-Null
Copy-Item (Join-Path $Root 'package.json') $NodeStage -Force
Copy-Item (Join-Path $Root 'package-lock.json') $NodeStage -Force

Push-Location $NodeStage
try {
    & npm ci --omit=dev --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { throw 'npm ci failed.' }
}
finally {
    Pop-Location
}

Copy-Item (Join-Path $NodeStage 'node_modules') $Publish -Recurse -Force

# 4. WebView2 Standalone для компьютеров без Runtime.
Write-Host '[4/5] Preparing WebView2 Standalone Installer x64...' -ForegroundColor Cyan
$DownloadRequired = -not (Test-WebViewInstaller $WebViewStandalone)

if ($DownloadRequired) {
    if (Test-Path $WebViewStandalone) { Remove-Item $WebViewStandalone -Force }
    if (Test-Path $WebViewDownloadTemp) { Remove-Item $WebViewDownloadTemp -Force }

    Write-Host 'Downloading WebView2 Evergreen Standalone Installer...' -ForegroundColor Yellow
    try {
        Invoke-WebRequest -UseBasicParsing -Uri $WebViewStandaloneUrl -OutFile $WebViewDownloadTemp
    }
    catch {
        throw "Не удалось скачать WebView2. Проверь доступ к Microsoft или скачай standalone installer вручную. Ошибка: $($_.Exception.Message)"
    }

    if (-not (Test-WebViewInstaller $WebViewDownloadTemp)) {
        Remove-Item $WebViewDownloadTemp -Force -ErrorAction SilentlyContinue
        throw 'Downloaded WebView2 installer is invalid or unexpectedly small.'
    }

    Move-Item $WebViewDownloadTemp $WebViewStandalone -Force
}
else {
    Write-Host 'Using permanent WebView2 cache. No download required.' -ForegroundColor Green
}

Copy-Item $WebViewStandalone $WebViewPublish -Force

# 5. Сборка фирменного Electron Setup.
Write-Host '[5/5] Building custom TwitchChat Setup...' -ForegroundColor Cyan

$BuilderCmd = Join-Path $InstallerDir 'node_modules/.bin/electron-builder.cmd'
if (-not (Test-Path $BuilderCmd)) {
    if ($SkipInstallerDependencies) {
        throw 'Зависимости installer не установлены. Выполни: cd installer; npm install'
    }

    Write-Host 'Installing installer dependencies...' -ForegroundColor Yellow
    & npm install --prefix $InstallerDir --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { throw 'Не удалось установить зависимости папки installer.' }
}

Push-Location $InstallerDir
try {
    & node (Join-Path $InstallerDir 'build.js')
    if ($LASTEXITCODE -ne 0) { throw 'Custom installer build failed.' }
}
finally {
    Pop-Location
}

if (-not (Test-Path $Installer)) {
    $Candidates = Get-ChildItem $InstallerOutput -Filter '*.exe' -File -ErrorAction SilentlyContinue
    if ($Candidates.Count -eq 1) { $Installer = $Candidates[0].FullName }
    else { throw "Фирменный установщик не найден в $InstallerOutput" }
}

$InstallerInfo = Get-Item $Installer
Write-Host ''
Write-Host '========================================' -ForegroundColor Green
Write-Host '  CUSTOM SETUP BUILD COMPLETED' -ForegroundColor Green
Write-Host '========================================' -ForegroundColor Green
Write-Host "Version: $Version"
Write-Host "Installer: $($InstallerInfo.FullName)"
Write-Host "Installer size: $([math]::Round($InstallerInfo.Length / 1MB, 2)) MB"
Write-Host "WebView2 cache: $WebViewStandalone"
Write-Host ''
