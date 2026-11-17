/**
 * CreditsScreen.js - in-game Credits overlay rendering buildCredits() over the
 * same manifests that generate CREDITS.md.
 */
import { el } from './format.js';
import { groupCredits } from './creditsData.js';

/** Renders the credits into a dialog element. @param {HTMLElement} parent @param {object[]} credits buildCredits() output */
export class CreditsScreen {
    constructor(parent, credits) {
        this.root = el('div', 'credits');
        this.root.hidden = true;
        this.root.setAttribute('role', 'dialog');
        this.root.setAttribute('aria-modal', 'true');
        this.root.tabIndex = -1;
        this.opener = null;
        this.root.addEventListener('keydown', (e) => this.onKey(e));
        this.root.addEventListener('click', (e) => { if (e.target === this.root) this.close(); });
        this.root.setAttribute('aria-label', 'Credits');
        const card = el('div', 'credits__card');
        card.append(el('h2', 'credits__title', 'Credits'));
        for (const [cat, items] of groupCredits(credits)) {
            card.append(el('h3', 'credits__cat', cat));
            const ul = el('ul', 'credits__list');
            for (const e of items) {
                ul.append(el('li', 'credits__item', `${e.name} - ${e.author} - licence: ${e.licence}${e.note ? ` (${e.note})` : ''}`));
            }
            card.append(ul);
        }
        card.append(el('p', 'credits__hint', 'Esc or click outside to close'));
        const close = el('button', 'btn btn--primary', 'Close');
        close.type = 'button';
        close.dataset.action = 'credits-close';
        close.addEventListener('click', () => this.close());
        card.append(close);
        this.root.append(card);
        parent.append(this.root);
    }

    /** @param {HTMLElement|null} [opener] element to refocus on close */
    open(opener = null) {
        this.opener = opener;
        this.root.hidden = false;
        this.root.focus({ preventScroll: true });
        const card = this.root.querySelector?.('.credits__card');
        if (card) card.scrollTop = 0;
    }

    close() {
        this.root.hidden = true;
        const back = this.opener;
        this.opener = null;
        if (back && back.isConnected) back.focus();
    }

    /** Escape closes; Tab stays inside the dialog. */
    onKey(e) {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.close(); return; }
        if (e.key !== 'Tab') return;
        const items = [...this.root.querySelectorAll('button, [href], input, select, [tabindex]:not([tabindex="-1"])')];
        if (!items.length) { e.preventDefault(); return; }
        const first = items[0]; const last = items[items.length - 1];
        const active = document.activeElement;
        if (e.shiftKey && (active === first || !this.root.contains(active))) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && (active === last || !this.root.contains(active))) { e.preventDefault(); first.focus(); }
    }
}
