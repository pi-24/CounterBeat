// Preload bridge (contextIsolation on, sandboxed). CommonJS because electron/package.json
// sets "type": "commonjs" for this folder. Exposes the platform flag and window controls only.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('counterbeatDesktop', {
    platform: 'desktop',
    setWindowed: (windowed) => ipcRenderer.send('cb:set-windowed', Boolean(windowed)),
    onWindowedChange: (cb) => ipcRenderer.on('cb:windowed', (_e, value) => cb(Boolean(value))),
    quit: () => ipcRenderer.send('cb:quit'),
});
