import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
    GamepadInput, padStrafeDirection, tokenValue, isHeld, lookAxis, PAD_NOTICE,
} from '../../src/input/GamepadInput.js';
import {
    DEFAULT_PAD_BINDINGS, PAD_BUTTON, sanitisePadBindings, rebindPad, findPadConflict, padLabel, parseToken,
} from '../../src/input/padBindings.js';
import { pickNext, MenuNavigator } from '../../src/input/menuFocus.js';
import { strafeDirection, DEFAULT_BINDINGS } from '../../src/game/input/bindings.js';
import { CounterStrafeBody } from '../../src/game/rules/CounterStrafeBody.js';
import { gradeStop } from '../../src/game/rules/rules.js';
import { MOVEMENT } from '../../src/game/rules/charts.js';
import { GAMEPAD, PAD_SETTING_DEFAULTS } from '../../src/input/gamepadConfig.js';
import { Settings } from '../../src/game/Settings.js';

/** A standard-layout pad snapshot. */
function pad({ axes = [0, 0, 0, 0], down = [], values = {} } = {}) {
    return {
        id: 'Xbox 360 Controller (STANDARD GAMEPAD)',
        connected: true,
        axes,
        buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: down.includes(i), value: values[i] ?? (down.includes(i) ? 1 : 0) })),
    };
}

/** A GamepadInput fed from a mutable current pad. */
function rig({ play = true, context = 'play', bindings = DEFAULT_PAD_BINDINGS } = {}) {
    const state = { pad: pad() };
    const input = new GamepadInput({
        getGamepads: () => [state.pad],
        getBindings: () => bindings,
        getDeadzone: () => 0.4,
        play,
        getContext: () => state.context,
    });
    state.context = context;
    const events = { nav: [], fire: 0, pause: 0, notice: [] };
    input.on('nav', (e) => events.nav.push(e));
    input.on('fire', () => { events.fire += 1; });
    input.on('pause', () => { events.pause += 1; });
    input.on('notice', (m) => events.notice.push(m));
    let now = 1000;
    const step = (next, ms = 16) => {
        if (next) state.pad = next;
        now += ms;
        input.poll(now);
        return input;
    };
    return { input, events, step, state };
}

const bindings = DEFAULT_PAD_BINDINGS;

// ----------------------------------------------------- axis -> strafe ----

test('left stick X converts to a digital strafe direction, d-pad always strafes', () => {
    const held = { left: false, right: false };
    assert.equal(padStrafeDirection(pad({ axes: [-1, 0, 0, 0] }), bindings, 0.4, held), -1);
    assert.equal(padStrafeDirection(pad({ axes: [1, 0, 0, 0] }), bindings, 0.4, held), 1);
    assert.equal(padStrafeDirection(pad(), bindings, 0.4, held), 0);
    assert.equal(padStrafeDirection(pad({ down: [PAD_BUTTON.Left] }), bindings, 0.4, held), -1);
    assert.equal(padStrafeDirection(pad({ down: [PAD_BUTTON.Right] }), bindings, 0.4, held), 1);
    // Both at once cancel, exactly like holding A and D.
    assert.equal(padStrafeDirection(pad({ axes: [-1, 0, 0, 0], down: [PAD_BUTTON.Right] }), bindings, 0.4, held), 0);
});

test('the output is digital: a half push and a full push give the same direction', () => {
    const held = { left: false, right: false };
    assert.equal(padStrafeDirection(pad({ axes: [0.45, 0, 0, 0] }), bindings, 0.4, held), 1);
    held.right = false;
    assert.equal(padStrafeDirection(pad({ axes: [1, 0, 0, 0] }), bindings, 0.4, held), 1);
});

test('deadzone: travel inside it is no input, and the setting moves the threshold', () => {
    const fresh = () => ({ left: false, right: false });
    assert.equal(padStrafeDirection(pad({ axes: [0.39, 0, 0, 0] }), bindings, 0.4, fresh()), 0);
    assert.equal(padStrafeDirection(pad({ axes: [0.41, 0, 0, 0] }), bindings, 0.4, fresh()), 1);
    assert.equal(padStrafeDirection(pad({ axes: [0.41, 0, 0, 0] }), bindings, 0.6, fresh()), 0);
    assert.equal(padStrafeDirection(pad({ axes: [-0.2, 0, 0, 0] }), bindings, 0.15, fresh()), -1);
    // Drift on the other axes never strafes.
    assert.equal(padStrafeDirection(pad({ axes: [0, 0.9, 0.9, 0.9] }), bindings, 0.4, fresh()), 0);
});

test('hysteresis: a stick resting near the edge does not chatter', () => {
    assert.equal(isHeld(0.41, 0.4, false), true);
    assert.equal(isHeld(0.35, 0.4, true), true);   // still held above 75% of the deadzone
    assert.equal(isHeld(0.35, 0.4, false), false); // but not pressed from rest
    assert.equal(isHeld(0.29, 0.4, true), false);
});

test('look axis: deadzone, rescale and sign', () => {
    assert.equal(lookAxis(0.15, GAMEPAD.lookDeadzone), 0);
    assert.equal(lookAxis(1, GAMEPAD.lookDeadzone), 1);
    assert.equal(lookAxis(-1, GAMEPAD.lookDeadzone), -1);
    assert.ok(Math.abs(lookAxis(0.5, GAMEPAD.lookDeadzone)) < 0.5);
});

test('strafe can be bound to buttons and to the other axis directions', () => {
    const held = { left: false, right: false };
    const custom = { strafeLeft: 'B4', strafeRight: 'B5', fire: 'B0' };
    assert.equal(padStrafeDirection(pad({ down: [4] }), custom, 0.4, held), -1);
    assert.equal(padStrafeDirection(pad({ down: [5] }), custom, 0.4, held), 1);
    assert.equal(tokenValue(pad({ axes: [0, -0.8, 0, 0] }), 'A1-'), 0.8);
    assert.equal(tokenValue(pad({ axes: [0, -0.8, 0, 0] }), 'A1+'), 0);
    assert.equal(tokenValue(pad({ down: [7] }), 'B7'), 1);
    assert.equal(tokenValue(pad(), 'nonsense'), 0);
});

// ---------------------------------------- counter-strafe credit parity ----

test('pad direction sequences drive the body exactly like keyboard logs (same stop grade and credit)', () => {
    // Run right, counter-strafe (flick the stick to the other side), release, run left, release-stop.
    const script = [];
    const hold = (dir, ticks) => { for (let i = 0; i < ticks; i += 1) script.push(dir); };
    hold(1, 30); hold(-1, 5); hold(0, 40); hold(-1, 25); hold(0, 20); hold(1, 12); hold(-1, 4); hold(0, 30);

    const keyboard = script.map((dir) => {
        const down = new Set(dir === 1 ? ['KeyD'] : dir === -1 ? ['KeyA'] : []);
        return strafeDirection((code) => down.has(code), DEFAULT_BINDINGS);
    });
    const held = { left: false, right: false };
    const pads = script.map((dir) => padStrafeDirection(pad({ axes: [dir, 0, 0, 0] }), bindings, 0.4, held));
    assert.deepEqual(pads, keyboard);

    const run = (directions) => {
        const body = new CounterStrafeBody(MOVEMENT, { min: -1e6, max: 1e6 }, 0);
        const out = [];
        let clock = 0;
        for (const dir of directions) {
            clock += 1000 / 120;
            body.setInput(dir);
            body.update(1 / 120, clock);
            out.push({ v: body.velocity, speed: body.speed, planted: body.isPlanted(clock), grade: gradeStop(body.speed) });
        }
        return out;
    };
    const a = run(keyboard);
    const b = run(pads);
    assert.deepEqual(b, a);
    // The script really exercises a credited counter-strafe stop.
    assert.ok(a.some((tick) => tick.planted && tick.grade === 'perfect'));
});

test('a counter-strafe flick reads as the opposite direction at once; the stick never adds speed', () => {
    const held = { left: false, right: false };
    const dirs = [1, 1, -1].map((x) => padStrafeDirection(pad({ axes: [x, 0, 0, 0] }), bindings, 0.4, held));
    assert.deepEqual(dirs, [1, 1, -1]);
    // Grading takes the body's speed only: nothing about stick travel reaches it.
    const body = new CounterStrafeBody(MOVEMENT, { min: -1e6, max: 1e6 }, 0);
    const half = new CounterStrafeBody(MOVEMENT, { min: -1e6, max: 1e6 }, 0);
    const heldA = { left: false, right: false };
    const heldB = { left: false, right: false };
    for (let i = 0; i < 40; i += 1) {
        body.setInput(padStrafeDirection(pad({ axes: [1, 0, 0, 0] }), bindings, 0.4, heldA));
        half.setInput(padStrafeDirection(pad({ axes: [0.5, 0, 0, 0] }), bindings, 0.4, heldB));
        body.update(1 / 120, i * 8);
        half.update(1 / 120, i * 8);
    }
    assert.equal(body.velocity, half.velocity);
});

// ------------------------------------------------------------ rebinding ----

test('pad rebinding to a free control works, including a stick direction', () => {
    const r = rebindPad(DEFAULT_PAD_BINDINGS, 'fire', 'B5');
    assert.ok(r.ok);
    assert.equal(r.bindings.fire, 'B5');
    assert.ok(rebindPad(DEFAULT_PAD_BINDINGS, 'strafeLeft', 'A1-').ok);
    assert.ok(rebindPad(DEFAULT_PAD_BINDINGS, 'fire', 'B7').ok); // its own control again is fine
});

test('pad rebinding onto a control used by another action is a conflict and changes nothing', () => {
    const r = rebindPad(DEFAULT_PAD_BINDINGS, 'strafeLeft', 'A0+');
    assert.ok(!r.ok);
    assert.equal(r.reason, 'conflict');
    assert.equal(r.conflict, 'strafeRight');
    assert.deepEqual(r.bindings, DEFAULT_PAD_BINDINGS);
    assert.equal(findPadConflict(DEFAULT_PAD_BINDINGS, 'B7'), 'fire');
    // The d-pad is a fixed strafe fallback, like the arrow keys.
    const dpad = rebindPad(DEFAULT_PAD_BINDINGS, 'fire', `B${PAD_BUTTON.Left}`);
    assert.equal(dpad.reason, 'conflict');
    assert.equal(dpad.conflict, 'strafeLeft');
});

test('reserved and unusable pad controls are refused', () => {
    for (const token of ['B9', 'B8', 'B16', 'B12', 'B13', 'A2+', 'A3-', 'B40', 'garbage']) {
        assert.equal(rebindPad(DEFAULT_PAD_BINDINGS, 'fire', token).reason, 'reserved', token);
    }
    assert.equal(rebindPad(DEFAULT_PAD_BINDINGS, 'nope', 'B0').reason, 'unknown-action');
});

test('corrupt or duplicate stored pad bindings fall back to defaults', () => {
    assert.deepEqual(sanitisePadBindings({ strafeLeft: 'B0', strafeRight: 'B0', fire: 'B7' }), DEFAULT_PAD_BINDINGS);
    assert.deepEqual(sanitisePadBindings(null), DEFAULT_PAD_BINDINGS);
    assert.deepEqual(sanitisePadBindings({ fire: 'B9' }), DEFAULT_PAD_BINDINGS);
    assert.deepEqual(sanitisePadBindings({ strafeLeft: 'B14' }), DEFAULT_PAD_BINDINGS);
    assert.equal(sanitisePadBindings({ fire: 'B0' }).fire, 'B0');
});

test('labels are readable', () => {
    assert.equal(padLabel('B7'), 'RT');
    assert.equal(padLabel('B0'), 'A');
    assert.equal(padLabel('A0-'), 'Left stick left');
    assert.equal(padLabel('A1+'), 'Left stick down');
    assert.deepEqual(parseToken('A0+'), { kind: 'axis', index: 0, sign: 1 });
    assert.equal(parseToken('A2+'), null);
});

test('pad bindings and deadzone persist and are validated like the keyboard set', () => {
    const data = new Map();
    const storage = { read: (k, f) => (data.has(k) ? JSON.parse(JSON.stringify(data.get(k))) : f), write: (k, v) => { data.set(k, v); return true; } };
    const settings = new Settings(storage);
    assert.deepEqual(settings.get('padBindings'), PAD_SETTING_DEFAULTS.padBindings);
    const result = rebindPad(settings.get('padBindings'), 'fire', 'B5');
    settings.update({ padBindings: result.bindings, padDeadzone: 0.55 });
    const reloaded = new Settings(storage);
    assert.equal(reloaded.get('padBindings').fire, 'B5');
    assert.equal(reloaded.get('padDeadzone'), 0.55);
    reloaded.update({ padBindings: { strafeLeft: 'B1', strafeRight: 'B1', fire: 'B9' }, padDeadzone: 99 });
    assert.deepEqual(reloaded.get('padBindings'), DEFAULT_PAD_BINDINGS);
    assert.equal(reloaded.get('padDeadzone'), 0.9);
});

// ----------------------------------------------------------- menu focus ----

const grid = [
    { id: 'a', x: 0, y: 0, w: 100, h: 40, kind: 'button' },
    { id: 'b', x: 0, y: 60, w: 100, h: 40, kind: 'button' },
    { id: 'c', x: 0, y: 120, w: 100, h: 40, kind: 'range' },
    { id: 'd', x: 200, y: 60, w: 100, h: 40, kind: 'button' },
];

test('spatial focus moves to the nearest control in the pressed direction', () => {
    assert.equal(pickNext(grid, null, 'down'), 'a');
    assert.equal(pickNext(grid, 'a', 'down'), 'b');
    assert.equal(pickNext(grid, 'b', 'down'), 'c');
    assert.equal(pickNext(grid, 'b', 'up'), 'a');
    assert.equal(pickNext(grid, 'b', 'right'), 'd');
    assert.equal(pickNext(grid, 'd', 'left'), 'b');
    assert.equal(pickNext(grid, 'a', 'up'), 'a');     // nowhere to go: stays
    assert.equal(pickNext(grid, 'gone', 'down'), 'a'); // lost focus: restarts at the top
    assert.equal(pickNext([], null, 'down'), null);
});

function fakeSurface(items, focused = null) {
    const log = [];
    const surface = {
        focused,
        log,
        items: () => items,
        focusedId: () => surface.focused,
        focus: (id) => { surface.focused = id; log.push(['focus', id]); },
        activate: (id) => log.push(['activate', id]),
        adjust: (id, step) => { log.push(['adjust', id, step]); return true; },
        back: () => { log.push(['back']); return true; },
    };
    return surface;
}

test('menu navigator: first confirm focuses, then confirm activates, back goes back', () => {
    const surface = fakeSurface(grid);
    const nav = new MenuNavigator(surface);
    nav.handle('confirm');
    assert.deepEqual(surface.log.at(-1), ['focus', 'a']);
    nav.handle('down');
    nav.handle('confirm');
    assert.deepEqual(surface.log.slice(-2), [['focus', 'b'], ['activate', 'b']]);
    assert.equal(nav.handle('back'), true);
    assert.deepEqual(surface.log.at(-1), ['back']);
});

test('menu navigator: left/right nudge a focused slider, otherwise move focus', () => {
    const surface = fakeSurface(grid, 'c');
    const nav = new MenuNavigator(surface);
    nav.handle('right');
    nav.handle('left');
    assert.deepEqual(surface.log, [['adjust', 'c', 1], ['adjust', 'c', -1]]);
    surface.focused = 'b';
    surface.log.length = 0;
    nav.handle('right');
    assert.deepEqual(surface.log, [['focus', 'd']]);
    assert.equal(new MenuNavigator(fakeSurface([])).handle('down'), false);
});

test('pad nav events from the stick and d-pad drive the navigator, with hold-to-repeat', () => {
    const { step, events } = rig({ context: 'menu' });
    step(pad({ down: [PAD_BUTTON.Down] }));
    assert.deepEqual(events.nav, ['down']);
    step(null, 100);
    assert.deepEqual(events.nav, ['down']); // before the repeat delay
    step(null, 400);
    assert.deepEqual(events.nav, ['down', 'down']);
    step(pad({ axes: [0, -0.9, 0, 0] }));
    assert.equal(events.nav.at(-1), 'up');
    step(pad());
    step(pad({ down: [PAD_BUTTON.A] }));
    step(pad({ down: [PAD_BUTTON.B] }));
    assert.deepEqual(events.nav.slice(-2), ['confirm', 'back']);
    step(pad({ down: [PAD_BUTTON.Start] }));
    assert.equal(events.pause, 1);
});

// --------------------------------------------------- GamepadInput / flag ----

test('gamepadPlay ON: strafe, fire, aim and Start-pause drive play', () => {
    const { input, events, step } = rig({ play: true });
    step(pad({ axes: [-1, 0, 0.8, -0.8] }));
    assert.equal(input.strafe, -1);
    assert.ok(input.look.x > 0 && input.look.y < 0);
    step(pad({ axes: [0, 0, 0, 0], down: [PAD_BUTTON.RT] }));
    assert.equal(input.strafe, 0);
    assert.equal(events.fire, 1);
    step(pad({ down: [PAD_BUTTON.RT] })); // held: no auto-repeat
    assert.equal(events.fire, 1);
    step(pad());
    step(pad({ down: [PAD_BUTTON.RT] }));
    assert.equal(events.fire, 2);
    step(pad({ down: [PAD_BUTTON.Start] }));
    assert.equal(events.pause, 1);
    assert.equal(events.notice.length, 0);
    assert.equal(input.playEnabled, true);
});

test('gamepadPlay OFF: no strafe, aim, fire or pause in play; one in-game notice; menus still work', () => {
    const { input, events, step, state } = rig({ play: false });
    step(pad({ axes: [1, 0, 1, 1], down: [PAD_BUTTON.RT, PAD_BUTTON.Start] }));
    step(pad({ axes: [-1, 0, 1, 1], down: [PAD_BUTTON.RT] }));
    assert.equal(input.strafe, 0);
    assert.deepEqual(input.look, { x: 0, y: 0 });
    assert.equal(events.fire, 0);
    assert.equal(events.pause, 0);
    assert.deepEqual(events.notice, [PAD_NOTICE]); // exactly once
    // Back in a menu the same pad navigates.
    state.context = 'menu';
    step(pad());
    step(pad({ down: [PAD_BUTTON.A] }));
    assert.equal(events.nav.at(-1), 'confirm');
    assert.equal(input.playEnabled, false);
});

test('the shipped flag defaults to full pad play and is a single boolean', () => {
    assert.equal(typeof GAMEPAD.gamepadPlay, 'boolean');
    assert.equal(new GamepadInput({ getGamepads: () => [] }).playEnabled, GAMEPAD.gamepadPlay);
});

test('a rebound fire button and strafe button are honoured in play', () => {
    const custom = { strafeLeft: 'B4', strafeRight: 'B5', fire: 'B0' };
    const { input, events, step } = rig({ bindings: custom });
    step(pad({ down: [4] }));
    assert.equal(input.strafe, -1);
    step(pad({ down: [0] }));
    assert.equal(events.fire, 1);
    step(pad({ axes: [1, 0, 0, 0] }));
    assert.equal(input.strafe, 0); // the stick no longer strafes once rebound away
});

test('a button already held when the pad connects is not a press; unplugging clears state', () => {
    const { input, events, step, state } = rig();
    step(pad({ down: [PAD_BUTTON.RT, PAD_BUTTON.Start] }));
    assert.equal(events.fire, 0);
    assert.equal(events.pause, 0);
    step(pad({ axes: [1, 0, 0, 0] }));
    assert.equal(input.strafe, 1);
    state.pad = null;
    step();
    assert.equal(input.connected, false);
    assert.equal(input.strafe, 0);
});

test('switching to a menu clears held play state so a stuck stick cannot strafe', () => {
    const { input, step, state } = rig();
    step(pad({ axes: [1, 0, 0, 0] }));
    assert.equal(input.strafe, 1);
    state.context = 'menu';
    step();
    assert.equal(input.strafe, 0);
});

test('rebind capture takes the next press (button or stick), swallows everything else, then releases', () => {
    const { input, events, step } = rig({ context: 'menu' });
    step(pad());
    const got = [];
    input.capture((token) => got.push(token));
    step(pad({ down: [PAD_BUTTON.A] }));
    assert.deepEqual(got, ['B0']);
    assert.equal(events.nav.length, 0); // A did not confirm anything
    step(pad());
    input.capture((token) => got.push(token));
    step(pad({ axes: [-0.9, 0, 0, 0] }));
    assert.deepEqual(got, ['B0', 'A0-']);
    // Back to normal afterwards.
    step(pad());
    step(pad({ down: [PAD_BUTTON.A] }));
    assert.equal(events.nav.at(-1), 'confirm');
    // Cancel works.
    const cancel = input.capture((token) => got.push(token));
    cancel();
    step(pad());
    step(pad({ down: [3] }));
    assert.equal(got.length, 2);
});

test('a listener that re-enters poll() cannot loop or double-fire', () => {
    const { input, events, step } = rig();
    input.on('fire', () => input.poll(99999));
    step(pad());
    step(pad({ down: [PAD_BUTTON.RT] }));
    assert.equal(events.fire, 1);
});

// --------------------------------------------------------- Steam Input ----

test('the Steam Input action manifest is well-formed and covers menu and play actions', () => {
    const text = readFileSync(new URL('../../data/steam_input_actions.vdf', import.meta.url), 'utf8')
        .split('\n').filter((line) => !line.trim().startsWith('//')).join('\n');
    assert.equal((text.match(/\{/g) ?? []).length, (text.match(/\}/g) ?? []).length);
    assert.match(text, /"In Game Actions"/);
    for (const action of ['menu_confirm', 'menu_back', 'menu_pause', 'strafe_left', 'strafe_right', 'fire', 'pause', 'aim']) {
        assert.match(text, new RegExp(`"${action}"`), action);
    }
    // Every localisation token that the actions reference exists.
    const referenced = new Set([...text.matchAll(/"#(\w+)"/g)].map((m) => m[1]));
    for (const token of referenced) {
        assert.match(text, new RegExp(`"${token}"\\s+"`), token);
    }
});
