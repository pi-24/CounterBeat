/**
 * SteamService - wraps steamworks.js (main process only). createSteamService() never throws:
 * when Steam is absent or init fails it logs ONE warning and returns a NullSteamService.
 * The steamworks.js module is loaded lazily (and injectable) so dev builds without it still run.
 */
const { NullSteamService, API_METHODS } = require('./NullSteamService.js');

class SteamService {
    /** @param {object} client the steamworks.js client returned by init() */
    constructor(client, appId) {
        this.available = true;
        this.client = client;
        this.appId = appId;
    }
    getStatus() {
        // Capabilities reflect what the client exposes; cloud saves are not implemented yet.
        return { available: this.available, achievements: Boolean(this.client.achievement), cloud: false, appId: this.appId, reason: null };
    }
    getPlayerName() {
        try { return this.client.localplayer.getName(); } catch { return null; }
    }
    unlockAchievement(name) {
        try { return Boolean(this.client.achievement.activate(String(name))); } catch { return false; }
    }
    isAchievementUnlocked(name) {
        try { return Boolean(this.client.achievement.isActivated(String(name))); } catch { return false; }
    }
    /** Auth session ticket as hex (identity only; verified server-side), or null. */
    getAuthTicket() {
        try {
            const t = this.client.auth.getSessionTicket();
            const bytes = t && typeof t.getBytes === 'function' ? t.getBytes() : null;
            return bytes && bytes.length ? Buffer.from(bytes).toString('hex') : null;
        } catch { return null; }
    }
    /** steamworks.js 0.4 has no teardown API (it runs its own callback loop); drop our reference and mark unavailable. */
    release() {
        this.available = false;
        this.client = {};
    }
}

/**
 * @param {{config?:{appId?:number}, loadModule?:()=>any, logger?:{warn:Function}, enableOverlay?:boolean}} opts
 * @returns {SteamService|NullSteamService}
 */
function createSteamService({ config = {}, loadModule = () => require('steamworks.js'), logger = console, enableOverlay = true, forceOff = false } = {}) {
    const appId = Number(config.appId);
    try {
        if (forceOff) throw new Error('disabled by CB_STEAM_FORCE_OFF');
        if (!Number.isInteger(appId) || appId <= 0) throw new Error('invalid appId in data/steam.json');
        const sw = loadModule();
        const client = sw.init(appId);
        // The helper itself appends the Chromium switches the overlay needs (in-process-gpu, disable-direct-composition).
        if (enableOverlay && typeof sw.electronEnableSteamOverlay === 'function') sw.electronEnableSteamOverlay();
        if (config.appIdIsPlaceholder) logger.warn(`[steam] App ID ${appId} is the dev placeholder - set the real App ID in data/steam.json before release`);
        return new SteamService(client, appId);
    } catch (err) {
        const missing = err && err.code === 'MODULE_NOT_FOUND';
        logger.warn(`[steam] disabled, running offline (${missing ? 'steamworks.js module missing - packaging problem?' : 'Steam not running or init failed'}): ${(err && err.message) || err}`);
        return new NullSteamService(String((err && err.message) || err));
    }
}

module.exports = { SteamService, createSteamService, API_METHODS };
