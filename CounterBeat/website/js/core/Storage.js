/**
 * Storage.js
 *
 * A thin, typed wrapper around window.localStorage.  Every value the site
 * persists goes through this class, which means JSON serialisation, quota
 * errors and corrupt data are all handled in exactly one place.
 */
export class Storage {
    /**
     * @param {string} namespace prefix applied to every key, so that the
     *   site's data cannot collide with anything else on the same origin.
     * @param {globalThis.Storage} [backing] injected for testing.
     */
    constructor(namespace, backing = window.localStorage) {
        this.namespace = namespace;
        this.backing = backing;
    }

    /** @param {string} key @returns {string} the namespaced storage key */
    keyFor(key) {
        return `${this.namespace}:${key}`;
    }

    /**
     * Reads a JSON value.
     * @template T
     * @param {string} key
     * @param {T} fallback returned when the key is missing or unreadable.
     * @returns {T}
     */
    read(key, fallback) {
        try {
            const raw = this.backing.getItem(this.keyFor(key));
            if (raw === null) {
                return fallback;
            }
            return JSON.parse(raw);
        } catch (error) {
            // Corrupt JSON should never take the whole page down: drop the
            // bad entry and carry on with the fallback.
            console.warn(`Storage: could not read "${key}"`, error);
            this.remove(key);
            return fallback;
        }
    }

    /**
     * Writes a JSON value.
     * @param {string} key
     * @param {unknown} value
     * @returns {boolean} false when the write failed (for example, quota).
     */
    write(key, value) {
        try {
            this.backing.setItem(this.keyFor(key), JSON.stringify(value));
            return true;
        } catch (error) {
            console.error(`Storage: could not write "${key}"`, error);
            return false;
        }
    }

    /** @param {string} key */
    remove(key) {
        try {
            this.backing.removeItem(this.keyFor(key));
        } catch (error) {
            console.warn(`Storage: could not remove "${key}"`, error);
        }
    }

    /** @returns {boolean} whether local storage is usable in this browser. */
    static isAvailable() {
        try {
            const probe = '__counterbeat_probe__';
            window.localStorage.setItem(probe, '1');
            window.localStorage.removeItem(probe);
            return true;
        } catch (error) {
            return false;
        }
    }
}

/** The single store instance shared by the whole site. */
export const store = new Storage('counterbeat');
