/**
 * AuthService.js
 *
 * Registration, login, logout and "who is logged in" in one place.  The
 * current session is a separate local-storage key holding only the user id,
 * so signing out never touches the account records themselves.
 */
import { store } from './Storage.js';
import { userRepository, UserRepository } from './UserRepository.js';
import { PasswordHasher } from './PasswordHasher.js';

const SESSION_KEY = 'session';

export class AuthService {
    constructor(users = userRepository, storage = store) {
        this.users = users;
        this.storage = storage;
    }

    /**
     * @param {object} form the validated registration form values.
     * @returns {Promise<{ ok: boolean, user?: object, error?: string, field?: string }>}
     */
    async register(form) {
        const email = String(form.email).trim().toLowerCase();

        if (this.users.emailTaken(email)) {
            return { ok: false, field: 'email', error: 'An account already uses that email address.' };
        }
        if (this.users.displayNameTaken(form.displayName)) {
            return { ok: false, field: 'displayName', error: 'That display name is already taken.' };
        }

        const passwordSalt = PasswordHasher.createSalt();
        const passwordHash = await PasswordHasher.hash(form.password, passwordSalt);

        const user = this.users.add({
            id: UserRepository.createId(),
            displayName: String(form.displayName).trim(),
            email,
            passwordSalt,
            passwordHash,
            country: String(form.country ?? '').trim(),
            favouriteSensitivity: String(form.favouriteSensitivity ?? '').trim(),
            mainGame: String(form.mainGame ?? '').trim(),
            createdAt: new Date().toISOString(),
        });

        this.startSession(user.id);
        return { ok: true, user: UserRepository.toPublic(user) };
    }

    /**
     * @param {string} email
     * @param {string} password
     * @returns {Promise<{ ok: boolean, user?: object, error?: string, field?: string }>}
     */
    async login(email, password) {
        const user = this.users.findByEmail(email);
        if (!user) {
            return { ok: false, field: 'email', error: 'No account was found with that email address.' };
        }

        const correct = await PasswordHasher.verify(password, user.passwordSalt, user.passwordHash);
        if (!correct) {
            return { ok: false, field: 'password', error: 'That password is not correct.' };
        }

        this.startSession(user.id);
        return { ok: true, user: UserRepository.toPublic(user) };
    }

    /** @param {string} userId */
    startSession(userId) {
        this.storage.write(SESSION_KEY, { userId, startedAt: new Date().toISOString() });
    }

    logout() {
        this.storage.remove(SESSION_KEY);
    }

    /** @returns {object | null} the logged-in user without credentials. */
    currentUser() {
        const session = this.storage.read(SESSION_KEY, null);
        if (!session || !session.userId) {
            return null;
        }
        const user = this.users.findById(session.userId);
        if (!user) {
            // The account was removed underneath us: clear the stale session.
            this.logout();
            return null;
        }
        return UserRepository.toPublic(user);
    }

    /** @returns {boolean} */
    isLoggedIn() {
        return this.currentUser() !== null;
    }
}

export const auth = new AuthService();
