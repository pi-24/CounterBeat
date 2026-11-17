/** Steam config loading (main process, no Electron import so it is testable). */
const fs = require('node:fs');
const path = require('node:path');

/** data/steam.json is shipped inside the app (electron-builder "files"), so it sits one level above electron/. */
function steamConfigPath(baseDir = path.join(__dirname, '..', '..')) {
    return path.join(baseDir, 'data', 'steam.json');
}

/** Returns the parsed config, or {} after one warning (missing/malformed). appId validity is checked by createSteamService. */
function loadSteamConfig({ file = steamConfigPath(), logger = console } = {}) {
    try {
        const cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
        return cfg && typeof cfg === 'object' ? cfg : {};
    } catch (err) {
        logger.warn(`[steam] cannot read ${file}: ${(err && err.message) || err}`);
        return {};
    }
}

/** Problems that must block a release build (placeholder or invalid App ID). Empty array = OK. */
function releaseProblems(cfg) {
    const out = [];
    if (!cfg || !Number.isInteger(cfg.appId) || cfg.appId <= 0) out.push('appId missing or invalid');
    else if (cfg.appId === 480 || cfg.appIdIsPlaceholder) out.push(`appId ${cfg.appId} is the dev placeholder`);
    return out;
}

module.exports = { releaseProblems, steamConfigPath, loadSteamConfig };
