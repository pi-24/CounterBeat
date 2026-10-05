/**
 * Navigation.js
 *
 * Wires up the shared navigation bar on every page: it highlights the
 * current page, swaps the "log in / register" links for the signed-in user
 * block, handles logging out, and drives the mobile menu button.
 */
import { auth } from '../core/AuthService.js';

export class Navigation {
    /** @param {import('../core/AuthService.js').AuthService} authService */
    constructor(authService = auth) {
        this.auth = authService;
    }

    /** @param {string} pageKey matches the data-nav attribute of a link. */
    init(pageKey) {
        this.markActive(pageKey);
        this.renderAuthState();
        this.bindToggle();
        this.bindLogout();
    }

    /** @param {string} pageKey */
    markActive(pageKey) {
        const link = document.querySelector(`[data-nav="${pageKey}"]`);
        if (link) {
            link.classList.add('is-active');
            link.setAttribute('aria-current', 'page');
        }
    }

    renderAuthState() {
        const user = this.auth.currentUser();
        const guestItems = document.querySelectorAll('[data-nav-guest]');
        const userItem = document.querySelector('[data-nav-user]');
        const nameNode = document.querySelector('[data-nav-username]');

        for (const item of guestItems) {
            item.hidden = user !== null;
        }
        if (userItem) {
            userItem.hidden = user === null;
        }
        if (nameNode && user) {
            nameNode.textContent = user.displayName;
        }
    }

    bindToggle() {
        const toggle = document.getElementById('navToggle');
        const list = document.getElementById('navList');
        if (!toggle || !list) {
            return;
        }

        const isCollapsed = () => window.matchMedia('(max-width: 860px)').matches;
        const apply = () => {
            if (isCollapsed()) {
                list.hidden = toggle.getAttribute('aria-expanded') !== 'true';
            } else {
                list.hidden = false;
            }
        };

        toggle.addEventListener('click', () => {
            const open = toggle.getAttribute('aria-expanded') === 'true';
            toggle.setAttribute('aria-expanded', String(!open));
            apply();
        });
        window.addEventListener('resize', apply);
        apply();
    }

    bindLogout() {
        const button = document.querySelector('[data-action="logout"]');
        if (!button) {
            return;
        }
        button.addEventListener('click', () => {
            this.auth.logout();
            window.location.href = 'index.html';
        });
    }
}

/**
 * Convenience entry point used at the top of every page script.
 * @param {string} pageKey
 */
export function initNavigation(pageKey) {
    new Navigation().init(pageKey);
}
