// Preload bridge (contextIsolation on, sandboxed). CommonJS because electron/package.json
// sets "type": "commonjs" for this folder. Exposes the platform flag and window controls only.
const { contextBridge, ipcRenderer } = require('electron');
// Sandboxed preloads cannot require local files, so this list is duplicated from
// electron/steam/NullSteamService.js API_METHODS; tests/unit/steam-init.test.mjs enforces parity.
const STEAM_METHODS = ['getStatus', 'getPlayerName', 'unlockAchievement', 'isAchievementUnlocked'];
const steam = {};
for (const m of STEAM_METHODS) steam[m] = (arg) => ipcRenderer.invoke(`cb:steam:${m}`, arg);

contextBridge.exposeInMainWorld('counterbeatDesktop', {
    platform: 'desktop',
    setWindowed: (windowed) => ipcRenderer.send('cb:set-windowed', Boolean(windowed)),
    onWindowedChange: (cb) => ipcRenderer.on('cb:windowed', (_e, value) => cb(Boolean(value))),
    steam: steam,
    quit: () => ipcRenderer.send('cb:quit'),
});
