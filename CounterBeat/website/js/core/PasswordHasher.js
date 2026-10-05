/**
 * PasswordHasher.js
 *
 * Passwords are never stored in plain text in local storage.  Each account
 * gets a random salt and the salted password is hashed with SHA-256 through
 * the Web Crypto API.
 *
 * This is a client-side coursework project, so the hash sits next to the data
 * it protects and a determined attacker with access to the browser profile
 * could brute-force it.  It is here because storing readable passwords would
 * be worse, not because it makes the browser a safe place for secrets.
 */
export class PasswordHasher {
    /** @returns {string} a 16-byte random salt as hexadecimal. */
    static createSalt() {
        const bytes = new Uint8Array(16);
        if (window.crypto && typeof window.crypto.getRandomValues === 'function') {
            window.crypto.getRandomValues(bytes);
        } else {
            for (let i = 0; i < bytes.length; i += 1) {
                bytes[i] = Math.floor(Math.random() * 256);
            }
        }
        return PasswordHasher.toHex(bytes);
    }

    /**
     * @param {string} password
     * @param {string} salt
     * @returns {Promise<string>} hexadecimal digest.
     */
    static async hash(password, salt) {
        const input = `${salt}:${password}`;
        if (window.crypto && window.crypto.subtle) {
            const data = new TextEncoder().encode(input);
            const digest = await window.crypto.subtle.digest('SHA-256', data);
            return PasswordHasher.toHex(new Uint8Array(digest));
        }
        // Web Crypto is only exposed in a secure context.  When the site is
        // opened over plain http from another machine we fall back to a
        // non-cryptographic hash so that the account system still works.
        return PasswordHasher.fallbackHash(input);
    }

    /**
     * Compares a candidate password against a stored salt and hash.
     * @param {string} password
     * @param {string} salt
     * @param {string} expectedHash
     * @returns {Promise<boolean>}
     */
    static async verify(password, salt, expectedHash) {
        const actual = await PasswordHasher.hash(password, salt);
        return actual === expectedHash;
    }

    /** @param {Uint8Array} bytes @returns {string} */
    static toHex(bytes) {
        return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    }

    /** FNV-1a, repeated to widen the output.  @param {string} text */
    static fallbackHash(text) {
        let out = '';
        for (let round = 0; round < 4; round += 1) {
            let hash = 0x811c9dc5 ^ round;
            for (let i = 0; i < text.length; i += 1) {
                hash ^= text.charCodeAt(i);
                hash = Math.imul(hash, 0x01000193) >>> 0;
            }
            out += hash.toString(16).padStart(8, '0');
        }
        return out;
    }
}
