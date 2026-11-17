/**
 * cloudSave.js - boots the Steam Cloud save in the desktop app.
 * The Electron preload exposes `counterbeatDesktop.saveIO` ({read, write});
 * in a plain browser there is none and this does nothing.
 * Call once, before any screen reads settings or progress.
 */
import { SaveFile } from './SaveFile.js';

export function bootCloudSave(storage, desktop = globalThis.counterbeatDesktop) {
    const io = desktop?.saveIO;
    if (!io) return null;
    const save = new SaveFile(storage, io);
    try { save.syncFromFile(); } catch (error) { console.warn('cloud save sync failed', error); }
    save.attach(storage);
    return save;
}
