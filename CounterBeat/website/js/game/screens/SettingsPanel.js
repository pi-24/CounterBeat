/**
 * SettingsPanel.js
 *
 * Binds the settings form in the menu overlay to the Settings store.  Every
 * control writes straight through, and the readouts (Valorant equivalent,
 * cm/360, the crosshair preview) update as the player drags.
 */
import { Hud } from '../fps/Hud.js';

export class SettingsPanel {
    /**
     * @param {HTMLElement} root the settings <form>
     * @param {import('../Settings.js').Settings} settings
     */
    constructor(root, settings) {
        this.root = root;
        this.settings = settings;
        this.field = (name) => root.querySelector(`[name="${name}"]`);
        this.readout = (id) => root.querySelector(`#${id}`);
        this.preview = root.querySelector('#crosshairPreview');
    }

    init() {
        const bindings = [
            ['sensitivity', 'input', (v) => Number(v)],
            ['dpi', 'change', (v) => Number(v)],
            ['fov', 'input', (v) => Number(v)],
            ['crosshairColour', 'input', (v) => String(v)],
            ['crosshairLength', 'input', (v) => Number(v)],
            ['crosshairGap', 'input', (v) => Number(v)],
            ['crosshairThickness', 'input', (v) => Number(v)],
        ];
        for (const [name, event, parse] of bindings) {
            const control = this.field(name);
            if (!control) {
                continue;
            }
            control.addEventListener(event, () => {
                this.settings.update({ [name]: parse(control.value) });
                this.refresh();
            });
        }
        for (const name of ['crosshairDot', 'viewBob']) {
            const control = this.field(name);
            if (control) {
                control.addEventListener('change', () => {
                    this.settings.update({ [name]: control.checked });
                    this.refresh();
                });
            }
        }

        const reset = this.root.querySelector('[data-action="reset-settings"]');
        if (reset) {
            reset.addEventListener('click', () => {
                this.settings.reset();
                this.refresh();
            });
        }
        this.root.addEventListener('submit', (event) => event.preventDefault());
        this.refresh();
    }

    /** Pushes the stored values back into the controls and readouts. */
    refresh() {
        const s = this.settings;
        for (const name of ['sensitivity', 'dpi', 'fov', 'crosshairColour',
            'crosshairLength', 'crosshairGap', 'crosshairThickness']) {
            const control = this.field(name);
            if (control) {
                control.value = String(s.get(name));
            }
        }
        for (const name of ['crosshairDot', 'viewBob']) {
            const control = this.field(name);
            if (control) {
                control.checked = Boolean(s.get(name));
            }
        }

        this.readout('sensCs').textContent = s.get('sensitivity').toFixed(2);
        this.readout('sensVal').textContent = s.valorantSensitivity.toFixed(3);
        this.readout('sensCm').textContent = `${s.cmPer360.toFixed(1)} cm`;
        this.readout('fovVal').textContent = `${s.get('fov')}°`;

        if (this.preview) {
            Hud.drawCrosshair(this.preview, s);
        }
    }
}
