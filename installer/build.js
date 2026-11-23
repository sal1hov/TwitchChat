const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const here = __dirname;
const appPackage = require(path.join(root, 'package.json'));
const setupPackage = require(path.join(here, 'package.json'));
const platform = process.platform;
const isWindows = platform === 'win32';
const isMac = platform === 'darwin';
const payloadRoot = path.join(here, 'build', 'payload');
const payload = path.join(payloadRoot, isWindows ? 'windows' : 'macos');

const remove = target => fs.rmSync(target, { recursive: true, force: true });
const copy = (from, to) => fs.cpSync(from, to, { recursive: true, force: true });

if (!isWindows && !isMac) {
  throw new Error('Поддерживаются только Windows и macOS.');
}

remove(payloadRoot);
fs.mkdirSync(payload, { recursive: true });

if (isWindows) {
  const publish = path.join(root, 'dist', 'win-publish');
  if (!fs.existsSync(path.join(publish, 'TwitchChat.exe'))) {
    throw new Error('Не найдена dist/win-publish/TwitchChat.exe. Сначала выполни npm run build:win.');
  }
  copy(publish, payload);
} else {
  const dist = path.join(root, 'dist');
  const candidates = ['mac-arm64', 'mac-x64', 'mac-universal', 'mac'];
  let appPath = null;

  for (const directory of candidates) {
    const candidate = path.join(dist, directory, 'TwitchChat.app');
    if (fs.existsSync(candidate)) {
      appPath = candidate;
      break;
    }
  }

  if (!appPath) {
    throw new Error('Не найден TwitchChat.app. Сначала собери приложение macOS командой npx electron-builder --mac --dir.');
  }

  copy(appPath, path.join(payload, 'TwitchChat.app'));
}

const executable = path.join(
  here,
  'node_modules',
  '.bin',
  isWindows ? 'electron-builder.cmd' : 'electron-builder'
);

if (!fs.existsSync(executable)) {
  throw new Error('Зависимости установщика не найдены. Выполни npm install в папке installer.');
}

const result = spawnSync(executable, [isWindows ? '--win' : '--mac'], {
  cwd: here,
  stdio: 'inherit',
  shell: isWindows
});

if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status || 1);

console.log(`TwitchChat Setup собран. Версия приложения: ${appPackage.version}`);
console.log(`Версия оболочки установщика: ${setupPackage.version}`);
