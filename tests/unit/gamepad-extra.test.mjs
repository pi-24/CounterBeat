import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { GamepadInput, lookAxis } from '../../src/input/GamepadInput.js';
import { PAD_BUTTON } from '../../src/input/padBindings.js';
import { activeScope } from '../../src/input/menuFocus.js';
import { padEventStamp, inputLagSeconds } from '../../src/input/inputTime.js';
import { activeDevice, tutorialText, padControlRows } from '../../src/input/prompts.js';
import { STAGES } from '../../src/game/onboarding/tutorialStages.js';
import { RunRecorder } from '../../src/game/RunRecorder.js';
import { PAD_SETTING_DEFAULTS, PAD_RANGES, padSettingDefaults } from '../../src/input/gamepadConfig.js';
import { Settings } from '../../src/game/Settings.js';

/** A standard-layout pad snapshot. */
function pad({ axes = [0, 0, 0, 0], down = [], timestamp = 0 } = {}) {
    return {
        id: 'Xbox 360 Controller (STANDARD GAMEPAD)',
        connected: true,
        timestamp,
        axes,
        buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: down.includes(i), value: down.includes(i) ? 1 : 0 })),
    };
}

function memoryStore(initial = {}) {
    const data = { ...initial };
    return { read: (key, fallback) => data[key] ?? fallback, write: (key, value) => { data[key] = JSON.parse(JSON.stringify(value)); } };
}

// ------------------------------------------------------- input time ----

test('a pad press carries the snapshot timestamp (less the latency setting); bad stamps fall back to now', () => {
    assert.equal(padEventStamp({ timestamp: 990 }, 1000), 990);
    assert.equal(padEventStamp({ timestamp: 990 }, 1000, 12), 978);
    assert.equal(padEventStamp({ timestamp: 1005 }, 1000), 1000, 'a stamp from the future is clamped to now');
    assert.equal(padEventStamp({}, 1000), 1000);
    assert.equal(padEventStamp({ timestamp: NaN }, 1000, 5), 995);
});

test('pad and mouse shots made at the same real instant are wound back by the same amount', () => {
    const now = 5000;
    const instant = 4992; // the press happened 8 ms ago
    const events = [];
    const state = { pad: pad() };
    const input = new GamepadInput({ getGamepads: () => [state.pad], now: () => now, play: true, getContext: () => 'play' });
    input.on('fire', (e) => events.push(e));
    input.poll(4000);
    state.pad = pad({ down: [PAD_BUTTON.RT], timestamp: instant });
    input.poll(4016);
    assert.equal(events.length, 1);
    const mouseLag = inputLagSeconds(now, instant);
    assert.equal(inputLagSeconds(now, events[0].timeStamp), mouseLag);
    assert.ok(Math.abs(mouseLag - 0.008) < 1e-9);
});

test('the pad latency setting adds to the wind-back of every pad shot, and is validated', () => {
    const state = { pad: pad() };
    const events = [];
    const input = new GamepadInput({ getGamepads: () => [state.pad], getLatencyMs: () => 20, now: () => 1000, play: true, getContext: () => 'play' });
    input.on('fire', (e) => events.push(e));
    input.poll(900);
    state.pad = pad({ down: [PAD_BUTTON.RT], timestamp: 990 });
    input.poll(916);
    assert.equal(events[0].timeStamp, 970);
    assert.ok(Math.abs(inputLagSeconds(1000, events[0].timeStamp) - 0.03) < 1e-9);
    const sanitised = Settings.sanitise({ padLatencyMs: 900, padLookSpeed: 0, padLookCurve: 7 });
    assert.equal(sanitised.padLatencyMs, PAD_RANGES.padLatencyMs.max);
    assert.equal(sanitised.padLookSpeed, PAD_RANGES.padLookSpeed.min);
    assert.equal(sanitised.padLookCurve, PAD_RANGES.padLookCurve.max);
});

test('menu A press emits a timestamped tap for the calibration test as well as confirm', () => {
    const state = { pad: pad() };
    const nav = [];
    const taps = [];
    const input = new GamepadInput({ getGamepads: () => [state.pad], now: () => 1100, play: true, getContext: () => 'menu' });
    input.on('nav', (e) => nav.push(e));
    input.on('tap', (e) => taps.push(e));
    input.poll(1000);
    state.pad = pad({ down: [PAD_BUTTON.A], timestamp: 1090 });
    input.poll(1016);
    assert.deepEqual(taps, [{ timeStamp: 1090 }]);
    assert.deepEqual(nav, ['confirm']);
});

// ----------------------------------------------- sensitivity, settings ----

test('look response: linear vs eased, and the sensitivity / curve settings persist', () => {
    assert.ok(lookAxis(0.6, 0.2, 1) > lookAxis(0.6, 0.2, 2), 'linear is more sensitive at half stick');
    assert.equal(lookAxis(1, 0.2, 1), 1);
    assert.equal(lookAxis(-1, 0.2, 1.5), -1);
    assert.equal(lookAxis(0.5, 0.2, 'junk'), lookAxis(0.5, 0.2, 2));
    const store = memoryStore();
    const settings = new Settings(store);
    settings.update({ padLookSpeed: 2.2, padLookCurve: 1.25, padLatencyMs: 14 });
    const reloaded = new Settings(store);
    assert.equal(reloaded.get('padLookSpeed'), 2.2);
    assert.equal(reloaded.get('padLookCurve'), 1.25);
    assert.equal(reloaded.get('padLatencyMs'), 14);
    assert.equal(new Settings(memoryStore()).get('padLookSpeed'), 1);
});

test('settings never hand out the shared frozen pad bindings (first run or reset)', () => {
    const fresh = new Settings(memoryStore());
    const bindingsObject = fresh.get('padBindings');
    assert.equal(Object.isFrozen(bindingsObject), false);
    assert.notEqual(bindingsObject, PAD_SETTING_DEFAULTS.padBindings);
    bindingsObject.fire = 'B5'; // in-place mutation must not throw or leak into the defaults
    assert.equal(PAD_SETTING_DEFAULTS.padBindings.fire, 'B7');
    fresh.reset();
    assert.equal(Object.isFrozen(fresh.get('padBindings')), false);
    assert.equal(fresh.get('padBindings').fire, 'B7');
    assert.notEqual(padSettingDefaults().padBindings, padSettingDefaults().padBindings);
});

// ----------------------------------------------------------- robustness ----

test('a pad without a buttons array cannot spam the console: warn once, give up after repeated errors', () => {
    const warnings = [];
    const original = console.warn;
    console.warn = (...args) => warnings.push(args);
    try {
        const input = new GamepadInput({ getGamepads: () => [{ id: 'odd', connected: true, axes: [0, 0, 0, 0] }], play: true });
        input.poll(1);
        assert.equal(input.connected, true, 'a missing buttons array is tolerated, not thrown');
        assert.equal(warnings.length, 0);
        // A pad whose axes getter throws is a genuine fault.
        const broken = { connected: true, buttons: [], get axes() { throw new Error('boom'); } };
        const faulty = new GamepadInput({ getGamepads: () => [broken], play: true });
        for (let i = 0; i < 10; i += 1) faulty.poll(i);
        assert.equal(faulty.disabled, true);
        assert.equal(warnings.length, 2, 'one warning for the first error, one when giving up');
        faulty.start();
        assert.equal(faulty.rafId, 0, 'a disabled pad does not restart its loop');
    } finally {
        console.warn = original;
    }
});

// --------------------------------------------- overlay discovery, prompts ----

/** A fake element: only what activeScope reads. */
function fakeEl({ hidden = false, priority = 0, rects = 1 } = {}) {
    return {
        hidden,
        getAttribute: () => String(priority),
        closest: () => null,
        getClientRects: () => ({ length: rects }),
    };
}

test('every overlay in game.html carries data-pad-overlay, so none can fall out of pad navigation', () => {
    const html = readFileSync(new URL('../../game.html', import.meta.url), 'utf8');
    const overlays = [...html.matchAll(/<div[^>]*class="[^"]*\boverlay\b[^"]*"[^>]*>/g)].map((m) => m[0]);
    assert.ok(overlays.length >= 7);
    for (const tag of overlays) {
        assert.match(tag, /data-pad-overlay="\d+"/, tag);
    }
});

test('dialogs (Credits) are marked modal so they trap the pad', () => {
    const source = readFileSync(new URL('../../src/ui/CreditsScreen.js', import.meta.url), 'utf8');
    assert.match(source, /aria-modal/);
    assert.match(source, /credits-close/);
});

test('the pad scope is a visible modal first, then the highest-priority visible overlay', () => {
    const menu = fakeEl({ priority: 10 });
    const pause = fakeEl({ priority: 30 });
    const hiddenResult = fakeEl({ priority: 40, hidden: true });
    const zeroSize = fakeEl({ priority: 50, rects: 0 });
    const credits = fakeEl();
    const credits2 = fakeEl();
    const doc = (modals) => ({
        querySelectorAll: (selector) => (selector.includes('aria-modal') ? modals : [menu, pause, hiddenResult, zeroSize]),
    });
    assert.equal(activeScope(doc([])), pause);
    assert.equal(activeScope(doc([credits])), credits, 'a modal sits above the menu behind it');
    assert.equal(activeScope(doc([credits, credits2])), credits2);
    assert.equal(activeScope(doc([fakeEl({ hidden: true })])), pause, 'a closed modal does not trap the pad');
    assert.equal(activeScope({ querySelectorAll: () => [] }), null);
});

test('prompts follow the device last touched, and stay keyboard in play when pad play is off', () => {
    const base = { padConnected: true, padActiveAt: 500, kbMouseAt: 100, padPlays: true, inPlay: true };
    assert.equal(activeDevice(base), 'pad');
    assert.equal(activeDevice({ ...base, kbMouseAt: 900 }), 'kbm');
    assert.equal(activeDevice({ ...base, padConnected: false }), 'kbm');
    assert.equal(activeDevice({ ...base, padPlays: false }), 'kbm');
    assert.equal(activeDevice({ ...base, padPlays: false, inPlay: false }), 'pad', 'menus follow the pad even with pad play off');
});

test('tutorial wording swaps to pad prompts and never tells a pad player to press A / D or click', () => {
    for (const stage of STAGES) {
        for (const failed of [false, true]) {
            const text = tutorialText(stage, 'pad', failed);
            assert.ok(text.length > 10);
            assert.doesNotMatch(text, /A \/ D|click|mouse/i, text);
            assert.equal(tutorialText(stage, 'kbm', failed), failed ? stage.failHint : stage.hint);
        }
    }
    const rows = padControlRows({ strafeLeft: 'A0-', strafeRight: 'A0+', fire: 'B5' });
    assert.deepEqual(rows.find((r) => r.action === 'Fire').keys, ['RB'], 'the Controls panel shows the rebound button');
    assert.ok(rows.some((r) => r.action === 'Pause' && r.keys.includes('Start')));
});

test('run logs record the input device (kbm by default, pad, or mixed)', () => {
    const recorder = new RunRecorder('t:test:hard');
    assert.equal(recorder.toJSON().device, 'kbm');
    recorder.noteDevice('pad');
    assert.equal(recorder.toJSON().device, 'pad');
    recorder.noteDevice('pad');
    assert.equal(recorder.toJSON().device, 'pad');
    recorder.noteDevice('kbm');
    assert.equal(recorder.toJSON().device, 'mixed');
});

// ---------------------------------------------- aim without pointer lock ----

test('a pad-only player can turn: the look maths moves yaw and pitch with no pointer lock involved', async () => {
    const { applyLookDelta, PITCH_LIMIT } = await import('../../src/game/fps/lookMath.js');
    let view = applyLookDelta({ yaw: 0, pitch: 0 }, 0.1, -0.05, true);
    assert.ok(Math.abs(view.yaw - 0.1) < 1e-9, 'yaw follows the right stick');
    assert.ok(Math.abs(view.pitch + 0.05) < 1e-9);
    assert.deepEqual(applyLookDelta(view, 0.5, 0.5, false), view, 'paused / results / replay: look is frozen');
    view = applyLookDelta(view, 0, 9, true);
    assert.equal(view.pitch, PITCH_LIMIT, 'pitch is clamped');
    const cam = readFileSync(new URL('../../src/game/fps/FpsCamera.js', import.meta.url), 'utf8');
    const nudge = cam.slice(cam.indexOf('nudgeLook('), cam.indexOf('resetLook'));
    assert.match(nudge, /applyLookDelta\(this, yawRadians, pitchRadians, this\.lookEnabled\)/);
    assert.doesNotMatch(nudge, /locked/, 'nudgeLook is not gated on the pointer lock');
});

test('PlayScreen enables look on start without needing pointer lock', () => {
    const src = readFileSync(new URL('../../src/game/screens/PlayScreen.js', import.meta.url), 'utf8');
    assert.match(src, /camera\.lookEnabled = true;/);
    assert.doesNotMatch(src, /lookEnabled = [^;]*\blocked\b/, 'look is never gated on the lock');
});

// ------------------------------------- ranked: pad runs, unchanged server ----

test('a pad run log is validated by the unchanged server code exactly like a keyboard one', async () => {
    const { resolveChart } = await import('../../src/game/rules/charts.js');
    const { playAndRecord } = await import('../../tools/lib/scripted-player.mjs');
    const sharedValidate = (await import('../../supabase/functions/_shared/rules/validateRun.js')).validateRun;
    const level = resolveChart('t:range:hard');
    const { log, record } = playAndRecord(level, { mode: 'ranked' });
    const kbm = sharedValidate(level, { ...log, device: 'kbm' }, record.score);
    for (const device of ['pad', 'mixed']) {
        const verdict = sharedValidate(level, { ...log, device }, record.score);
        assert.deepEqual(verdict, kbm, `device:${device} changes nothing`);
    }
    assert.equal(kbm.ok, true, kbm.reason);
    const without = { ...log };
    delete without.device;
    assert.deepEqual(sharedValidate(level, without, record.score), kbm);
    const fn = readFileSync(new URL('../../supabase/functions/submit-run/index.ts', import.meta.url), 'utf8');
    assert.doesNotMatch(fn, /\.device\b/, 'the edge function never reads the device field');
});

// --------------------------------------------- d-pad is always strafe ----

test('the d-pad strafe tokens can never be bound, so a rebind cannot double-trigger them', async () => {
    const { rebindPad, sanitisePadBindings, findPadConflict, DEFAULT_PAD_BINDINGS, PAD_ACTIONS } = await import('../../src/input/padBindings.js');
    for (const token of ['B14', 'B15']) {
        for (const action of PAD_ACTIONS) {
            const r = rebindPad(DEFAULT_PAD_BINDINGS, action, token);
            assert.equal(r.ok, false);
            assert.equal(r.reason, 'conflict');
            assert.deepEqual(r.bindings, DEFAULT_PAD_BINDINGS);
        }
        assert.ok(findPadConflict(DEFAULT_PAD_BINDINGS, token), `${token} reports its owner`);
        assert.deepEqual(sanitisePadBindings({ fire: token }), DEFAULT_PAD_BINDINGS, 'a hand-edited save cannot smuggle it in');
    }
});

test('the pad focus ring does not depend on :focus-visible heuristics', () => {
    const css = readFileSync(new URL('../../src/styles/game.css', import.meta.url), 'utf8');
    assert.match(css, /body\[data-input="pad"\] :focus \{[^}]*outline:/);
});
