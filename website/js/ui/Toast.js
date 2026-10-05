/**
 * Toast.js
 *
 * Small transient messages in the corner of the page.  The coursework brief
 * forbids `alert()`, and a toast is friendlier anyway: it does not block the
 * page and it is announced to screen readers through the live region on the
 * container element.
 */
export class Toast {
    /** @param {string} containerId */
    constructor(containerId = 'toastStack') {
        this.container = document.getElementById(containerId);
    }

    /**
     * @param {string} message
     * @param {'info'|'success'|'error'} [variant]
     * @param {number} [durationMs]
     */
    show(message, variant = 'info', durationMs = 4200) {
        if (!this.container) {
            console.info(`Toast (${variant}): ${message}`);
            return;
        }
        const node = document.createElement('div');
        node.className = `toast toast--${variant}`;
        node.textContent = message;
        this.container.append(node);

        window.setTimeout(() => {
            node.remove();
        }, durationMs);
    }

    /** @param {string} message */
    success(message) {
        this.show(message, 'success');
    }

    /** @param {string} message */
    error(message) {
        this.show(message, 'error', 5200);
    }

    /** @param {string} message */
    info(message) {
        this.show(message, 'info');
    }
}

export const toast = new Toast();
