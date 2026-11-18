/**
 * MainMenu.js - the root menu (Direction C, mockup frame 01): four big Anton
 * entries, a ruled row of utility entries, and a preview panel on the right
 * with real data for whichever entry has focus.  Choosing an entry opens the
 * matching panel of the menu overlay (song select, your songs, settings), or
 * starts the daily, leaves for the rankings, opens Credits / the shop, or quits.
 * A panel bar with a Back button returns to the list.
 */
import { el } from './format.js';
import { MENU_ENTRIES, MENU_PRIMARY, MENU_SECONDARY } from './menuConfig.js';
import { renderPromptBar, MENU_PROMPTS, SONG_PROMPTS, PANEL_PROMPTS } from './promptBar.js';
import { coverSvg } from './trackCovers.js';

/** @param {string} action @returns {{type:string, target:string}} */
export function parseMenuAction(action) {
    const [type, target = ''] = String(action).split(':');
    return { type, target };
}

/** Panel bar titles (the Anton heading beside Back). */
export const PANEL_TITLES = Object.freeze({ play: 'Select track', library: 'Your songs', settings: 'Settings' });

/** Entries with no track of their own borrow a cover so the preview card is never bare. */
const ICON_COVER = Object.freeze({
    ranked: 'overclock', custom: 'drift', shop: 'vault', settings: 'breakneck', credits: 'neon', quit: 'range', daily: 'neon',
});

/** @param {number} n @returns {string} two digits */
const two = (n) => String(n).padStart(2, '0');

export class MainMenu {
    /**
     * @param {HTMLElement} overlay the #menuOverlay element
     * @param {{onDaily:() => void, onTutorial?:() => void, onMode?:(mode:string) => void, onCredits?:() => void,
     *          onShop?:() => void, onQuit?:() => void, getPreview?:(id:string) => object, onPanel?:(name:string) => void,
     *          navigate?:(url:string) => void}} handlers
     */
    constructor(overlay, handlers) {
        this.overlay = overlay;
        this.handlers = handlers;
        this.menu = overlay.querySelector('.menu');
        this.root = null;
        /** @type {Map<string, HTMLElement>} */
        this.buttons = new Map();
        this.focusedId = 'campaign';
        this.lastId = 'campaign';
    }

    mount() {
        if (this.root) {
            return;
        }
        const nav = el('nav', 'mainmenu');
        nav.setAttribute('aria-label', 'Main menu');

        const label = el('div', 'mainmenu__head');
        label.append(el('span', '', 'MAIN'));
        this.counter = el('span', 'slab-counter');
        label.append(this.counter);
        nav.append(label);

        const primary = el('div', 'mainmenu__primary');
        MENU_PRIMARY.forEach((item) => primary.append(this.slab(item)));
        const more = el('div', 'mainmenu__more');
        MENU_SECONDARY.forEach((item) => more.append(this.small(item)));
        nav.append(primary, more);

        this.preview = this.buildPreview();
        const root = el('div', 'menu__root');
        root.append(nav, this.preview);

        // The bar shown above a panel (song select, your songs, settings).
        const bar = el('div', 'panelbar');
        const back = el('button', 'btn btn--ghost mainmenu__back', '‹ Back');
        back.type = 'button';
        back.dataset.action = 'menu-back';
        back.addEventListener('click', () => this.showRoot());
        this.panelTitle = el('h2', 'panelbar__title');
        this.panelCaption = el('span', 'panelbar__caption');
        bar.append(back, this.panelTitle, this.panelCaption);

        this.root = root;
        this.nav = nav;
        this.back = back;
        this.panelBar = bar;
        const firstPanel = this.menu.querySelector('.menu__panel');
        firstPanel.before(root, bar);
        this.promptBar = null;
        this.setPrompts(MENU_PROMPTS);
        this.showRoot({ focus: false });
    }

    /** @param {{id:string, label:string, blurb?:string}} item @param {number} index */
    indexOf(item) {
        return MENU_ENTRIES.indexOf(item);
    }

    /** The big Anton rows: a focus slab with title, blurb and index counter. */
    slab(item) {
        // The title comes first in the DOM (reading order); the decorative index is aria-hidden.
        const button = el('button', `mainmenu__item slab${item.label.length > 14 ? ' slab--long' : ''}`);
        button.type = 'button';
        button.dataset.menuItem = item.id;
        button.append(el('span', 'slab__title', item.label));
        if (item.blurb) {
            button.append(el('span', 'slab__meta', item.blurb));
        }
        const index = el('span', 'slab__index', two(this.indexOf(item) + 1));
        index.setAttribute('aria-hidden', 'true');
        button.append(index);
        this.bind(button, item);
        return button;
    }

    /** The ruled row of utility entries. */
    small(item) {
        const button = el('button', 'mainmenu__item mainmenu__item--minor moreitem');
        button.type = 'button';
        button.dataset.menuItem = item.id;
        const name = el('span', 'moreitem__name', item.label.replace(' (Beta)', ''));
        button.append(name);
        if (item.beta) {
            button.append(el('span', 'tag tag--acid moreitem__beta', 'BETA'));
        }
        const index = el('span', 'moreitem__index', two(this.indexOf(item) + 1));
        index.setAttribute('aria-hidden', 'true');
        button.append(index);
        this.bind(button, item);
        return button;
    }

    bind(button, item) {
        this.buttons.set(item.id, button);
        button.addEventListener('click', () => this.choose(item));
        button.addEventListener('focus', () => this.setFocused(item.id));
        // The mouse moves the slab and the preview too, and takes DOM focus, so mouse, keyboard and pad share one cursor.
        button.addEventListener('mouseenter', () => {
            this.setFocused(item.id);
            button.focus?.({ preventScroll: true });
        });
    }

    buildPreview() {
        const aside = el('aside', 'preview');
        aside.setAttribute('aria-live', 'polite');
        this.previewNum = el('div', 'preview__num', '01');
        this.previewNum.setAttribute('aria-hidden', 'true');
        const kicker = el('div', 'preview__kicker');
        this.previewKicker = el('span', '');
        this.previewTag = el('span', '');
        kicker.append(this.previewKicker, this.previewTag);
        const card = el('div', 'preview__card');
        const main = el('div', 'preview__main');
        this.previewCover = el('div', 'preview__cover');
        const text = el('div', 'preview__text');
        this.previewTitle = el('h3', 'preview__title');
        this.previewBody = el('p', 'preview__body');
        text.append(this.previewTitle, this.previewBody);
        main.append(this.previewCover, text);
        this.previewStats = el('div', 'preview__stats');
        card.append(main, this.previewStats);
        aside.append(this.previewNum, kicker, card);
        return aside;
    }

    /** @param {string} id the entry that has focus: updates the counter and the preview */
    setFocused(id) {
        if (!this.buttons.has(id)) {
            return;
        }
        this.focusedId = id;
        this.lastId = id;
        // .is-focus keeps the acid slab on the current entry even when the window has no DOM focus.
        for (const [key, button] of this.buttons) {
            button.classList.toggle('is-focus', key === id);
        }
        this.refreshPreview();
    }

    /** Redraws the counter and the preview for the focused entry (data may have changed). */
    refreshPreview() {
        if (!this.root) {
            return;
        }
        const item = MENU_ENTRIES.find((e) => e.id === this.focusedId);
        if (!item) {
            return;
        }
        const index = this.indexOf(item) + 1;
        this.counter.replaceChildren(el('b', '', two(index)), ` / ${two(MENU_ENTRIES.length)}`);
        this.previewNum.textContent = two(index);
        const model = this.handlers.getPreview?.(item.id);
        if (!model) {
            return;
        }
        this.previewKicker.textContent = model.kicker;
        this.previewTag.textContent = model.tag;
        this.previewTitle.textContent = model.title;
        this.previewBody.textContent = model.body;
        this.previewCover.innerHTML = coverSvg(model.cover ?? ICON_COVER[item.id] ?? 'range');
        this.previewStats.replaceChildren(...model.stats.map((s) => {
            const cell = el('div', 'preview__stat');
            cell.append(el('span', 'preview__stat-label', s.label), el('span', 'preview__stat-value', s.value));
            return cell;
        }));
        this.previewStats.hidden = model.stats.length === 0;
    }

    /** @param {Array<{label:string, keys?:string[], pad?:string[]}>} items replaces the prompt bar content */
    setPrompts(items) {
        const next = renderPromptBar(document, items, { right: 'CounterBeat' });
        next.classList.add('prompt-bar--sticky');
        if (this.promptBar) {
            this.promptBar.replaceWith(next);
        } else {
            this.overlay.append(next);
        }
        this.promptBar = next;
    }

    /** Puts focus back on the entry last used (after the Play splash closes). */
    focusCurrent() {
        if (this.menu.classList.contains('menu--root')) {
            this.buttons.get(this.lastId)?.focus?.({ preventScroll: true });
        }
    }

    /** @param {{focus?:boolean}} [options] focus: put focus on the entry last used (default true) */
    showRoot({ focus = true } = {}) {
        this.menu.classList.add('menu--root');
        this.setPrompts(MENU_PROMPTS);
        this.setFocused(this.lastId);
        if (focus) {
            this.buttons.get(this.lastId)?.focus?.({ preventScroll: true });
        }
    }

    /** @param {string} name play | library | settings @param {string} [caption] mono caption beside the title */
    openPanel(name, caption = '') {
        for (const panel of this.menu.querySelectorAll('.menu__panel')) {
            panel.classList.toggle('is-active', panel.dataset.panel === name);
        }
        this.menu.classList.remove('menu--root');
        this.panelTitle.textContent = PANEL_TITLES[name] ?? '';
        this.panelCaption.textContent = caption;
        this.setPrompts(name === 'play' ? SONG_PROMPTS : PANEL_PROMPTS);
        this.handlers.onPanel?.(name);
        if (name !== 'play') {
            this.back.focus?.({ preventScroll: true });
        }
    }

    /** @param {{id:string, action:string, mode?:string}} item */
    choose(item) {
        const { type, target } = parseMenuAction(item.action);
        if (type === 'panel') {
            // Campaign / Quick Play / Practice share the track list but run in their own mode.
            if (item.mode) {
                this.handlers.onMode?.(item.mode);
            }
            const caption = item.mode ? `${item.label.toUpperCase()}` : '';
            this.openPanel(target, caption);
        } else if (type === 'daily') {
            this.handlers.onDaily();
        } else if (type === 'credits') {
            this.handlers.onCredits?.();
        } else if (type === 'shop') {
            this.handlers.onShop?.();
        } else if (type === 'quit') {
            this.handlers.onQuit?.();
        } else if (type === 'tutorial') {
            this.handlers.onTutorial?.();
        } else if (type === 'page') {
            (this.handlers.navigate ?? ((url) => { window.location.href = url; }))(target);
        }
    }
}
