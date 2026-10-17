// The page gets exactly these calls and nothing else from Node/Electron.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('hud', {
  usage: () => ipcRenderer.invoke('usage'),
  setupClaudeLimits: () => ipcRenderer.invoke('setup-claude-limits'),
  beginKeyCapture: () => ipcRenderer.invoke('begin-key-capture'),
  cancelKeyCapture: () => ipcRenderer.invoke('cancel-key-capture'),
  setHotkey: (acc) => ipcRenderer.invoke('set-hotkey', acc),
  resize: (h) => ipcRenderer.send('resize', h),
  hide: () => ipcRenderer.send('hide'),
  quit: () => ipcRenderer.send('quit'),
  onRefresh: (cb) => ipcRenderer.on('refresh', () => cb()),
  isMac: process.platform === 'darwin',
});
