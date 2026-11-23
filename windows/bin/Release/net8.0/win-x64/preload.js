const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  minimizeWindow: () => ipcRenderer.invoke('window-minimize'),
  closeWindow: () => ipcRenderer.invoke('window-close'),
  getChannel: () => ipcRenderer.invoke('get-channel'),
  start: (channel) => ipcRenderer.invoke('start', channel),
  stop: () => ipcRenderer.invoke('stop'),
  quit: () => ipcRenderer.invoke('quit'),
  copy: (text) => ipcRenderer.invoke('copy', text),
  version: () => ipcRenderer.invoke('version'),
  openAuthor: () => ipcRenderer.invoke('open-author'),
  openAuthorFork: () => ipcRenderer.invoke('open-authorfork'),
  getAppearance: () => ipcRenderer.invoke('get-appearance'),
  setAppearance: (params) => ipcRenderer.invoke('set-appearance', params)
});