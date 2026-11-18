const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getChannel: () => ipcRenderer.invoke('get-channel'),
  start: (channel) => ipcRenderer.invoke('start', channel),
  copy: (text) => ipcRenderer.invoke('copy', text)
});
