/**
 * prompts.js - which input device the player is using right now, and the
 * on-screen wording for it, so a pad-only player is never told to press A / D
 * or click.  Pure; GameApp feeds it the activity clocks and puts the result on
 * `<body data-input>` and into the tutorial panel.
 */
import { PAD_ACTION_LABELS, padLabel } from './padBindings.js';

/**
 * @param {{padConnected:boolean, padActiveAt:number, kbMouseAt:number, padPlays:boolean, inPlay:boolean}} state
 *   `padPlays` is the gamepadPlay flag; `inPlay` whether a live run is on screen.
 *   In play with the flag off the pad does nothing, so the prompts stay keyboard.
 * @returns {'pad'|'kbm'}
 */
export function activeDevice({ padConnected, padActiveAt, kbMouseAt, padPlays, inPlay }) {
    if (!padConnected) return 'kbm';
    if (inPlay && !padPlays) return 'kbm';
    return padActiveAt > kbMouseAt ? 'pad' : 'kbm';
}

/** Pad wording for the tutorial stages, keyed by stage id (no binding names: they can be rebound). */
export const PAD_TUTORIAL = Object.freeze({
    stop: {
        hint: 'Strafe with the left stick or d-pad, then push the other way to counter-strafe. Get the arc green (20 u/s or less)',
        failHint: 'Too fast. Push the opposite way and let go; stop inside the green zone',
    },
    time: {
        hint: 'Stop, then press Fire as the ring closes on the bot. Perfect or Good timing counts',
        failHint: 'Off the beat. Wait for the ring to close',
    },
    aim: {
        hint: 'Stop, aim with the right stick and press Fire on the beat. Hits count',
        failHint: 'Missed. Aim at the bot before the ring closes',
    },
});

/**
 * @param {{id:string, hint:string, failHint:string}} stage
 * @param {'pad'|'kbm'} device
 * @param {boolean} failed
 */
export function tutorialText(stage, device, failed) {
    const pad = device === 'pad' ? PAD_TUTORIAL[stage.id] : null;
    const source = pad ?? stage;
    return failed ? source.failHint : source.hint;
}

/**
 * The pad rows of the Controls panel.
 * @param {{strafeLeft:string, strafeRight:string, fire:string}} bindings
 * @returns {Array<{action:string, keys:string[]}>}
 */
export function padControlRows(bindings) {
    return [
        { action: 'Strafe left', keys: [padLabel(bindings.strafeLeft), 'D-pad ←'] },
        { action: 'Strafe right', keys: [padLabel(bindings.strafeRight), 'D-pad →'] },
        { action: 'Aim', keys: ['Right stick'] },
        { action: PAD_ACTION_LABELS.fire, keys: [padLabel(bindings.fire)] },
        { action: 'Pause', keys: ['Start'] },
        { action: 'Menus', keys: ['A select', 'B back'] },
    ];
}
