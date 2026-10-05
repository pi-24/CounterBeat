/**
 * register-page.js
 *
 * Wires the registration form to the validator and the auth service.  Every
 * message is shown inline next to the field it belongs to, or in the notice
 * strip at the top of the card - the brief rules out alert() entirely.
 */
import { initNavigation } from '../ui/Navigation.js';
import { Validator, rules } from '../core/Validator.js';
import { FormController } from '../ui/FormController.js';
import { auth } from '../core/AuthService.js';
import { userRepository } from '../core/UserRepository.js';
import { Storage } from '../core/Storage.js';
import { toast } from '../ui/Toast.js';

initNavigation('register');

const validator = new Validator({
    displayName: [
        rules.required('Display name'),
        rules.minLength('Display name', 3),
        rules.maxLength('Display name', 20),
        rules.displayName(),
        rules.unique((value) => userRepository.displayNameTaken(value), 'That display name is already taken.'),
    ],
    email: [
        rules.required('Email address'),
        rules.email(),
        rules.unique((value) => userRepository.emailTaken(value), 'An account already uses that email address.'),
    ],
    password: [
        rules.required('Password'),
        rules.minLength('Password', 8),
        rules.maxLength('Password', 64),
        rules.strongPassword(),
    ],
    confirmPassword: [
        rules.required('Password confirmation'),
        rules.matches('password', 'The two passwords do not match.'),
    ],
    country: [rules.required('Country')],
    favouriteSensitivity: [rules.required('Preferred difficulty')],
    mainGame: [rules.required('Main game')],
});

const form = document.getElementById('registerForm');
const controller = new FormController(form, validator, async (values) => {
    const result = await auth.register(values);

    if (!result.ok) {
        controller.showFieldError(result.field, result.error);
        controller.showNotice(result.error, 'error');
        return;
    }

    controller.showNotice(`Account created. Welcome, ${result.user.displayName}.`, 'success');
    toast.success('Account created — taking you to the game.');
    window.setTimeout(() => {
        window.location.href = 'game.html';
    }, 900);
});

controller.init();

if (!Storage.isAvailable()) {
    controller.showNotice(
        'This browser has local storage turned off, so accounts cannot be saved. Try a normal window rather than private browsing.',
        'error',
    );
}
