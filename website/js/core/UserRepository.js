/**
 * UserRepository.js
 *
 * Owns the `counterbeat:users` entry in local storage: an array of user
 * records held as JSON.  Nothing else in the site touches that key directly.
 *
 * Record shape:
 * {
 *   id: string,               // "u_" + timestamp + random suffix
 *   displayName: string,
 *   email: string,            // stored lower-cased, used as the login key
 *   passwordSalt: string,
 *   passwordHash: string,
 *   country: string,
 *   favouriteSensitivity: string,
 *   mainGame: string,
 *   createdAt: string         // ISO 8601
 * }
 */
import { store } from './Storage.js';

const KEY = 'users';

export class UserRepository {
    /** @param {import('./Storage.js').Storage} storage */
    constructor(storage = store) {
        this.storage = storage;
    }

    /** @returns {object[]} every stored user record. */
    all() {
        const users = this.storage.read(KEY, []);
        return Array.isArray(users) ? users : [];
    }

    /** @param {object[]} users */
    saveAll(users) {
        return this.storage.write(KEY, users);
    }

    /** @param {string} id */
    findById(id) {
        return this.all().find((user) => user.id === id) ?? null;
    }

    /** @param {string} email */
    findByEmail(email) {
        const needle = String(email).trim().toLowerCase();
        return this.all().find((user) => user.email === needle) ?? null;
    }

    /** @param {string} displayName */
    findByDisplayName(displayName) {
        const needle = String(displayName).trim().toLowerCase();
        return this.all().find((user) => user.displayName.toLowerCase() === needle) ?? null;
    }

    /** @param {string} email @returns {boolean} */
    emailTaken(email) {
        return this.findByEmail(email) !== null;
    }

    /** @param {string} displayName @returns {boolean} */
    displayNameTaken(displayName) {
        return this.findByDisplayName(displayName) !== null;
    }

    /**
     * Adds a new record.
     * @param {object} user
     * @returns {object} the stored record.
     */
    add(user) {
        const users = this.all();
        users.push(user);
        this.saveAll(users);
        return user;
    }

    /**
     * Replaces a record by id.
     * @param {string} id
     * @param {Partial<object>} changes
     * @returns {object | null} the updated record.
     */
    update(id, changes) {
        const users = this.all();
        const index = users.findIndex((user) => user.id === id);
        if (index === -1) {
            return null;
        }
        users[index] = { ...users[index], ...changes, id };
        this.saveAll(users);
        return users[index];
    }

    /** @returns {string} a new unique identifier. */
    static createId() {
        return `u_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    }

    /**
     * Strips the credential fields so a record can be handed to the UI.
     * @param {object} user
     */
    static toPublic(user) {
        if (!user) {
            return null;
        }
        const { passwordHash, passwordSalt, ...safe } = user;
        return safe;
    }
}

export const userRepository = new UserRepository();
