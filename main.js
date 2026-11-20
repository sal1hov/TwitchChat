const { app, BrowserWindow, Tray, Menu, clipboard, nativeImage, ipcMain, shell } = require('electron');
const fs = require('fs');
const path = require('path');
const { startChannel, stopChannel, setAppearance, port } = require('./server');

let win = null;
let tray = null;
let quitting = false;
let obsUrl = '';

const settingsPath = () => path.join(app.getPath('userData'), 'settings.json');

function readSettings() {
  try {
    return JSON.parse(fs.readFileSync(settingsPath(), 'utf8'));
  } catch (err) {
    return { channel: '' };
  }
}

function writeSettings(data) {
  fs.mkdirSync(path.dirname(settingsPath()), { recursive: true });
  fs.writeFileSync(settingsPath(), JSON.stringify(data));
}

function trayIcon() {
  const file = process.platform === 'darwin' ? 'tray-mac.png' : 'icon.png';
  const image = nativeImage.createFromPath(path.join(__dirname, 'assets', file));
  if (process.platform !== 'darwin') return image;
  return image.resize({ width: 22, height: 22, quality: 'best' });
}

function refreshTray() {
  if (!tray) return;
  tray.setContextMenu(Menu.buildFromTemplate([
    {
      label: 'Открыть',
      click: () => showWindow()
    },
    {
      label: 'Скопировать ссылку',
      enabled: !!obsUrl,
      click: () => clipboard.writeText(obsUrl)
    },
    { type: 'separator' },
    {
      label: 'Выйти',
      click: () => {
        quitting = true;
        app.quit();
      }
    }
  ]));
}

function showWindow() {
  if (!win) return;
  win.show();
  win.focus();
}

function createWindow() {
  win = new BrowserWindow({
    width: 940,
    height: 700,
    frame: false,
    resizable: false,
    maximizable: false,
    backgroundColor: '#0d0b18',
    title: 'ChatServer',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  win.removeMenu();
  win.loadFile(path.join(__dirname, 'app.html'));
  win.once('ready-to-show', () => win.show());

  win.on('close', (event) => {
    if (quitting) return;
    event.preventDefault();
    win.hide();
  });
}

ipcMain.handle('window-minimize', () => {
  if (win && !win.isDestroyed()) win.minimize();
});

ipcMain.handle('window-close', () => {
  if (win && !win.isDestroyed()) win.close();
});

ipcMain.handle('get-channel', () => readSettings().channel || '');

ipcMain.handle('get-appearance', () => readSettings().appearance || {});

ipcMain.handle('set-appearance', (event, params) => {
  const clean = setAppearance(params);
  writeSettings({ ...readSettings(), appearance: clean });
  return clean;
});

ipcMain.handle('start', async (event, channel) => {
  try {
    const result = await startChannel(channel);
    if (result && result.superseded) return { ok: true, superseded: true };
    obsUrl = result.url;
    writeSettings({ ...readSettings(), channel: result.channel });
    refreshTray();
    return { ok: true, url: result.url, channel: result.channel };
  } catch (err) {
    const url = err.url || (obsUrl || '');
    if (url) obsUrl = url;
    refreshTray();
    return {
      ok: false,
      url,
      error: err.code === 'EADDRINUSE' ? 'Порт ' + port + ' уже занят' : (err.message || 'Не вышло')
    };
  }
});

ipcMain.handle('stop', async () => {
  await stopChannel();
  return { ok: true };
});

ipcMain.handle('quit', () => {
  quitting = true;
  app.quit();
});

ipcMain.handle('copy', (event, text) => {
  clipboard.writeText(String(text || ''));
});

ipcMain.handle('version', () => app.getVersion().replace(/\.0$/, ''));

ipcMain.handle('open-author', () => shell.openExternal('https://github.com/strdns'));

ipcMain.handle('open-authorfork', () => shell.openExternal('https://github.com/sal1hov'));

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => showWindow());

  app.whenReady().then(() => {
    // Сервер должен знать сохранённое оформление ещё до первого подключения виджета
    setAppearance(readSettings().appearance || {});
    createWindow();
    tray = new Tray(trayIcon());
    tray.setToolTip('ChatServer');
    refreshTray();
    tray.on('click', () => showWindow());
  });

  app.on('before-quit', () => {
    quitting = true;
  });

  app.on('window-all-closed', () => {});

  app.on('activate', () => showWindow());
}