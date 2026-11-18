const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getChannel: () => ipcRenderer.invoke('get-channel'),
  start: (channel) => ipcRenderer.invoke('start', channel),
  stop: () => ipcRenderer.invoke('stop'),
  quit: () => ipcRenderer.invoke('quit'),
  copy: (text) => ipcRenderer.invoke('copy', text),
  version: () => ipcRenderer.invoke('version'),
  openAuthor: () => ipcRenderer.invoke('open-author')
});
