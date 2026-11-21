/** Save-file IO for Steam Cloud: one file in %APPDATA%/CounterBeat (see data/steam.json cloud). */
const { join, dirname } = require('node:path');
const fs = require('node:fs');

const SAVE_DIR = 'CounterBeat';
const SAVE_FILE = 'counterbeat-save.json';

function savePath(appDataDir) { return join(appDataDir, SAVE_DIR, SAVE_FILE); }

function readSave(path, fsApi = fs) {
    try { return fsApi.readFileSync(path, 'utf8'); } catch { return null; }
}

/** Atomic write: temp file then rename, so Steam never uploads a half-written file. */
function writeSave(path, text, fsApi = fs) {
    if (typeof text !== 'string' || text.length > 1048576) return false;
    try {
        fsApi.mkdirSync(dirname(path), { recursive: true });
        fsApi.writeFileSync(`${path}.tmp`, text);
        fsApi.renameSync(`${path}.tmp`, path);
        return true;
    } catch { return false; }
}

function registerSaveIpc(ipcMain, appDataDir, fsApi = fs) {
    const path = savePath(appDataDir);
    ipcMain.on('cb:save:read', (e) => { e.returnValue = readSave(path, fsApi); });
    ipcMain.on('cb:save:write', (e, text) => { e.returnValue = writeSave(path, text, fsApi); });
}

module.exports = { savePath, readSave, writeSave, registerSaveIpc, SAVE_DIR, SAVE_FILE };
