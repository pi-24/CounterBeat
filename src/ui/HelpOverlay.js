/**
 * HelpOverlay.js - the in-game Help overlay: controls, the counter-strafe in four steps,
 * and a way to replay the tutorial.  It replaces the Controls / Counter-strafe sidebars the
 * web page used to carry beside the game.  Reachable from the menu and the pause screen
 * (H, the Y button, or any element marked `data-open-help`).
 */
export class HelpOverlay {
    /**
     * @param {HTMLElement} overlay the #helpOverlay element
     * @param {{onTutorial?:() => void}} [handlers]
     */
    constructor(overlay, handlers = {}) {
        this.overlay = overlay;
        this.handlers = handlers;
        this.opener = null;
        overlay.querySelector('[data-action="help-close"]')?.addEventListener('click', () => this.close());
        overlay.querySelector('[data-action="help-tutorial"]')?.addEventListener('click', () => {
            this.close(false);
            this.handlers.onTutorial?.();
        });
        for (const button of document.querySelectorAll('[data-open-help]')) {
            button.addEventListener('click', () => this.open(button));
        }
    }

    get isOpen() {
        return !this.overlay.hidden;
    }

    /** @param {Element|null} [opener] gets focus back on close */
    open(opener = document.activeElement) {
        if (this.isOpen) {
            return;
        }
        this.opener = opener;
        this.overlay.hidden = false;
        this.overlay.querySelector('[data-action="help-close"]')?.focus();
    }

    /** @param {boolean} [restoreFocus] */
    close(restoreFocus = true) {
        if (!this.isOpen) {
            return;
        }
        this.overlay.hidden = true;
        if (restoreFocus && this.opener && this.opener.isConnected) {
            this.opener.focus?.();
        }
        this.opener = null;
    }

    toggle() {
        if (this.isOpen) {
            this.close();
        } else {
            this.open();
        }
    }
}
