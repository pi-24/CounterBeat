import test from 'node:test';
import assert from 'node:assert/strict';
import { Settings } from '../../src/game/Settings.js';
import { rebind, sanitiseBindings, DEFAULT_BINDINGS, strafeDirection, findConflict } from '../../src/game/input/bindings.js';
import { PALETTES, GRADE_ICONS } from '../../src/game/feel/judgementPalette.js';
import { effectPolicy } from '../../src/game/feel/reducedEffects.js';

const memory = () => {
    const data = new Map();
    return { read: (k, f) => (data.has(k) ? JSON.parse(JSON.stringify(data.get(k))) : f), write: (k, v) => { data.set(k, v); return true; } };
};

test('rebinding to a free key works', () => {
    const r = rebind(DEFAULT_BINDINGS, 'fire', 'KeyF');
    assert.ok(r.ok);
    assert.equal(r.bindings.fire, 'KeyF');
});

test('rebinding onto a key used by another action is a conflict and changes nothing', () => {
    const r = rebind(DEFAULT_BINDINGS, 'strafeLeft', 'KeyD');
    assert.ok(!r.ok);
    assert.equal(r.reason, 'conflict');
    assert.equal(r.conflict, 'strafeRight');
    assert.deepEqual(r.bindings, DEFAULT_BINDINGS);
    assert.equal(findConflict(DEFAULT_BINDINGS, 'Space'), 'fire');
});

test('re-pressing an action\'s own key is fine; reserved keys are refused', () => {
    assert.ok(rebind(DEFAULT_BINDINGS, 'fire', 'Space').ok);
    assert.equal(rebind(DEFAULT_BINDINGS, 'fire', 'Escape').reason, 'reserved');
    assert.equal(rebind(DEFAULT_BINDINGS, 'nope', 'KeyZ').reason, 'unknown-action');
});

test('corrupt or duplicate stored bindings fall back to defaults', () => {
    assert.deepEqual(sanitiseBindings({ strafeLeft: 'KeyQ', strafeRight: 'KeyQ', fire: 'Space' }), DEFAULT_BINDINGS);
    assert.deepEqual(sanitiseBindings(null), DEFAULT_BINDINGS);
    assert.deepEqual(sanitiseBindings({ strafeLeft: 'Escape' }), DEFAULT_BINDINGS);
});

test('strafe direction follows bindings, arrows always work', () => {
    const b = { ...DEFAULT_BINDINGS, strafeLeft: 'KeyJ', strafeRight: 'KeyL' };
    const keys = (...codes) => (c) => codes.includes(c);
    assert.equal(strafeDirection(keys('KeyJ'), b), -1);
    assert.equal(strafeDirection(keys('KeyL'), b), 1);
    assert.equal(strafeDirection(keys('KeyA'), b), 0);
    assert.equal(strafeDirection(keys('ArrowLeft'), b), -1);
    assert.equal(strafeDirection(keys('KeyJ', 'KeyL'), b), 0);
});

test('every new setting persists across a reload', () => {
    const storage = memory();
    const s = new Settings(storage);
    s.update({
        musicVolume: 0.3, sfxVolume: 0.4, hitVolume: 0.5, judgementPalette: 'safe',
        reducedFlash: true, beatCue: true,
        bindings: rebind(DEFAULT_BINDINGS, 'fire', 'KeyF').bindings,
    });
    const reloaded = new Settings(storage);
    assert.equal(reloaded.get('musicVolume'), 0.3);
    assert.equal(reloaded.get('sfxVolume'), 0.4);
    assert.equal(reloaded.get('hitVolume'), 0.5);
    assert.equal(reloaded.get('judgementPalette'), 'safe');
    assert.equal(reloaded.get('reducedFlash'), true);
    assert.equal(reloaded.get('beatCue'), true);
    assert.equal(reloaded.get('bindings').fire, 'KeyF');
});

test('settings are clamped and validated', () => {
    const s = new Settings(memory());
    s.update({ musicVolume: 7, sfxVolume: -1, judgementPalette: 'bogus', bindings: { strafeLeft: 'KeyA', strafeRight: 'KeyA', fire: 'Space' } });
    assert.equal(s.get('musicVolume'), 1);
    assert.equal(s.get('sfxVolume'), 0);
    assert.equal(s.get('judgementPalette'), 'neon');
    assert.deepEqual(s.get('bindings'), DEFAULT_BINDINGS);
});

test('colour-blind palette: four distinct colours and a distinct icon per grade', () => {
    assert.equal(new Set(Object.values(GRADE_ICONS)).size, 4);
    for (const palette of Object.values(PALETTES)) {
        assert.equal(new Set(Object.values(palette)).size, 4);
    }
});

test('reduced flash caps flashes without turning off the other effects', () => {
    const policy = effectPolicy({ reducedEffects: false, reducedFlash: true });
    assert.ok(policy.limitFlashes);
    assert.ok(policy.pulse && policy.cameraKick);
    assert.ok(!effectPolicy({ reducedEffects: false, reducedFlash: false }).limitFlashes);
});

import { Settings as SettingsClass } from '../../src/game/Settings.js';
import { DEFAULT_SETTINGS as DEFAULTS_FOR_CLONE } from '../../src/game/rules/config.js';

test('settings do not share the default bindings object', () => {
    const mem = { read: (k, d) => d, write: () => {} };
    const s = new SettingsClass(mem);
    assert.notEqual(s.values.bindings, DEFAULTS_FOR_CLONE.bindings);
});
