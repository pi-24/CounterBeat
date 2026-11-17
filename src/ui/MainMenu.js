/**
 * MainMenu.js - the root menu: exactly the entries in menuConfig.js, drawn as
 * a vertical list of big buttons.  Choosing one opens the matching panel of
 * the existing menu overlay (or starts the daily / leaves for the rankings).
 * A Back button returns to the list.
 */
import { el } from './format.js';
import { MENU_ITEMS, MENU_EXTRAS } from './menuConfig.js';
import { renderPromptBar, MENU_PROMPTS } from './promptBar.js';

/** @param {string} action @returns {{type:string, target:string}} */
export function parseMenuAction(action) {
    const [type, target = ''] = String(action).split(':');
    return { type, target };
}

export class MainMenu {
    /**
     * @param {HTMLElement} overlay the #menuOverlay element
     * @param {{onDaily:() => void, onTutorial:() => void, navigate?:(url:string) => void}} handlers
     */
    constructor(overlay, handlers) {
        this.overlay = overlay;
        this.handlers = handlers;
        this.menu = overlay.querySelector('.menu');
        this.root = null;
    }

    mount() {
        if (this.root) {
            return;
        }
        const nav = el('nav', 'mainmenu');
        nav.setAttribute('aria-label', 'Main menu');
        const entries = [...MENU_ITEMS, ...MENU_EXTRAS];
        entries.forEach((item, i) => {
            const minor = MENU_EXTRAS.includes(item);
            // C design system focus slab. The title comes first in the DOM (reading order); the
            // decorative index is aria-hidden and placed on the left by CSS.
            const button = el('button', `mainmenu__item slab slab--small${minor ? ' mainmenu__item--minor' : ''}`);
            button.type = 'button';
            button.dataset.menuItem = item.id;
            button.append(el('span', 'slab__title mainmenu__label', item.label));
            if (item.blurb) {
                button.append(el('span', 'slab__meta mainmenu__blurb', item.blurb));
            }
            const index = el('span', 'slab__index', String(i + 1).padStart(2, '0'));
            index.setAttribute('aria-hidden', 'true');
            button.append(index);
            button.addEventListener('click', () => this.choose(item));
            nav.append(button);
        });
        const back = el('button', 'btn btn--ghost mainmenu__back', '‹ Back');
        back.type = 'button';
        back.dataset.action = 'menu-back';
        back.addEventListener('click', () => this.showRoot());
        this.root = nav;
        this.back = back;
        const firstPanel = this.menu.querySelector('.menu__panel');
        firstPanel.before(nav, back);
        this.promptBar = renderPromptBar(document, MENU_PROMPTS, { right: 'CounterBeat' });
        this.promptBar.classList.add('prompt-bar--sticky');
        this.overlay.append(this.promptBar);
        this.showRoot();
    }

    showRoot() {
        this.menu.classList.add('menu--root');
    }

    /** @param {string} name play | library | settings */
    openPanel(name) {
        for (const panel of this.menu.querySelectorAll('.menu__panel')) {
            panel.classList.toggle('is-active', panel.dataset.panel === name);
        }
        this.menu.classList.remove('menu--root');
    }

    /** @param {{id:string, action:string}} item */
    choose(item) {
        const { type, target } = parseMenuAction(item.action);
        if (type === 'panel') {
            // Campaign / Quick Play / Practice share the track list but run in their own mode.
            this.handlers.onMode?.(item.mode ?? 'quickPlay');
            this.openPanel(target);
        } else if (type === 'daily') {
            this.handlers.onDaily();
        } else if (type === 'credits') {
            this.handlers.onCredits?.();
        } else if (type === 'tutorial') {
            this.handlers.onTutorial();
        } else if (type === 'page') {
            (this.handlers.navigate ?? ((url) => { window.location.href = url; }))(target);
        }
    }
}
