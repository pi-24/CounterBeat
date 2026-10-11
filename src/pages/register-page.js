/**
 * register-page.js
 *
 * Wires the registration form to the validator and the backend.  Every
 * message is shown inline next to the field it belongs to, or in the notice
 * strip at the top of the card.
 */
import { initNavigation } from '../ui/Navigation.js';
import { Validator, rules } from '../core/Validator.js';
import { FormController } from '../ui/FormController.js';
import { Storage } from '../core/Storage.js';
import { toast } from '../ui/Toast.js';
import { bindProviderButtons } from '../ui/providers.js';

const backend = await initNavigation('register');

const validator = new Validator({
    displayName: [
        rules.required('Display name'),
        rules.minLength('Display name', 3),
        rules.maxLength('Display name', 20),
        rules.displayName(),
    ],
    email: [rules.required('Email address'), rules.email()],
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
    mainGame: [rules.required('Main game')],
});

const form = document.getElementById('registerForm');
const controller = new FormController(form, validator, async (values) => {
    const result = await backend.register(values);

    if (!result.ok) {
        controller.showFieldError(result.field, result.error);
        controller.showNotice(result.error, 'error');
        return;
    }

    if (result.needsConfirmation) {
        controller.showNotice(
            'Account created. Check your inbox for the confirmation link, then log in.',
            'success',
        );
        form.querySelector('button[type="submit"]').disabled = true;
        return;
    }

    controller.showNotice(`Account created. Welcome, ${result.user.displayName}.`, 'success');
    toast.success('Account created — taking you to the game.');
    window.setTimeout(() => {
        window.location.href = 'game.html';
    }, 900);
});

controller.init();
bindProviderButtons(backend, document.getElementById('providerButtons'));

if (backend.kind === 'local' && !Storage.isAvailable()) {
    controller.showNotice(
        'This browser has local storage turned off, so accounts cannot be saved. Try a normal window rather than private browsing.',
        'error',
    );
}
