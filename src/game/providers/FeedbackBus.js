/**
 * FeedbackBus.js
 *
 * Gameplay emits events ("hit", "perfectStop", "miss"...); effects, audio and
 * HUD subscribe.  Gameplay never calls them directly.
 */
export class FeedbackBus {
    constructor() {
        /** @type {Map<string, Set<Function>>} */
        this.handlers = new Map();
    }

    /** @returns {() => void} unsubscribe */
    on(type, handler) {
        if (!this.handlers.has(type)) this.handlers.set(type, new Set());
        this.handlers.get(type).add(handler);
        return () => this.off(type, handler);
    }

    off(type, handler) { this.handlers.get(type)?.delete(handler); }

    /** A throwing subscriber never breaks gameplay or other subscribers. */
    emit(type, payload) {
        for (const handler of [...(this.handlers.get(type) ?? [])]) {
            try { handler(payload); } catch (error) { console.error(`FeedbackBus "${type}" handler failed`, error); }
        }
    }

    clear() { this.handlers.clear(); }
}
