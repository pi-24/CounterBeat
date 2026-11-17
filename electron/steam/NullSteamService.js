/** API_METHODS is the renderer-facing surface; release() is main-process only. */
/** NullSteamService - offline fallback with the same API shape as SteamService. Never throws. */
const API_METHODS = ['getStatus', 'getPlayerName', 'unlockAchievement', 'isAchievementUnlocked'];

class NullSteamService {
    /** @param {string} [reason] why Steam is unavailable */
    constructor(reason = 'steam unavailable') {
        this.available = false;
        this.reason = reason;
    }
    getStatus() { return { available: false, achievements: false, cloud: false, appId: null, reason: this.reason }; }
    getPlayerName() { return null; }
    unlockAchievement() { return false; }
    isAchievementUnlocked() { return false; }
    release() {}
}

module.exports = { NullSteamService, API_METHODS };
