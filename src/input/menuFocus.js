/**
 * menuFocus.js - gamepad menu navigation.  `pickNext` is spatial focus
 * movement over element rectangles; `MenuNavigator` turns pad nav events
 * (up/down/left/right/confirm/back) into focus moves, activations and slider
 * nudges on a "surface".  Both are DOM-free (the surface is an interface), so
 * they are unit-tested; `domSurface` is the thin browser implementation.
 *
 * @typedef {{id:string, x:number, y:number, w:number, h:number, kind?:string}} FocusItem
 * @typedef {'up'|'down'|'left'|'right'} Direction
 */

/** @param {FocusItem} item */
const centre = (item) => ({ x: item.x + item.w / 2, y: item.y + item.h / 2 });

/**
 * The item focus should move to, or the current one if nothing lies that way.
 * Candidates must lie on the requested side; the nearest wins, with sideways
 * drift weighted double so "down" prefers the button below over a far corner.
 * @param {FocusItem[]} items
 * @param {string|null} currentId
 * @param {Direction} direction
 * @returns {string|null}
 */
export function pickNext(items, currentId, direction) {
    if (items.length === 0) return null;
    const current = items.find((item) => item.id === currentId);
    if (!current) {
        // Nothing focused yet: start at the top-left.
        return [...items].sort((a, b) => a.y - b.y || a.x - b.x)[0].id;
    }
    const from = centre(current);
    let best = null;
    let bestScore = Infinity;
    for (const item of items) {
        if (item.id === current.id) continue;
        const to = centre(item);
        const dx = to.x - from.x;
        const dy = to.y - from.y;
        const along = { up: -dy, down: dy, left: -dx, right: dx }[direction];
        const across = direction === 'up' || direction === 'down' ? Math.abs(dx) : Math.abs(dy);
        if (along <= 0.5) continue;
        const score = along + across * 2;
        if (score < bestScore) {
            bestScore = score;
            best = item;
        }
    }
    return best ? best.id : current.id;
}

/**
 * @typedef {object} MenuSurface
 * @property {() => FocusItem[]} items       the focusable controls currently on screen
 * @property {() => string|null} focusedId
 * @property {(id:string) => void} focus
 * @property {(id:string) => void} activate  click / toggle
 * @property {(id:string, step:number) => boolean} adjust  nudge a slider or select; false if not adjustable
 * @property {() => boolean} back            close / go up one level; false if there is nowhere to go
 * @property {(step:number) => boolean} [shoulder]  LB / RB: step the screen's segmented control; false if it has none
 */

export class MenuNavigator {
    /** @param {MenuSurface} surface */
    constructor(surface) {
        this.surface = surface;
    }

    /**
     * @param {'up'|'down'|'left'|'right'|'confirm'|'back'|'prev'|'next'} event prev / next are LB / RB (Q / E) and step surface.shoulder
     * @returns {boolean} whether the event did anything
     */
    handle(event) {
        const { surface } = this;
        if (event === 'back') return surface.back();
        // LB / RB (Q / E): step a segmented control such as the difficulty bar.
        if (event === 'prev' || event === 'next') return surface.shoulder?.(event === 'next' ? 1 : -1) ?? false;
        const items = surface.items();
        if (items.length === 0) return false;
        const current = surface.focusedId();
        const known = items.some((item) => item.id === current);
        if (event === 'confirm') {
            if (!known) {
                surface.focus(pickNext(items, null, 'down'));
                return true;
            }
            surface.activate(current);
            return true;
        }
        if (known && (event === 'left' || event === 'right')) {
            const item = items.find((entry) => entry.id === current);
            if ((item.kind === 'range' || item.kind === 'select') && surface.adjust(current, event === 'right' ? 1 : -1)) {
                return true;
            }
        }
        const next = pickNext(items, known ? current : null, event);
        if (next === null || next === current) return false;
        surface.focus(next);
        return true;
    }
}

/** Selector for everything the pad can land on. */
const FOCUSABLE = 'button:not([data-nofocus]), a[href], input:not([type="hidden"]):not([type="file"]), select, [tabindex="0"]';
/**
 * Overlays carry `data-pad-overlay="<priority>"` in the markup; the visible one
 * with the highest priority takes the pad.  A modal dialog (`aria-modal="true"`
 * or `data-pad-modal`, e.g. Credits) always sits above every overlay and traps
 * the pad.  A new overlay or dialog therefore joins pad navigation by carrying
 * the attribute, with no list to edit (tests/unit/gamepad.test.mjs enforces it).
 */
const OVERLAY_SELECTOR = '[data-pad-overlay]';
const MODAL_SELECTOR = '[aria-modal="true"], [data-pad-modal]';
/** What "back" clicks inside the active scope, in order of preference. */
const BACK_SELECTOR = '[data-pad-back], [data-action="menu-back"], [data-action="credits-close"], [data-action="cal-close"], [data-action="help-close"], [data-action="resume"], [data-action="menu"]';

/** @param {Element} element */
const shown = (element) => !element.hidden && !element.closest('[hidden]') && element.getClientRects().length > 0;

/**
 * The element that owns the pad: the last visible modal, else the visible
 * overlay with the highest priority.
 * @param {ParentNode} doc
 * @returns {Element|null}
 */
export function activeScope(doc) {
    const modals = [...doc.querySelectorAll(MODAL_SELECTOR)].filter(shown);
    if (modals.length > 0) return modals[modals.length - 1];
    let best = null;
    let bestPriority = -Infinity;
    for (const overlay of doc.querySelectorAll(OVERLAY_SELECTOR)) {
        if (!shown(overlay)) continue;
        const priority = Number(overlay.getAttribute('data-pad-overlay')) || 0;
        if (priority > bestPriority) {
            best = overlay;
            bestPriority = priority;
        }
    }
    return best;
}

/**
 * The browser surface: the topmost visible overlay's visible, enabled controls.
 * @param {Document} doc
 * @returns {MenuSurface}
 */
export function domSurface(doc) {
    const ids = new WeakMap();
    let counter = 0;
    const idOf = (element) => {
        if (!ids.has(element)) ids.set(element, `f${counter++}`);
        return ids.get(element);
    };
    const registry = new Map();
    const root = () => activeScope(doc);
    const kindOf = (element) => {
        if (element.tagName === 'SELECT') return 'select';
        if (element.tagName === 'INPUT') return element.type === 'range' ? 'range' : element.type === 'checkbox' ? 'check' : 'other';
        return 'button';
    };
    return {
        items() {
            registry.clear();
            const scope = root();
            if (!scope) return [];
            const out = [];
            for (const element of scope.querySelectorAll(FOCUSABLE)) {
                if (element.disabled || element.hidden || element.closest('[hidden]')) continue;
                const rect = element.getBoundingClientRect();
                if (rect.width === 0 || rect.height === 0) continue;
                const id = idOf(element);
                registry.set(id, element);
                out.push({ id, x: rect.left, y: rect.top, w: rect.width, h: rect.height, kind: kindOf(element) });
            }
            return out;
        },
        focusedId() {
            const active = doc.activeElement;
            return active && ids.has(active) ? ids.get(active) : null;
        },
        focus(id) {
            const element = registry.get(id);
            if (element) {
                element.focus({ preventScroll: false });
                element.scrollIntoView?.({ block: 'nearest' });
            }
        },
        activate(id) {
            registry.get(id)?.click();
        },
        adjust(id, step) {
            const element = registry.get(id);
            if (!element) return false;
            if (element.tagName === 'SELECT') {
                const next = Math.max(0, Math.min(element.options.length - 1, element.selectedIndex + step));
                if (next === element.selectedIndex) return true;
                element.selectedIndex = next;
            } else {
                const stepSize = Number(element.step) || 1;
                const min = Number(element.min || 0);
                const max = Number(element.max || 100);
                // A coarser nudge than the native step so a pad can sweep a slider.
                const nudge = stepSize * Math.max(1, Math.round((max - min) / stepSize / 20));
                element.value = String(Math.max(min, Math.min(max, Number(element.value) + step * nudge)));
            }
            element.dispatchEvent(new Event('input', { bubbles: true }));
            element.dispatchEvent(new Event('change', { bubbles: true }));
            return true;
        },
        shoulder(step) {
            const scope = root();
            if (!scope) return false;
            const target = scope.querySelector(step > 0 ? '[data-shoulder-next]' : '[data-shoulder-prev]');
            if (target && shown(target)) {
                target.click();
                return true;
            }
            return false;
        },
        back() {
            const scope = root();
            if (!scope) return false;
            const target = [...scope.querySelectorAll(BACK_SELECTOR)].find(shown);
            if (target) {
                target.click();
                return true;
            }
            return false;
        },
    };
}
