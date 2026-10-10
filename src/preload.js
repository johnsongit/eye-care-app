const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getState: () => ipcRenderer.invoke('get-state'),
  update: (patch) => ipcRenderer.invoke('update-settings', patch),
  onState: (cb) => ipcRenderer.on('state', (_e, s) => cb(s)),
  minimize: () => ipcRenderer.send('win', 'minimize'),
  close: () => ipcRenderer.send('win', 'close'),
  reminderAction: (action) => ipcRenderer.send('reminder-action', action),
  onReminder: (cb) => ipcRenderer.on('reminder', (_e, data) => cb(data)),
});
