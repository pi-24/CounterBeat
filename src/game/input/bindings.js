/**
 * bindings.js - rebindable keys (strafe left, strafe right, fire) and the
 * conflict rules.  Pure logic: no DOM, so it is unit-tested.
 */
export const BINDING_ACTIONS = Object.freeze(['strafeLeft', 'strafeRight', 'fire']);

export const BINDING_LABELS = Object.freeze({
    strafeLeft: 'Strafe left',
    strafeRight: 'Strafe right',
    fire: 'Fire (keyboard)',
});

export const DEFAULT_BINDINGS = Object.freeze({
    strafeLeft: 'KeyA',
    strafeRight: 'KeyD',
    fire: 'Space',
});

/** Keys that can never be bound: they pause, leave or toggle the game. */
export const RESERVED_KEYS = Object.freeze(['Escape', 'F11', 'Tab', 'Enter']);

/** @param {string} code a KeyboardEvent.code @returns {string} short, readable key name */
export function keyLabel(code) {
    if (/^Key[A-Z]$/.test(code)) return code.slice(3);
    if (/^Digit\d$/.test(code)) return code.slice(5);
    if (code.startsWith('Arrow')) return code.slice(5);
    return code.replace(/(Left|Right)$/, ' $1').replace(/^Numpad/, 'Num ');
}

/** Hard-wired fallback strafe keys: they count as already bound. */
export const ARROW_STRAFE = Object.freeze({ ArrowLeft: 'strafeLeft', ArrowRight: 'strafeRight' });

/** @param {unknown} value @returns {{strafeLeft:string, strafeRight:string, fire:string}} always a valid, conflict-free set */
export function sanitiseBindings(value) {
    const out = { ...DEFAULT_BINDINGS };
    if (value && typeof value === 'object') {
        for (const action of BINDING_ACTIONS) {
            const code = value[action];
            if (typeof code === 'string' && /^[A-Za-z0-9]{1,24}$/.test(code) && !RESERVED_KEYS.includes(code) && !ARROW_STRAFE[code]) {
                out[action] = code;
            }
        }
    }
    // A stored set with duplicates is corrupt: fall back to defaults.
    if (new Set(BINDING_ACTIONS.map((a) => out[a])).size !== BINDING_ACTIONS.length) {
        return { ...DEFAULT_BINDINGS };
    }
    return out;
}

/** @param {object} bindings @param {string} code @returns {string|null} the action already using that key */
export function findConflict(bindings, code) {
    // The arrow keys always strafe (fallback in strafeDirection), so they are taken.
    if (ARROW_STRAFE[code]) return ARROW_STRAFE[code];
    return BINDING_ACTIONS.find((action) => bindings[action] === code) ?? null;
}

/**
 * Tries to bind `code` to `action`.  A key already used by another action is
 * refused (never silently swapped), so the player sees what clashed.
 * @returns {{ok:boolean, bindings:object, reason?:string, conflict?:string}}
 */
export function rebind(bindings, action, code) {
    const current = sanitiseBindings(bindings);
    if (!BINDING_ACTIONS.includes(action)) return { ok: false, reason: 'unknown-action', bindings: current };
    if (RESERVED_KEYS.includes(code)) return { ok: false, reason: 'reserved', bindings: current };
    if (ARROW_STRAFE[code]) return { ok: false, reason: 'conflict', conflict: ARROW_STRAFE[code], bindings: current };
    const conflict = findConflict(current, code);
    if (conflict && conflict !== action) return { ok: false, reason: 'conflict', conflict, bindings: current };
    return { ok: true, bindings: { ...current, [action]: code } };
}

/**
 * The direction (-1, 0, 1) for the strafe keys held.  Arrow keys always work
 * as a second set so a rebind can never lock the player out.
 * @param {(code:string) => boolean} isDown
 * @param {{strafeLeft:string, strafeRight:string}} bindings
 */
export function strafeDirection(isDown, bindings) {
    const left = isDown(bindings.strafeLeft) || isDown('ArrowLeft');
    const right = isDown(bindings.strafeRight) || isDown('ArrowRight');
    return (right ? 1 : 0) + (left ? -1 : 0);
}
