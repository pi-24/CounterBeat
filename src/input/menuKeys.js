/**
 * menuKeys.js - keyboard menu navigation: maps a KeyboardEvent.code to the same
 * events the gamepad sends (MenuNavigator.handle), so keyboard, mouse and pad
 * drive one set of menus.
 *
 *   W / S / Up / Down   up / down
 *   A / D / Left / Right  left / right (not while a slider or field has focus)
 *   Q / E               prev / next (difficulty on song select; LB / RB on a pad)
 *   H                   help
 *   Esc / Backspace     back
 * Enter and Space already click the focused button natively.
 */
const MAP = Object.freeze({
    KeyW: 'up', ArrowUp: 'up',
    KeyS: 'down', ArrowDown: 'down',
    KeyA: 'left', ArrowLeft: 'left',
    KeyD: 'right', ArrowRight: 'right',
    KeyQ: 'prev', KeyE: 'next',
    KeyH: 'help',
    Escape: 'back', Backspace: 'back',
});

/** @param {string} code @returns {'up'|'down'|'left'|'right'|'prev'|'next'|'help'|'back'|null} */
export function menuKeyEvent(code) {
    return MAP[code] ?? null;
}
