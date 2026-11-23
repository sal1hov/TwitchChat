const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');
const { promisify } = require('util');
const exec = promisify(execFile);

function getMacDefaultPath() {
  const applications = '/Applications';
  try {
    fs.accessSync(applications, fs.constants.W_OK);
    return applications;
  } catch {
    return path.join(os.homedir(), 'Applications');
  }
}

async function installMacOS({ payload, targetPath, send, app }) {
  const source = path.join(payload, 'TwitchChat.app');
  if (!fs.existsSync(source)) throw new Error('В установочном пакете отсутствует TwitchChat.app.');
  const destination = path.join(targetPath, 'TwitchChat.app');

  send('prepare', 10, 'Подготавливаем установку…');
  fs.mkdirSync(targetPath, { recursive: true });
  try {
    await exec('/usr/bin/osascript', ['-e', 'tell application "TwitchChat" to quit'], { timeout: 5000 });
  } catch {}

  send('copy', 25, 'Копируем TwitchChat…');
  try {
    fs.rmSync(destination, { recursive: true, force: true });
    fs.cpSync(source, destination, { recursive: true, force: true, preserveTimestamps: true });
  } catch (error) {
    if (error.code === 'EACCES' || error.code === 'EPERM') {
      throw new Error('Нет доступа к выбранной папке. Выбери другую папку или запусти установку с правами администратора.');
    }
    throw error;
  }

  send('finish', 100, 'TwitchChat успешно установлен.');
}

module.exports = { installMacOS, getMacDefaultPath };
