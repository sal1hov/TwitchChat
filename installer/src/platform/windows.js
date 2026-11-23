
const fs = require('fs');
const path = require('path');
const os = require('os');
const { promisify } = require('util');
const { execFile, spawn } = require('child_process');

const exec = promisify(execFile);

function getWindowsDefaultPath() {
  return path.join(
    process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'),
    'TwitchChat'
  );
}

function resolvePayload(payload) {
  const candidates = [
    payload,
    path.join(payload, 'windows'),
    path.join(process.resourcesPath, 'payload', 'windows'),
    path.join(process.resourcesPath, 'payload'),
    path.join(process.resourcesPath, 'app', 'build', 'payload', 'windows')
  ];

  const checked = [];

  for (const candidate of candidates) {
    const resolved = path.resolve(candidate);
    const executable = path.join(resolved, 'TwitchChat.exe');

    checked.push(executable);

    try {
      if (fs.statSync(executable).isFile()) {
        return resolved;
      }
    } catch {}
  }

  throw new Error(
    'Не удалось найти TwitchChat.exe в установочном пакете.\n\n' +
    'Проверенные пути:\n' +
    checked.join('\n')
  );
}

// Записываем PowerShell-файлы в UTF-8 с BOM.
// Это необходимо для корректной работы Windows PowerShell 5.1 с кириллицей.
function writePowerShellFile(filePath, content) {
  fs.writeFileSync(filePath, '\uFEFF' + content, 'utf8');
}

async function webView2Installed() {
  const guid = '{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}';

  const keys = [
    `HKLM\\SOFTWARE\\Microsoft\\EdgeUpdate\\Clients\\${guid}`,
    `HKCU\\Software\\Microsoft\\EdgeUpdate\\Clients\\${guid}`,
    `HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\EdgeUpdate\\Clients\\${guid}`,
    `HKCU\\Software\\WOW6432Node\\Microsoft\\EdgeUpdate\\Clients\\${guid}`
  ];

  for (const key of keys) {
    try {
      const { stdout } = await exec('reg.exe', ['query', key, '/v', 'pv'], {
        windowsHide: true
      });

      const match = stdout.match(/\bpv\s+REG_SZ\s+(\S+)/i);

      if (match && match[1] !== '0.0.0.0') {
        return true;
      }
    } catch {}
  }

  return false;
}

function runInstaller(file, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, {
      windowsHide: true,
      stdio: 'ignore'
    });

    child.once('error', reject);

    child.once('exit', code => {
      resolve(code);
    });
  });
}

function psQuote(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

async function createShortcuts({
  targetPath,
  startMenu,
  desktop,
  uninstallCmd
}) {
  const exe = path.join(targetPath, 'TwitchChat.exe');

  const tempDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'twitchchat-setup-')
  );

  const scriptPath = path.join(tempDir, 'shortcuts.ps1');

  const script = [
    '$ErrorActionPreference = "Stop"',
    '$shell = New-Object -ComObject WScript.Shell',

    `$shortcut = $shell.CreateShortcut(${psQuote(path.join(startMenu, 'TwitchChat.lnk'))})`,
    `$shortcut.TargetPath = ${psQuote(exe)}`,
    `$shortcut.WorkingDirectory = ${psQuote(targetPath)}`,
    '$shortcut.Save()',

    `$desktopShortcut = $shell.CreateShortcut(${psQuote(path.join(desktop, 'TwitchChat.lnk'))})`,
    `$desktopShortcut.TargetPath = ${psQuote(exe)}`,
    `$desktopShortcut.WorkingDirectory = ${psQuote(targetPath)}`,
    '$desktopShortcut.Save()',

    `$uninstallShortcut = $shell.CreateShortcut(${psQuote(path.join(startMenu, 'Удалить TwitchChat.lnk'))})`,
    `$uninstallShortcut.TargetPath = ${psQuote(uninstallCmd)}`,
    '$uninstallShortcut.WorkingDirectory = Split-Path -Parent $uninstallShortcut.TargetPath',
    '$uninstallShortcut.Save()'
  ].join('\r\n');

  writePowerShellFile(scriptPath, script);

  try {
    await exec('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      scriptPath
    ], {
      windowsHide: true,
      timeout: 30000,
      maxBuffer: 1024 * 1024
    });
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

function writeUninstaller(targetPath) {
  const ps1Path = path.join(targetPath, 'Uninstall-TwitchChat.ps1');
  const cmdPath = path.join(targetPath, 'Uninstall-TwitchChat.cmd');

  const script = String.raw`$ErrorActionPreference = 'SilentlyContinue'
$installPath = Split-Path -Parent $MyInvocation.MyCommand.Path

Stop-Process -Name 'TwitchChat' -Force
Start-Sleep -Seconds 1

$startMenu = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\TwitchChat'

Remove-Item (Join-Path $startMenu 'TwitchChat.lnk') -Force
Remove-Item (Join-Path $startMenu 'Удалить TwitchChat.lnk') -Force
Remove-Item $startMenu -Force

Remove-Item (Join-Path $env:USERPROFILE 'Desktop\TwitchChat.lnk') -Force

Remove-Item 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\TwitchChat' -Recurse -Force
Remove-Item 'HKCU:\Software\TwitchChat' -Recurse -Force

$quotedPath = '"' + $installPath + '"'
$command = 'timeout /t 2 /nobreak >nul & rmdir /s /q ' + $quotedPath

Start-Process -FilePath $env:ComSpec -ArgumentList @('/c', $command) -WindowStyle Hidden
`;

  const launcher =
    '@echo off\r\n' +
    'powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File "%~dp0Uninstall-TwitchChat.ps1"\r\n';

  writePowerShellFile(ps1Path, script);
  fs.writeFileSync(cmdPath, launcher, 'utf8');

  return { ps1Path, cmdPath };
}

async function registerWindowsApp({ targetPath, uninstallPs1 }) {
  const version = require('../../package.json').version;

  const key =
    'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\TwitchChat';

  const values = [
    ['DisplayName', 'REG_SZ', 'TwitchChat'],
    ['DisplayVersion', 'REG_SZ', version],
    ['Publisher', 'REG_SZ', 'TwitchChat'],
    ['InstallLocation', 'REG_SZ', targetPath],
    ['DisplayIcon', 'REG_SZ', path.join(targetPath, 'TwitchChat.exe')],
    [
      'UninstallString',
      'REG_SZ',
      `powershell.exe -NoProfile -ExecutionPolicy Bypass -File "${uninstallPs1}"`
    ],
    [
      'QuietUninstallString',
      'REG_SZ',
      `powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "${uninstallPs1}"`
    ]
  ];

  await exec('reg.exe', [
    'add',
    'HKCU\\Software\\TwitchChat',
    '/v',
    'InstallDir',
    '/t',
    'REG_SZ',
    '/d',
    targetPath,
    '/f'
  ], {
    windowsHide: true
  });

  for (const [name, type, value] of values) {
    await exec('reg.exe', [
      'add',
      key,
      '/v',
      name,
      '/t',
      type,
      '/d',
      value,
      '/f'
    ], {
      windowsHide: true
    });
  }

  for (const name of ['NoModify', 'NoRepair']) {
    await exec('reg.exe', [
      'add',
      key,
      '/v',
      name,
      '/t',
      'REG_DWORD',
      '/d',
      '1',
      '/f'
    ], {
      windowsHide: true
    });
  }
}

async function installWindows({ payload, targetPath, send }) {
  targetPath = path.resolve(targetPath);
  payload = resolvePayload(payload);

  const exe = path.join(payload, 'TwitchChat.exe');

  const webview = path.join(
    payload,
    'MicrosoftEdgeWebView2RuntimeInstallerX64.exe'
  );

  if (!fs.existsSync(exe)) {
    throw new Error('Не удалось обнаружить TwitchChat.exe.');
  }

  // Проверяем, не запущено ли приложение.
  try {
    const { stdout } = await exec(
      'tasklist.exe',
      ['/FI', 'IMAGENAME eq TwitchChat.exe'],
      { windowsHide: true }
    );

    if (/TwitchChat\.exe/i.test(stdout)) {
      throw new Error(
        'Сначала полностью закрой TwitchChat, затем повтори установку.'
      );
    }
  } catch (error) {
    if (error.message.includes('Сначала полностью закрой')) {
      throw error;
    }
  }

  send('copy', 5, 'Подготавливаем папку установки…');

  fs.mkdirSync(targetPath, { recursive: true });

  const entries = fs.readdirSync(payload, {
    withFileTypes: true
  }).filter(entry =>
    entry.name !== 'MicrosoftEdgeWebView2RuntimeInstallerX64.exe'
  );

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];

    fs.cpSync(
      path.join(payload, entry.name),
      path.join(targetPath, entry.name),
      {
        recursive: true,
        force: true
      }
    );

    const percent =
      8 + Math.round(
        ((i + 1) / Math.max(entries.length, 1)) * 58
      );

    send('copy', percent, `Копируем ${entry.name}…`);
  }

  const installedExe = path.join(targetPath, 'TwitchChat.exe');

  if (!fs.existsSync(installedExe)) {
    throw new Error(
      'Не удалось скопировать TwitchChat.exe в папку установки:\n' +
      targetPath
    );
  }

  // Проверяем наличие WebView2.
  if (!(await webView2Installed())) {
    if (!fs.existsSync(webview)) {
      throw new Error(
        'Не найден установщик Microsoft Edge WebView2 Runtime.'
      );
    }

    send('webview', 72, 'Устанавливаем Microsoft Edge WebView2…');

    const code = await runInstaller(webview, [
      '/silent',
      '/install'
    ]);

    if (code !== 0 && code !== 3010) {
      throw new Error(
        `Не удалось установить WebView2. Код: ${code}`
      );
    }

    if (!(await webView2Installed())) {
      throw new Error(
        'WebView2 завершил установку, но Runtime не обнаружен. ' +
        'Перезагрузи компьютер и повтори установку.'
      );
    }
  }

  send('shortcuts', 86, 'Создаём ярлыки и регистрацию приложения…');

  const appData =
    process.env.APPDATA ||
    path.join(os.homedir(), 'AppData', 'Roaming');

  const userProfile =
    process.env.USERPROFILE || os.homedir();

  const startMenu = path.join(
    appData,
    'Microsoft',
    'Windows',
    'Start Menu',
    'Programs',
    'TwitchChat'
  );

  const desktop = path.join(userProfile, 'Desktop');

  fs.mkdirSync(startMenu, { recursive: true });
  fs.mkdirSync(desktop, { recursive: true });

  const { ps1Path, cmdPath } = writeUninstaller(targetPath);

  await createShortcuts({
    targetPath,
    startMenu,
    desktop,
    uninstallCmd: cmdPath
  });

  await registerWindowsApp({
    targetPath,
    uninstallPs1: ps1Path
  });

  send('done', 100, 'TwitchChat успешно установлен.');
}

module.exports = {
  installWindows,
  getWindowsDefaultPath
};
