/**
 * GamepadInput.js - an Xbox-layout gamepad (also what Steam Input presents) as
 * an input source next to the keyboard and mouse.
 *
 * It turns a polled gamepad snapshot into the same things the keyboard path
 * already produces, and nothing more:
 *   - a digital strafe direction (-1, 0, 1), exactly like `strafeDirection` in
 *     game/input/bindings.js.  The stick is digitised with a deadzone and a
 *     little hysteresis, so there is NO analog speed: the body, the recorded
 *     ticks, the counter-strafe credit and the stop grading are untouched, and
 *     a pad run replays on the server like any keyboard run.
 *   - fire presses, pause presses and (in menus) navigation events.
 *
 * In-play control sits behind the `gamepadPlay` flag (input/gamepadConfig.js).
 * With it off the pad still drives every menu, play stays mouse + keyboard, and
 * the first pad input during play raises a one-off notice.
 *
 * The Gamepad API is injected (`getGamepads`), so all of this is unit-tested.
 */
import { GAMEPAD, PAD_SETTING_DEFAULTS } from './gamepadConfig.js';
import { padEventStamp } from './inputTime.js';
import { PAD_BUTTON, PAD_FIXED_STRAFE, parseToken, sanitisePadBindings } from './padBindings.js';

/** A trigger or button counts as pressed from this travel. */
const BUTTON_THRESHOLD = 0.5;
/** Hysteresis: a stick must come back to this fraction of the deadzone to release. */
const RELEASE_RATIO = 0.75;
/** Capturing a rebind: a stick must be pushed this far to count. */
const CAPTURE_AXIS = 0.6;
/** Consecutive poll errors before the pad is given up on. */
const MAX_FAILURES = 3;

/** @param {{buttons?:Array<{pressed?:boolean, value?:number}>}} pad @param {number} index */
export function buttonDown(pad, index) {
    const button = pad.buttons?.[index];
    return Boolean(button && (button.pressed || (button.value ?? 0) >= BUTTON_THRESHOLD));
}

/**
 * How far a bound control is pushed, 0..1 (buttons are 0 or 1).
 * @param {object} pad
 * @param {string} token a padBindings token
 */
export function tokenValue(pad, token) {
    const parsed = parseToken(token);
    if (!parsed) return 0;
    if (parsed.kind === 'button') return buttonDown(pad, parsed.index) ? 1 : 0;
    const raw = pad.axes?.[parsed.index];
    const value = Number.isFinite(raw) ? raw : 0;
    return Math.max(0, Math.min(1, value * parsed.sign));
}

/**
 * Digital state of an analog value with hysteresis: it presses at `deadzone`
 * and releases once it falls back under 75% of it, so a stick resting near the
 * edge does not chatter.
 * @param {number} value 0..1
 * @param {number} deadzone
 * @param {boolean} wasHeld
 */
export function isHeld(value, deadzone, wasHeld) {
    return wasHeld ? value >= deadzone * RELEASE_RATIO : value >= deadzone;
}

/**
 * Axis -> digital strafe direction: -1 left, 1 right, 0 none or both.  The
 * d-pad strafes too, always.  `held` carries the hysteresis state between polls.
 * @param {object} pad
 * @param {{strafeLeft:string, strafeRight:string}} bindings pad bindings
 * @param {number} deadzone
 * @param {{left:boolean, right:boolean}} held mutated
 * @returns {-1|0|1}
 */
export function padStrafeDirection(pad, bindings, deadzone, held) {
    const dpad = { left: false, right: false };
    for (const [token, action] of Object.entries(PAD_FIXED_STRAFE)) {
        if (tokenValue(pad, token) > 0) dpad[action === 'strafeLeft' ? 'left' : 'right'] = true;
    }
    held.left = isHeld(tokenValue(pad, bindings.strafeLeft), deadzone, held.left);
    held.right = isHeld(tokenValue(pad, bindings.strafeRight), deadzone, held.right);
    const left = held.left || dpad.left;
    const right = held.right || dpad.right;
    return /** @type {-1|0|1} */ ((right ? 1 : 0) - (left ? 1 : 0));
}

/**
 * @param {number} value
 * @param {number} deadzone
 * @param {number} [curve] response exponent: 1 linear, 2 quadratic (fine aim near the centre)
 * @returns {number} -1..1, 0 inside the deadzone, rescaled and eased
 */
export function lookAxis(value, deadzone, curve = 2) {
    const magnitude = Math.abs(Number.isFinite(value) ? value : 0);
    if (magnitude <= deadzone) return 0;
    const scaled = Math.min(1, (magnitude - deadzone) / (1 - deadzone));
    const exponent = Number.isFinite(curve) && curve >= 1 ? curve : 2;
    return Math.sign(value) * scaled ** exponent;
}

/** Which menu direction the pad is holding, or null.  D-pad wins over the stick. */
function navDirection(pad, menuDeadzone) {
    if (buttonDown(pad, PAD_BUTTON.Up)) return 'up';
    if (buttonDown(pad, PAD_BUTTON.Down)) return 'down';
    if (buttonDown(pad, PAD_BUTTON.Left)) return 'left';
    if (buttonDown(pad, PAD_BUTTON.Right)) return 'right';
    const x = pad.axes?.[0] ?? 0;
    const y = pad.axes?.[1] ?? 0;
    if (Math.max(Math.abs(x), Math.abs(y)) < menuDeadzone) return null;
    if (Math.abs(x) >= Math.abs(y)) return x > 0 ? 'right' : 'left';
    return y > 0 ? 'down' : 'up';
}

/** The browser's pads; an empty list where the API is missing or blocked (insecure origin, policy). */
function defaultGetGamepads() {
    try {
        return typeof navigator !== 'undefined' && navigator.getGamepads ? Array.from(navigator.getGamepads()) : [];
    } catch (error) {
        return [];
    }
}

export const PAD_NOTICE = 'Gamepad play is switched off in this build: the pad works in the menus, play uses mouse and keyboard.';

export class GamepadInput {
    /**
     * @param {object} [options]
     * @param {() => Array<object|null>} [options.getGamepads]
     * @param {() => object} [options.getBindings] current pad bindings
     * @param {() => number} [options.getDeadzone] current strafe deadzone
     * @param {() => number} [options.getLookCurve] current right-stick response exponent
     * @param {() => number} [options.getLatencyMs] pad latency compensation, wound back off every shot
     * @param {() => number} [options.now] the clock `pad.timestamp` is on (performance.now)
     * @param {boolean} [options.play] the `gamepadPlay` flag
     * @param {() => 'menu'|'play'} [options.getContext] which context applies right now
     */
    constructor(options = {}) {
        this.getGamepads = options.getGamepads ?? defaultGetGamepads;
        this.getBindings = options.getBindings ?? (() => PAD_SETTING_DEFAULTS.padBindings);
        this.getDeadzone = options.getDeadzone ?? (() => PAD_SETTING_DEFAULTS.padDeadzone);
        this.getLookCurve = options.getLookCurve ?? (() => PAD_SETTING_DEFAULTS.padLookCurve);
        this.getLatencyMs = options.getLatencyMs ?? (() => PAD_SETTING_DEFAULTS.padLatencyMs);
        this.now = options.now ?? (() => (typeof performance !== 'undefined' ? performance.now() : 0));
        this.play = options.play ?? GAMEPAD.gamepadPlay;
        /** @type {(() => 'menu'|'play')|null} asked before every poll which context applies */
        this.getContext = options.getContext ?? null;

        /** @type {'menu'|'play'} */
        this.context = 'menu';
        this.connected = false;
        this.padId = '';
        this.strafe = 0;
        this.look = { x: 0, y: 0 };
        this.lastActiveAt = Number.NEGATIVE_INFINITY;

        this.held = { left: false, right: false };
        this.fireHeld = false;
        this.fireArmed = false;
        this.prevPressed = [];
        this.prevAxisOver = {};
        this.nav = { dir: null, since: 0, last: 0 };
        this.noticed = false;
        this.captureCallback = null;
        this.listeners = { nav: new Set(), fire: new Set(), tap: new Set(), pause: new Set(), notice: new Set(), connect: new Set() };
        this.rafId = 0;
        this.polling = false;
        this.failures = 0;
        this.disabled = false;
    }

    /** @returns {boolean} whether the pad drives play in this build. */
    get playEnabled() {
        return this.play;
    }

    /** @param {'menu'|'play'} context menus take navigation, play takes strafe/aim/fire */
    setContext(context) {
        if (context === this.context) return;
        this.context = context;
        this.resetPlayState();
        this.nav.dir = null;
    }

    resetPlayState() {
        this.held.left = false;
        this.held.right = false;
        this.fireHeld = false;
        // A trigger already down when play (or the pad) begins is not a shot:
        // fire stays disarmed until it has been released once.
        this.fireArmed = false;
        this.strafe = 0;
        this.look = { x: 0, y: 0 };
    }

    /**
     * `fire` and `tap` carry `{timeStamp}`, the instant of the press on the
     * performance.now() clock (from `pad.timestamp`), for input-lag compensation.
     * @param {'nav'|'fire'|'tap'|'pause'|'notice'|'connect'} type
     * @param {(arg?:any) => void} listener
     * @returns {() => void} unsubscribe
     */
    on(type, listener) {
        this.listeners[type].add(listener);
        return () => this.listeners[type].delete(listener);
    }

    emit(type, arg) {
        for (const listener of this.listeners[type]) listener(arg);
    }

    /** @returns {boolean} whether the pad was touched in the last `ms`. */
    recentlyActive(nowMs, ms = 1500) {
        return nowMs - this.lastActiveAt <= ms;
    }

    /**
     * Waits for the next control the player presses and hands back its token
     * (or 'B9' for Start, which the UI treats as cancel).  While capturing,
     * nothing else the pad does has any effect.
     * @param {(token:string) => void} callback
     * @returns {() => void} cancel
     */
    capture(callback) {
        this.captureCallback = callback;
        return () => {
            if (this.captureCallback === callback) this.captureCallback = null;
        };
    }

    /** @param {number} [nowMs] call once per frame */
    poll(nowMs = performance.now()) {
        if (this.polling || this.disabled) return; // a listener must not re-enter the poll
        this.polling = true;
        try {
            this.pollOnce(nowMs);
            this.failures = 0;
        } catch (error) {
            // A malformed pad must not spam the console every frame: warn, and
            // give the pad up after a few failures in a row.
            this.failures += 1;
            if (this.failures === 1) console.warn('GamepadInput: poll failed', error);
            if (this.failures >= MAX_FAILURES) {
                console.warn('GamepadInput: giving up on the gamepad after repeated errors');
                this.stop();
                this.disabled = true;
            }
        } finally {
            this.polling = false;
        }
    }

    pollOnce(nowMs) {
        if (this.getContext) this.setContext(this.getContext());
        const pad = this.getGamepads().find((candidate) => candidate && candidate.connected !== false) ?? null;
        if (!pad) {
            if (this.connected) {
                this.connected = false;
                this.padId = '';
                this.resetPlayState();
                this.prevPressed = [];
                this.emit('connect', { connected: false, id: '' });
            }
            return;
        }
        const pressed = Array.from({ length: pad.buttons?.length ?? 0 }, (_, i) => buttonDown(pad, i));
        if (!this.connected) {
            this.connected = true;
            this.padId = pad.id ?? '';
            // A button already down at connect time is not a press.
            this.prevPressed = pressed.slice();
            this.prevAxisOver = {};
            this.emit('connect', { connected: true, id: this.padId });
        }
        const edge = (index) => pressed[index] && !this.prevPressed[index];
        const anyEdge = pressed.some((_, i) => edge(i));
        const anyStick = [0, 1, 2, 3].some((i) => Math.abs(pad.axes?.[i] ?? 0) >= GAMEPAD.menuDeadzone);
        if (anyEdge || anyStick) this.lastActiveAt = nowMs;

        if (this.captureCallback) {
            this.pollCapture(pad, pressed);
        } else if (this.context === 'menu') {
            this.pollMenu(pad, edge, nowMs);
        } else if (this.play) {
            this.pollPlay(pad, edge, nowMs);
        } else if ((anyEdge || anyStick) && !this.noticed) {
            this.noticed = true;
            this.emit('notice', PAD_NOTICE);
        }
        this.prevPressed = pressed;
    }

    pollCapture(pad, pressed) {
        let token = null;
        for (let i = 0; i < pressed.length && token === null; i += 1) {
            if (pressed[i] && !this.prevPressed[i]) token = `B${i}`;
        }
        for (const axis of [0, 1]) {
            const value = pad.axes?.[axis] ?? 0;
            const sign = value >= 0 ? '+' : '-';
            const key = `${axis}${sign}`;
            const over = Math.abs(value) >= CAPTURE_AXIS;
            if (token === null && over && !this.prevAxisOver[key]) token = `A${axis}${sign}`;
            this.prevAxisOver[key] = over;
            this.prevAxisOver[`${axis}${sign === '+' ? '-' : '+'}`] = false;
        }
        if (token !== null) {
            const callback = this.captureCallback;
            this.captureCallback = null;
            callback(token);
        }
    }

    pollMenu(pad, edge, nowMs) {
        if (edge(PAD_BUTTON.A)) {
            this.emit('tap', { timeStamp: padEventStamp(pad, this.now(), this.getLatencyMs()) });
            this.emit('nav', 'confirm');
        }
        if (edge(PAD_BUTTON.B)) this.emit('nav', 'back');
        if (edge(PAD_BUTTON.Start)) this.emit('pause');
        const dir = navDirection(pad, GAMEPAD.menuDeadzone);
        if (dir !== this.nav.dir) {
            this.nav = { dir, since: nowMs, last: nowMs };
            if (dir) this.emit('nav', dir);
        } else if (dir && nowMs - this.nav.since >= GAMEPAD.menuRepeatDelayMs && nowMs - this.nav.last >= GAMEPAD.menuRepeatMs) {
            this.nav.last = nowMs;
            this.emit('nav', dir);
        }
    }

    pollPlay(pad, edge) {
        const bindings = sanitisePadBindings(this.getBindings());
        if (edge(PAD_BUTTON.Start)) this.emit('pause');
        this.strafe = padStrafeDirection(pad, bindings, this.getDeadzone(), this.held);
        const fire = tokenValue(pad, bindings.fire) >= BUTTON_THRESHOLD;
        if (!fire) this.fireArmed = true;
        const pressedNow = fire && !this.fireHeld && this.fireArmed;
        this.fireHeld = fire;
        if (pressedNow) this.emit('fire', { timeStamp: padEventStamp(pad, this.now(), this.getLatencyMs()) });
        const curve = this.getLookCurve();
        this.look = {
            x: lookAxis(pad.axes?.[2] ?? 0, GAMEPAD.lookDeadzone, curve),
            y: lookAxis(pad.axes?.[3] ?? 0, GAMEPAD.lookDeadzone, curve),
        };
    }

    /** Polls every animation frame; for the menus, which run before the 3D loop exists. */
    start() {
        if (this.rafId || this.disabled || typeof requestAnimationFrame !== 'function') return;
        const loop = (time) => {
            this.poll(time);
            this.rafId = requestAnimationFrame(loop);
        };
        this.rafId = requestAnimationFrame(loop);
    }

    stop() {
        if (this.rafId && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(this.rafId);
        this.rafId = 0;
    }
}
