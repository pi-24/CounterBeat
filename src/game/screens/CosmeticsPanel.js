/**
 * CosmeticsPanel.js
 *
 * Settings selectors for target skins and crosshair styles. Entries come from
 * the manifests (data/targets.json, data/crosshairs.json) and are enabled by
 * cosmeticStates(): a star total opens them, difficulty clears do not.
 * Purely visual; nothing here reaches hitboxes, grading or the server.
 */
import { cosmeticStates } from '../progress/unlocks.js';
import { el } from '../../ui/format.js';

export class CosmeticsPanel {
    /**
     * @param {HTMLElement|null} host
     * @param {import('../progress/store.js').ProgressStore} progress
     * @param {import('../providers/ThemeProvider.js').ThemeProvider} themes
     * @param {import('../Settings.js').Settings} settings
     */
    constructor(host, progress, themes, settings) {
        this.host = host;
        this.progress = progress;
        this.themes = themes;
        this.settings = settings;
        if (host) {
            this.render();
            progress.onChange(() => this.render());
        }
    }

    render() {
        this.host.replaceChildren();
        const stars = this.progress.total;
        this.host.append(
            this.select('Target skin', [...this.themes.targets.values()], stars,
                this.progress.values.equipped.targetSkin ?? this.settings.get('targetSkin'), (id) => this.equipTargetSkin(id)),
            this.select('Arena theme', [...this.themes.themes.values()], stars,
                this.progress.values.equipped.theme, (id) => this.progress.equip('theme', id)),
            this.select('Crosshair style', [...this.themes.crosshairs.values()], stars,
                this.progress.values.equipped.crosshair, (id) => this.equipCrosshair(id)),
            el('p', 'text-dim', `★ ${stars} stars earned. Locked styles open as you earn stars.`),
        );
    }

    select(label, entries, stars, current, onPick) {
        const row = el('label', 'settings__row');
        row.append(el('span', 'settings__label', label));
        const select = document.createElement('select');
        const byId = new Map(entries.map((e) => [e.id, e]));
        const states = cosmeticStates(entries, stars);
        for (const state of states) {
            const option = document.createElement('option');
            option.value = state.id;
            option.disabled = !state.unlocked;
            option.textContent = state.unlocked ? byId.get(state.id).name : `${byId.get(state.id).name} (★ ${state.starCost})`;
            select.append(option);
        }
        const usable = (id) => states.some((s) => s.id === id && s.unlocked);
        const fallback = states.find((s) => s.unlocked)?.id ?? entries[0]?.id;
        select.value = usable(current) ? current : fallback;
        select.addEventListener('change', () => onPick(select.value));
        row.append(select);
        return row;
    }

    equipTargetSkin(id) {
        this.progress.equip('targetSkin', id);
        this.settings.update({ targetSkin: id });
    }

    /** Applies a crosshair manifest entry to the player's crosshair settings. */
    equipCrosshair(id) {
        const entry = this.themes.crosshair(id);
        this.progress.equip('crosshair', entry.id);
        const dot = entry.shape === 'dot';
        this.settings.update({
            crosshairColour: entry.colour,
            crosshairDot: dot,
            crosshairLength: dot ? 0 : Math.max(this.settings.get('crosshairLength'), 6),
        });
    }
}
