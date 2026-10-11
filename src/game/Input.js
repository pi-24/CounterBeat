/**
 * Input.js
 *
 * Tracks which keys are currently held, so the movement code can read the
 * keyboard state once per frame instead of reacting to events.  Keys the
 * game uses are prevented from scrolling the page while the canvas has
 * focus.
 */

const CAPTURED = new Set(['Space', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'KeyA', 'KeyD']);

export class Input {
    constructor() {
        /** @type {Set<string>} */
        this.down = new Set();
        /** @type {Set<(code:string, event:KeyboardEvent) => void>} */
        this.pressListeners = new Set();

        this.handleDown = (event) => {
            if (event.repeat) {
                if (CAPTURED.has(event.code)) {
                    event.preventDefault();
                }
                return;
            }
            this.down.add(event.code);
            if (CAPTURED.has(event.code) && !Input.isTyping(event)) {
                event.preventDefault();
            }
            for (const listener of this.pressListeners) {
                listener(event.code, event);
            }
        };
        this.handleUp = (event) => {
            this.down.delete(event.code);
        };
        this.handleBlur = () => {
            this.down.clear();
        };

        window.addEventListener('keydown', this.handleDown);
        window.addEventListener('keyup', this.handleUp);
        window.addEventListener('blur', this.handleBlur);
    }

    /** @param {string} code a KeyboardEvent.code value */
    isDown(code) {
        return this.down.has(code);
    }

    /** @param {(code:string, event:KeyboardEvent) => void} listener */
    onPress(listener) {
        this.pressListeners.add(listener);
        return () => this.pressListeners.delete(listener);
    }

    /** @param {KeyboardEvent} event @returns {boolean} whether a form field has focus. */
    static isTyping(event) {
        const target = event.target;
        return target instanceof HTMLInputElement
            || target instanceof HTMLTextAreaElement
            || target instanceof HTMLSelectElement;
    }

    dispose() {
        window.removeEventListener('keydown', this.handleDown);
        window.removeEventListener('keyup', this.handleUp);
        window.removeEventListener('blur', this.handleBlur);
    }
}
