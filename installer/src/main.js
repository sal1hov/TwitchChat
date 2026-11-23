const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { installWindows, getWindowsDefaultPath } = require('./platform/windows');
const { installMacOS, getMacDefaultPath } = require('./platform/macos');

const product = require(path.join(__dirname, '..', 'package.json'));
let win;

function createWindow() {
  win = new BrowserWindow({
    width: 860,
    height: 620,
    minWidth: 760,
    minHeight: 560,
    frame: false,
    transparent: true,
    resizable: false,
    show: false,
    backgroundColor: '#00000000',
    title: 'TwitchChat Setup',
    icon: path.join(process.resourcesPath, 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  win.removeMenu();
  win.loadFile(path.join(__dirname, 'ui', 'index.html'));
  win.once('ready-to-show', () => win.show());
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());

ipcMain.handle('setup:info', () => ({
  version: product.version,
  platform: process.platform,
  defaultPath: process.platform === 'win32' ? getWindowsDefaultPath() : getMacDefaultPath(),
  os: `${os.type()} ${os.release()}`
}));

ipcMain.handle('window:minimize', () => win?.minimize());
ipcMain.handle('window:close', () => app.quit());
ipcMain.handle('dialog:choose-folder', async (_event, currentPath) => {
  const result = await dialog.showOpenDialog(win, {
    title: 'Выберите папку установки TwitchChat',
    defaultPath: currentPath,
    properties: ['openDirectory', 'createDirectory']
  });
  return result.canceled ? null : result.filePaths[0];
});
ipcMain.handle('setup:install', async (event, targetPath) => {
  const send = (stage, percent, message) => event.sender.send('setup:progress', { stage, percent, message });
  try {
    const payloadRoot = process.resourcesPath;
    if (process.platform === 'win32') {
      await installWindows({ payload: path.join(payloadRoot, 'payload', 'windows'), targetPath, send, app });
    } else if (process.platform === 'darwin') {
      await installMacOS({ payload: path.join(payloadRoot, 'payload', 'macos'), targetPath, send, app });
    } else {
      throw new Error('Эта операционная система не поддерживается.');
    }
    return { ok: true, path: targetPath };
  } catch (error) {
    return { ok: false, error: error.message || String(error) };
  }
});
ipcMain.handle('setup:launch', async (_event, targetPath) => {
  const executable = process.platform === 'win32'
    ? path.join(targetPath, 'TwitchChat.exe')
    : path.join(targetPath, 'TwitchChat.app');
  if (process.platform === 'darwin') await shell.openPath(executable);
  else await shell.openPath(executable);
  app.quit();
});
ipcMain.handle('setup:open-folder', (_event, targetPath) => shell.openPath(targetPath));
