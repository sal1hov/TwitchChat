const { app, BrowserWindow, Tray, Menu, clipboard, nativeImage, ipcMain, shell } = require('electron');
const fs = require('fs');
const path = require('path');
const { startChannel, stopChannel, setAppearance, shutdownServer, port } = require('./server');

let win = null;
let tray = null;
let quitting = false;
let obsUrl = '';
let shutdownStarted = false;

const settingsPath = () => path.join(app.getPath('userData'), 'settings.json');

function readSettings() {
  try {
    const data = JSON.parse(fs.readFileSync(settingsPath(), 'utf8'));
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      return {};
    }

    // Ник Twitch больше не хранится.
    const { channel, ...settings } = data;
    return settings;
  } catch {
    return {};
  }
}

function writeSettings(data) {
  const file = settingsPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = file + '.tmp';
  fs.writeFileSync(temp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(temp, file);
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
    title: 'TwitchChat',
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
  obsUrl = '';
  refreshTray();
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
    tray.setToolTip('TwitchChat');
    refreshTray();
    tray.on('click', () => showWindow());
  });

  app.on('before-quit', (event) => {
    quitting = true;
    if (shutdownStarted) return;
    event.preventDefault();
    shutdownStarted = true;
    Promise.resolve(stopChannel())
      .then(() => shutdownServer())
      .catch((err) => console.error('Ошибка завершения TwitchChat:', err))
      .finally(() => app.exit(0));
  });

  app.on('window-all-closed', () => {});

  app.on('activate', () => showWindow());
}