const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('shield', {
  call: (name, ...args) => ipcRenderer.invoke(name, ...args),
  send: (channel, ...args) => ipcRenderer.send(channel, ...args),
  on: (channel, fn) => ipcRenderer.on(channel, (_e, ...a) => fn(...a))
});
