/**
 * padBindings.js - rebindable gamepad controls (strafe left, strafe right,
 * fire) and the same conflict rules the keyboard bindings use.  Pure logic:
 * no DOM and no Gamepad API, so it is unit-tested.
 *
 * A binding is a short token for the standard (Xbox) layout, which is also
 * what Steam Input presents:
 *   - `B<n>`   button n  (B0 = A, B7 = right trigger, ...)
 *   - `A<n>+`  axis n pushed positive  (A0+ = left stick right)
 *   - `A<n>-`  axis n pushed negative  (A0- = left stick left)
 * Only the left stick's axes (0, 1) can be bound: the right stick aims.
 */
export const PAD_ACTIONS = Object.freeze(['strafeLeft', 'strafeRight', 'fire']);

export const PAD_ACTION_LABELS = Object.freeze({
    strafeLeft: 'Strafe left',
    strafeRight: 'Strafe right',
    fire: 'Fire',
});

export const DEFAULT_PAD_BINDINGS = Object.freeze({
    strafeLeft: 'A0-',
    strafeRight: 'A0+',
    fire: 'B7',
});

/** Standard-mapping button indices. */
export const PAD_BUTTON = Object.freeze({
    A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7,
    View: 8, Start: 9, L3: 10, R3: 11, Up: 12, Down: 13, Left: 14, Right: 15, Guide: 16,
});

const BUTTON_NAMES = Object.freeze(Object.fromEntries(Object.entries(PAD_BUTTON).map(([name, i]) => [i, name])));

/** Buttons that can never be bound: they pause, open the platform overlay or back out. */
export const PAD_RESERVED = Object.freeze([`B${PAD_BUTTON.Start}`, `B${PAD_BUTTON.View}`, `B${PAD_BUTTON.Guide}`]);

/** The d-pad always strafes, like the arrow keys: a rebind can never lock the player out. */
export const PAD_FIXED_STRAFE = Object.freeze({
    [`B${PAD_BUTTON.Left}`]: 'strafeLeft',
    [`B${PAD_BUTTON.Right}`]: 'strafeRight',
});

/** Up/Down on the d-pad only ever navigate. */
const PAD_NAV_ONLY = Object.freeze([`B${PAD_BUTTON.Up}`, `B${PAD_BUTTON.Down}`]);

const TOKEN = /^(?:B(\d{1,2})|A([01])([+-]))$/;

/** @param {unknown} token @returns {{kind:'button', index:number}|{kind:'axis', index:number, sign:1|-1}|null} */
export function parseToken(token) {
    const match = typeof token === 'string' ? TOKEN.exec(token) : null;
    if (!match) return null;
    if (match[1] !== undefined) {
        const index = Number(match[1]);
        return index <= PAD_BUTTON.Guide ? { kind: 'button', index } : null;
    }
    return { kind: 'axis', index: Number(match[2]), sign: match[3] === '+' ? 1 : -1 };
}

/** @param {string} token @returns {string} a short name for the UI */
export function padLabel(token) {
    const parsed = parseToken(token);
    if (!parsed) return String(token);
    if (parsed.kind === 'button') {
        const name = BUTTON_NAMES[parsed.index];
        return name ?? `Button ${parsed.index}`;
    }
    const way = parsed.index === 0 ? (parsed.sign > 0 ? 'right' : 'left') : (parsed.sign > 0 ? 'down' : 'up');
    return `Left stick ${way}`;
}

/** @param {string} token @returns {boolean} whether a token may be bound by the player */
function bindable(token) {
    return parseToken(token) !== null && !PAD_RESERVED.includes(token) && !PAD_NAV_ONLY.includes(token);
}

/** @param {unknown} value @returns {{strafeLeft:string, strafeRight:string, fire:string}} always valid and conflict-free */
export function sanitisePadBindings(value) {
    const out = { ...DEFAULT_PAD_BINDINGS };
    if (value && typeof value === 'object') {
        for (const action of PAD_ACTIONS) {
            const token = value[action];
            if (typeof token === 'string' && bindable(token) && !PAD_FIXED_STRAFE[token]) {
                out[action] = token;
            }
        }
    }
    if (new Set(PAD_ACTIONS.map((a) => out[a])).size !== PAD_ACTIONS.length) {
        return { ...DEFAULT_PAD_BINDINGS };
    }
    return out;
}

/** @param {object} bindings @param {string} token @returns {string|null} the action already using it */
export function findPadConflict(bindings, token) {
    if (PAD_FIXED_STRAFE[token]) return PAD_FIXED_STRAFE[token];
    return PAD_ACTIONS.find((action) => bindings[action] === token) ?? null;
}

/**
 * Tries to bind `token` to `action`.  A control already used by another action
 * is refused, never silently swapped (same rule as the keyboard).
 * @returns {{ok:boolean, bindings:object, reason?:string, conflict?:string}}
 */
export function rebindPad(bindings, action, token) {
    const current = sanitisePadBindings(bindings);
    if (!PAD_ACTIONS.includes(action)) return { ok: false, reason: 'unknown-action', bindings: current };
    if (!bindable(token)) return { ok: false, reason: 'reserved', bindings: current };
    const conflict = findPadConflict(current, token);
    if (conflict && conflict !== action) return { ok: false, reason: 'conflict', conflict, bindings: current };
    if (PAD_FIXED_STRAFE[token]) return { ok: false, reason: 'conflict', conflict: PAD_FIXED_STRAFE[token], bindings: current };
    return { ok: true, bindings: { ...current, [action]: token } };
}
