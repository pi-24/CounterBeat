/**
 * gamepadConfig.js - gamepad tuning and the one build-time feature flag.
 *
 * Kept out of game/rules/config.js on purpose: that file is mirrored into the
 * ranked-score edge function, and nothing here may ever affect scoring.
 */
import { DEFAULT_PAD_BINDINGS } from './padBindings.js';

/**
 * `gamepadPlay` is the single switch the creator asked for.
 *   true  - the pad strafes, aims and fires in play, and drives the menus.
 *   false - menus only: play stays mouse + keyboard and the game says so.
 * Flip it if the pad playtest (M8) shows the pad feel is wrong.
 */
export const GAMEPAD = Object.freeze({
    gamepadPlay: true,
    lookSpeedYaw: 200,      // degrees per second at full right-stick deflection, at padLookSpeed 1
    lookSpeedPitch: 120,
    lookDeadzone: 0.2,
    menuDeadzone: 0.5,      // stick travel that moves menu focus
    menuRepeatDelayMs: 380, // hold a direction: first repeat after this ...
    menuRepeatMs: 120,      // ... then this often
});

/** Gamepad entries of the persisted settings (merged into the defaults by Settings.js). */
export const PAD_SETTING_DEFAULTS = Object.freeze({
    padBindings: DEFAULT_PAD_BINDINGS, // stick X / button index, see padBindings.js
    padDeadzone: 0.4,                  // stick travel (0..1) that counts as a strafe press
    padLookSpeed: 1,                   // right-stick look speed multiplier (the pad's "sensitivity")
    padLookCurve: 1.5,                 // right-stick response exponent: 1 linear, 2 eased for fine aim
    padLatencyMs: 0,                   // extra pad input latency wound back off every pad shot
});

/** Ranges the Settings UI offers and Settings.sanitise enforces. */
export const PAD_RANGES = Object.freeze({
    padDeadzone: Object.freeze({ min: 0.15, max: 0.9, step: 0.05 }),
    padLookSpeed: Object.freeze({ min: 0.4, max: 3, step: 0.1 }),
    padLookCurve: Object.freeze({ min: 1, max: 2, step: 0.25 }),
    padLatencyMs: Object.freeze({ min: 0, max: 60, step: 1 }),
});

/** @returns {object} fresh pad defaults: nothing shared, so callers may mutate. */
export function padSettingDefaults() {
    return { ...PAD_SETTING_DEFAULTS, padBindings: { ...PAD_SETTING_DEFAULTS.padBindings } };
}
