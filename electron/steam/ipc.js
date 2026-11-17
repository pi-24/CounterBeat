/** IPC wiring for the Steam service. Channels are derived from API_METHODS so the bridge cannot drift. */
const { API_METHODS, NullSteamService } = require('./NullSteamService.js');

const channel = (method) => `cb:steam:${method}`;
const NAMED = new Set(['unlockAchievement', 'isAchievementUnlocked']);

/** Registers one ipcMain.handle per renderer-facing method. Failures return the typed "disabled" value, never null. */
function registerSteamIpc(ipcMain, steam, { achievements = null } = {}) {
    const allowed = Array.isArray(achievements) ? new Set(achievements) : null; // data-driven list from data/steam.json
    const fallback = new NullSteamService('steam call failed');
    for (const m of API_METHODS) {
        ipcMain.handle(channel(m), (_e, arg) => {
            try {
                if (NAMED.has(m)) return typeof arg === 'string' && arg && (!allowed || allowed.has(arg)) ? steam[m](arg) : false;
                return steam[m]();
            } catch { return fallback[m](); }
        });
    }
}

module.exports = { registerSteamIpc, channel };
