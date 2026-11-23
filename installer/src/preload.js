const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('setupAPI', {
  info: () => ipcRenderer.invoke('setup:info'),
  minimize: () => ipcRenderer.invoke('window:minimize'),
  close: () => ipcRenderer.invoke('window:close'),
  chooseFolder: path => ipcRenderer.invoke('dialog:choose-folder', path),
  install: path => ipcRenderer.invoke('setup:install', path),
  launch: path => ipcRenderer.invoke('setup:launch', path),
  openFolder: path => ipcRenderer.invoke('setup:open-folder', path),
  onProgress: callback => ipcRenderer.on('setup:progress', (_event, data) => callback(data))
});
