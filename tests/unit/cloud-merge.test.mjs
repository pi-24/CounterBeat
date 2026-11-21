import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeSave, isSyncedKey, parseSave } from '../../src/progress/mergeSave.js';
import { SaveFile } from '../../src/progress/SaveFile.js';

const save = (keys) => ({ version: 1, keys });
const k = (t, v) => ({ t, v });

test('newer remote wins', () => {
    const r = mergeSave(save({ progress: k(1, 'L') }), save({ progress: k(2, 'R') }));
    assert.equal(r.save.keys.progress.v, 'R');
    assert.deepEqual(r.takenFromRemote, ['progress']);
});
test('newer local wins', () => {
    const r = mergeSave(save({ progress: k(5, 'L') }), save({ progress: k(2, 'R') }));
    assert.equal(r.save.keys.progress.v, 'L');
    assert.equal(r.source, 'local');
});
test('equal timestamps: local wins, deterministic', () => {
    const a = mergeSave(save({ settings: k(3, 'L') }), save({ settings: k(3, 'R') }));
    const b = mergeSave(save({ settings: k(3, 'L') }), save({ settings: k(3, 'R') }));
    assert.equal(a.save.keys.settings.v, 'L');
    assert.deepEqual(a, b);
});
test('no field-level merging', () => {
    const r = mergeSave(save({ settings: k(1, { a: 1, b: 1 }) }), save({ settings: k(2, { a: 2 }) }));
    assert.deepEqual(r.save.keys.settings.v, { a: 2 });
});
test('missing keys are kept from either side', () => {
    const r = mergeSave(save({ settings: k(1, 1) }), save({ onboarding: k(1, 2) }));
    assert.deepEqual(Object.keys(r.save.keys), ['onboarding', 'settings']);
});
test('corrupt or unparsable remote falls back to local', () => {
    const local = save({ progress: k(1, 'L') });
    for (const bad of ['{nope', null, '[]', [], { version: 9, keys: {} }, { version: 1, keys: [] }]) {
        const r = mergeSave(local, bad);
        assert.equal(r.save.keys.progress.v, 'L');
        assert.equal(r.source, 'local');
    }
});
test('ranked keys are excluded from both sides', () => {
    const bad = { scores: k(9, []), logs: k(9, {}), users: k(9, []), session: k(9, 1), 'account.progress': k(9, 1), ranked: k(9, 1) };
    const r = mergeSave(save({ ...bad, progress: k(1, 1) }), save({ ...bad, 'localBests:guest': k(1, {}) }));
    assert.deepEqual(Object.keys(r.save.keys), ['localBests:guest', 'progress']);
    assert.equal(isSyncedKey('scores'), false);
    assert.equal(isSyncedKey('localBests:u1'), true);
    assert.equal(parseSave(save({ scores: k(1, 1) })).keys.scores, undefined);
});

function mem() {
    const m = new Map();
    return { read: (key, f) => (m.has(key) ? JSON.parse(m.get(key)) : f), write: (key, v) => (m.set(key, JSON.stringify(v)), true), remove: (key) => m.delete(key) };
}
test('SaveFile stamps writes, skips ranked keys, and pulls newer remote', () => {
    let file = null;
    const t = 10;
    const io = { read: () => file, write: (s) => { file = s; } };
    const sf = new SaveFile(mem(), io, { now: () => t, delayMs: 0 });
    sf.write('progress', { stars: 3 });
    sf.write('scores', [1]);
    const written = JSON.parse(file);
    assert.deepEqual(Object.keys(written.keys), ['progress']);
    assert.equal(written.keys.progress.t, 10);
    file = JSON.stringify(save({ progress: k(20, { stars: 9 }), settings: k(5, { x: 1 }) }));
    const r = sf.syncFromFile();
    assert.deepEqual(r.takenFromRemote, ['progress', 'settings']);
    assert.deepEqual(sf.read('progress', null), { stars: 9 });
    file = '{garbage';
    sf.syncFromFile();
    assert.deepEqual(sf.read('progress', null), { stars: 9 });
});

import { FIRST_RUN_KEY } from '../../src/game/onboarding/firstRun.js';
import { Storage } from '../../src/core/Storage.js';
import { bootCloudSave } from '../../src/progress/cloudSave.js';
import { settings } from '../../src/game/Settings.js';
import { createRequire } from 'node:module';

function backing() {
    const m = new Map();
    return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), key: (i) => [...m.keys()][i] ?? null, get length() { return m.size; } };
}

test('synced keys cover settings (calibration offset), progress, onboarding and local bests', () => {
    assert.equal(isSyncedKey(FIRST_RUN_KEY), true);
    assert.equal(isSyncedKey(settings.constructor.name === 'Settings' ? 'settings' : ''), true);
    assert.ok('audioOffset' in settings.values, 'calibration offset lives in the synced settings key');
    assert.equal(isSyncedKey('progress'), true);
});

test('round trip through a fake io with legacy backfill, tombstone and debounce', () => {
    let file = null;
    const io = { read: () => file, write: (s) => { file = s; } };
    const timers = [];
    const opts = (now) => ({ now: () => now, setTimer: (fn) => (timers.push(fn), timers.length), clearTimer: () => {} });
    const st = new Storage('t', backing());
    st.write('settings', { audioOffset: 0.02 }); // legacy: written before any SaveFile
    st.write('localBests:guest', { c: { best: 5, passed: true } });
    file = JSON.stringify(save({ settings: k(1, { audioOffset: 0.2 }), progress: k(2, { best: {} }) }));
    const sf = new SaveFile(st, io, opts(100));
    sf.syncFromFile();
    assert.deepEqual(st.read('settings'), { audioOffset: 0.02 }, 'legacy local data is not overwritten by older remote');
    assert.deepEqual(st.read('progress'), { best: {} });
    assert.ok(JSON.parse(file).keys['localBests:guest']);
    // debounce: many writes -> one timer, one file write
    sf.attach(st, {});
    let writes = 0;
    const baseWrite = io.write; io.write = (s) => { writes++; baseWrite(s); };
    timers.length = 0;
    for (let i = 0; i < 20; i++) st.write('settings', { audioOffset: i / 100 });
    assert.equal(timers.length, 1);
    assert.equal(writes, 0);
    timers[0]();
    assert.equal(writes, 1);
    assert.equal(JSON.parse(file).keys.settings.v.audioOffset, 0.19);
    // tombstone: removed key is not resurrected by the next sync
    st.remove('progress');
    sf.flush();
    assert.equal(JSON.parse(file).keys.progress.deleted, true);
    const st2 = new Storage('t2', backing());
    st2.write('progress', { best: { x: [true, false, false] } });
    const sf2 = new SaveFile(st2, io, opts(1));
    sf2.syncFromFile();
    assert.equal(st2.read('progress', 'gone'), 'gone');
});

test('mergeSave returns clones, not input references', () => {
    const l = save({ progress: k(5, { a: 1 }) });
    const r = mergeSave(l, save({}));
    r.save.keys.progress.t = 99;
    assert.equal(l.keys.progress.t, 5);
});

test('bootCloudSave is a no-op in a browser and active with saveIO', () => {
    assert.equal(bootCloudSave(new Storage('b', backing()), undefined), null);
    let file = null;
    const st = new Storage('c', backing());
    const sf = bootCloudSave(st, { saveIO: { read: () => file, write: (s) => { file = s; } } });
    assert.ok(sf);
    assert.ok(file && JSON.parse(file).version === 1);
});

test('electron save io writes atomically and reads back', () => {
    const { writeSave, readSave, savePath } = createRequire(import.meta.url)('../../electron/saveIo.js');
    const files = new Map();
    const fsApi = { mkdirSync() {}, writeFileSync: (p, t) => files.set(p, t), renameSync: (a, b) => { files.set(b, files.get(a)); files.delete(a); }, readFileSync: (p) => { if (!files.has(p)) throw new Error('x'); return files.get(p); } };
    const p = savePath('/appdata');
    assert.equal(readSave(p, fsApi), null);
    assert.equal(writeSave(p, '{"a":1}', fsApi), true);
    assert.equal(readSave(p, fsApi), '{"a":1}');
    assert.equal(writeSave(p, 5, fsApi), false);
});
