/**
 * Settings.js (ui) - the controls the game menu adds to the settings form:
 * separate music / SFX / hit-sound volumes, the judgement palette (with an
 * icon per grade), reduced flash, the on-screen beat cue, key rebinding with
 * conflict detection, re-runnable calibration and the tutorial replay.
 * Everything writes straight through to the persisted Settings store.
 */
import { el } from './format.js';
import {
    BINDING_ACTIONS, BINDING_LABELS, DEFAULT_BINDINGS, rebind, keyLabel,
} from '../game/input/bindings.js';
import {
    PAD_ACTIONS, PAD_ACTION_LABELS, DEFAULT_PAD_BINDINGS, rebindPad, padLabel, PAD_RESERVED,
} from '../input/padBindings.js';
import { PAD_NOTICE } from '../input/GamepadInput.js';
import { PAD_RANGES, PAD_SETTING_DEFAULTS } from '../input/gamepadConfig.js';
import { PALETTES, PALETTE_IDS, GRADE_ICONS } from '../game/feel/judgementPalette.js';

export const VOLUME_FIELDS = Object.freeze([
    { name: 'musicVolume', label: 'Music volume' },
    { name: 'sfxVolume', label: 'SFX volume' },
    { name: 'hitVolume', label: 'Hit-sound volume' },
]);

export const TOGGLE_FIELDS = Object.freeze([
    { name: 'reducedFlash', label: 'Reduced flash (no flashes; hit marker stays, steady)' },
    { name: 'beatCue', label: 'On-screen beat cue' },
]);

export const PALETTE_LABELS = Object.freeze({ default: 'Editorial (default)', safe: 'Colour-blind safe (high contrast)' });

/** The pad's sliders: strafe deadzone, look sensitivity and response, and shot latency compensation. */
export const PAD_SLIDERS = Object.freeze([
    { name: 'padDeadzone', label: 'Stick deadzone', format: (v) => v.toFixed(2) },
    { name: 'padLookSpeed', label: 'Look sensitivity', format: (v) => `${v.toFixed(1)}x` },
    { name: 'padLookCurve', label: 'Look response (1 linear, 2 eased)', format: (v) => v.toFixed(2) },
    { name: 'padLatencyMs', label: 'Pad input latency', format: (v) => `${Math.round(v)} ms` },
]);

const GRADES = Object.freeze(['perfect', 'good', 'ok', 'miss']);
const GRADE_NAMES = Object.freeze({ perfect: 'Perfect', good: 'Good', ok: 'Loose', miss: 'Miss' });

/**
 * @param {HTMLElement} host a container inside the settings form
 * @param {import('../game/Settings.js').Settings} settings
 * @param {{onCalibrate?:() => void, onTutorial?:() => void, gamepad?:import('../input/GamepadInput.js').GamepadInput}} [handlers]
 * @returns {{refresh:() => void}}
 */
export function mountGameSettings(host, settings, handlers = {}) {
    host.replaceChildren();
    const refreshers = [];

    // Audio ------------------------------------------------------------
    const audio = el('fieldset', 'settings__group');
    audio.append(el('legend', 'settings__legend', 'Volume'));
    for (const field of VOLUME_FIELDS) {
        const row = el('div', 'settings__row');
        const label = el('label', 'settings__label', field.label);
        const input = document.createElement('input');
        input.type = 'range';
        input.className = 'settings__range';
        input.name = field.name;
        input.min = '0';
        input.max = '1';
        input.step = '0.05';
        input.id = `set-${field.name}`;
        label.htmlFor = input.id;
        input.addEventListener('input', () => settings.update({ [field.name]: Number(input.value) }));
        row.append(label, input);
        audio.append(row);
        refreshers.push(() => { input.value = String(settings.get(field.name)); });
    }

    // Accessibility ----------------------------------------------------
    const access = el('fieldset', 'settings__group');
    access.append(el('legend', 'settings__legend', 'Accessibility'));
    const paletteRow = el('div', 'settings__row');
    const paletteLabel = el('label', 'settings__label', 'Judgement palette');
    const select = document.createElement('select');
    select.className = 'settings__select';
    select.name = 'judgementPalette';
    select.id = 'set-judgementPalette';
    paletteLabel.htmlFor = select.id;
    for (const id of PALETTE_IDS) {
        const option = document.createElement('option');
        option.value = id;
        option.textContent = PALETTE_LABELS[id] ?? id;
        select.append(option);
    }
    select.addEventListener('change', () => settings.update({ judgementPalette: select.value }));
    const legend = el('span', 'palette-legend');
    paletteRow.append(paletteLabel, select, legend);
    access.append(paletteRow);
    refreshers.push(() => {
        select.value = settings.get('judgementPalette');
        const colours = PALETTES[settings.get('judgementPalette')] ?? PALETTES.default;
        legend.replaceChildren(...GRADES.map((grade) => {
            const chip = el('span', 'palette-legend__chip', `${GRADE_ICONS[grade]} ${GRADE_NAMES[grade]}`);
            chip.style.color = colours[grade];
            return chip;
        }));
    });
    for (const field of TOGGLE_FIELDS) {
        const label = el('label', 'settings__check');
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.name = field.name;
        input.addEventListener('change', () => settings.update({ [field.name]: input.checked }));
        label.append(input, ` ${field.label}`);
        access.append(label);
        refreshers.push(() => { input.checked = Boolean(settings.get(field.name)); });
    }

    // Controls ---------------------------------------------------------
    const controls = el('fieldset', 'settings__group');
    controls.append(el('legend', 'settings__legend', 'Controls'));
    const message = el('p', 'settings__note', 'Click a key, then press the new one. Arrow keys always strafe too.');
    message.setAttribute('role', 'status');
    for (const action of BINDING_ACTIONS) {
        const row = el('div', 'settings__row');
        const button = el('button', 'btn btn--ghost btn--small mono');
        button.type = 'button';
        button.dataset.binding = action;
        button.addEventListener('click', () => capture(action, button));
        row.append(el('span', 'settings__label', BINDING_LABELS[action]), button);
        controls.append(row);
        refreshers.push(() => { button.textContent = keyLabel(settings.get('bindings')[action]); });
    }
    const reset = el('button', 'btn btn--ghost btn--small', 'Reset keys');
    reset.type = 'button';
    reset.addEventListener('click', () => {
        settings.update({ bindings: { ...DEFAULT_BINDINGS } });
        message.textContent = 'Keys reset to A / D / Space.';
    });
    controls.append(reset, message);

    function capture(action, button) {
        button.textContent = 'press a key…';
        const finish = (event) => {
            event.preventDefault();
            event.stopImmediatePropagation();
            window.removeEventListener('keydown', finish, true);
            if (event.code === 'Escape') {
                message.textContent = 'Rebind cancelled.';
            } else {
                const result = rebind(settings.get('bindings'), action, event.code);
                if (result.ok) {
                    settings.update({ bindings: result.bindings });
                    message.textContent = `${BINDING_LABELS[action]} is now ${keyLabel(event.code)}.`;
                } else if (result.reason === 'conflict') {
                    message.textContent = `${keyLabel(event.code)} is already used for ${BINDING_LABELS[result.conflict]}. Pick another key.`;
                } else {
                    message.textContent = `${keyLabel(event.code)} cannot be used.`;
                }
            }
            refresh();
        };
        window.addEventListener('keydown', finish, true);
    }

    // Gamepad ----------------------------------------------------------
    const pad = handlers.gamepad ? mountPadControls(handlers.gamepad, settings, refreshers) : null;

    // Onboarding -------------------------------------------------------
    const onboarding = el('fieldset', 'settings__group');
    onboarding.append(el('legend', 'settings__legend', 'Setup'));
    const calibrate = el('button', 'btn btn--ghost', 'Re-run calibration');
    calibrate.type = 'button';
    calibrate.dataset.action = 'calibrate-auto';
    calibrate.addEventListener('click', () => handlers.onCalibrate?.());
    const tutorial = el('button', 'btn btn--ghost', 'Replay tutorial');
    tutorial.type = 'button';
    tutorial.dataset.action = 'replay-tutorial';
    tutorial.addEventListener('click', () => handlers.onTutorial?.());
    onboarding.append(calibrate, tutorial);

    host.append(audio, access, controls, ...(pad ? [pad] : []), onboarding);

    function refresh() {
        for (const fn of refreshers) fn();
    }
    settings.onChange(refresh);
    refresh();
    return { refresh };
}

/**
 * The gamepad group: the strafe deadzone, pad rebinding (same conflict rules as
 * the keyboard) and, when the `gamepadPlay` flag is off, the notice that play
 * stays mouse + keyboard.
 * @param {import('../input/GamepadInput.js').GamepadInput} gamepad
 * @param {import('../game/Settings.js').Settings} settings
 * @param {Array<() => void>} refreshers
 */
function mountPadControls(gamepad, settings, refreshers) {
    const group = el('fieldset', 'settings__group');
    group.append(el('legend', 'settings__legend', 'Gamepad'));
    const message = el('p', 'settings__note');
    message.setAttribute('role', 'status');
    if (!gamepad.playEnabled) {
        group.append(el('p', 'settings__note', PAD_NOTICE), message);
        return group;
    }
    message.textContent = 'Click a control, then press the new button or push the left stick. Start cancels. The right stick aims; the d-pad always strafes.';

    for (const field of PAD_SLIDERS) {
        const { min, max, step } = PAD_RANGES[field.name];
        const row = el('div', 'settings__row');
        const label = el('label', 'settings__label', field.label);
        const slider = document.createElement('input');
        slider.type = 'range';
        slider.className = 'settings__range';
        slider.name = field.name;
        slider.id = `set-${field.name}`;
        slider.min = String(min);
        slider.max = String(max);
        slider.step = String(step);
        label.htmlFor = slider.id;
        const readout = el('span', 'settings__value mono');
        slider.addEventListener('input', () => settings.update({ [field.name]: Number(slider.value) }));
        row.append(label, slider, readout);
        group.append(row);
        refreshers.push(() => {
            slider.value = String(settings.get(field.name));
            readout.textContent = field.format(settings.get(field.name));
        });
    }

    let cancelCapture = null;
    for (const action of PAD_ACTIONS) {
        const line = el('div', 'settings__row');
        const button = el('button', 'btn btn--ghost btn--small mono');
        button.type = 'button';
        button.dataset.padBinding = action;
        button.addEventListener('click', () => {
            cancelCapture?.();
            button.textContent = 'press a control…';
            cancelCapture = gamepad.capture((token) => {
                cancelCapture = null;
                if (token === PAD_RESERVED[0]) {
                    message.textContent = 'Rebind cancelled.';
                } else {
                    const result = rebindPad(settings.get('padBindings'), action, token);
                    if (result.ok) {
                        settings.update({ padBindings: result.bindings });
                        message.textContent = `${PAD_ACTION_LABELS[action]} is now ${padLabel(token)}.`;
                    } else if (result.reason === 'conflict') {
                        message.textContent = `${padLabel(token)} is already used for ${PAD_ACTION_LABELS[result.conflict]}. Pick another control.`;
                    } else {
                        message.textContent = `${padLabel(token)} cannot be used.`;
                    }
                }
                refreshers.forEach((fn) => fn());
            });
        });
        line.append(el('span', 'settings__label', PAD_ACTION_LABELS[action]), button);
        group.append(line);
        refreshers.push(() => { button.textContent = padLabel(settings.get('padBindings')[action]); });
    }
    const reset = el('button', 'btn btn--ghost btn--small', 'Reset pad');
    reset.type = 'button';
    reset.addEventListener('click', () => {
        settings.update({ padBindings: { ...DEFAULT_PAD_BINDINGS }, ...Object.fromEntries(PAD_SLIDERS.map((f) => [f.name, PAD_SETTING_DEFAULTS[f.name]])) });
        message.textContent = 'Gamepad reset to the left stick and RT.';
    });
    group.append(reset, message);
    return group;
}
