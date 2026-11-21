/**
 * CosmeticsPanel.js
 *
 * The cosmetics block of Settings. Bots, skins, crosshairs and arena themes are
 * bought with coins in the Shop, so this panel no longer picks anything: it
 * shows what is equipped and links each row into the Shop.
 * Purely visual; nothing here reaches hitboxes, grading or the server.
 */
import { el } from '../../ui/format.js';
import { coinLabel } from '../../ui/shopModel.js';

/** Settings rows: what is shown, which equipped slot it reads and which Shop tab it opens. */
const ROWS = Object.freeze([
    Object.freeze({ label: 'Bot / skin', slot: 'targetSkin', tab: 'bot', map: 'targets' }),
    Object.freeze({ label: 'Arena theme', slot: 'theme', tab: 'theme', map: 'themes' }),
    Object.freeze({ label: 'Crosshair', slot: 'crosshair', tab: 'crosshair', map: 'crosshairs' }),
]);

export class CosmeticsPanel {
    /**
     * @param {HTMLElement|null} host
     * @param {import('../progress/store.js').ProgressStore} progress
     * @param {import('../providers/ThemeProvider.js').ThemeProvider} themes
     * @param {import('../Settings.js').Settings} settings
     * @param {{onShop?:(choice:{tab?:string, selectedId?:string}) => void}} [handlers]
     */
    constructor(host, progress, themes, settings, handlers = {}) {
        this.host = host;
        this.progress = progress;
        this.themes = themes;
        this.settings = settings;
        this.handlers = handlers;
        if (host) {
            this.render();
            progress.onChange(() => this.render());
        }
    }

    /** The name of what is equipped in a slot (the free default when nothing, or something unowned, is). */
    equippedName(row) {
        const map = this.themes[row.map];
        const wanted = row.slot === 'targetSkin'
            ? (this.progress.equipped.targetSkin ?? this.settings.get('targetSkin'))
            : this.progress.equipped[row.slot];
        const fallback = map.values().next().value;
        const entry = wanted && map.has(wanted) && this.progress.isOwned(wanted) ? map.get(wanted) : fallback;
        return entry?.name ?? '';
    }

    render() {
        this.host.replaceChildren();
        for (const row of ROWS) {
            const line = el('div', 'settings__row');
            line.append(el('span', 'settings__label', row.label), el('span', 'settings__value', this.equippedName(row)));
            const link = el('button', 'btn btn--ghost', 'Shop');
            link.type = 'button';
            link.dataset.shopLink = row.tab;
            link.addEventListener('click', () => this.handlers.onShop?.({ tab: row.tab }));
            line.append(link);
            this.host.append(line);
        }
        this.host.append(el('p', 'text-dim', `${coinLabel(this.progress.coins)} to spend. Earn coins on every level; bots, skins, crosshairs and themes are bought in the Shop.`));
    }
}
