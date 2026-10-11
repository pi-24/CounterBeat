/**
 * login-page.js
 *
 * The login form.  Validation catches the shape of the input; the backend
 * reports the real failures against the field they belong to.
 */
import { initNavigation } from '../ui/Navigation.js';
import { Validator, rules } from '../core/Validator.js';
import { FormController } from '../ui/FormController.js';
import { Storage } from '../core/Storage.js';
import { toast } from '../ui/Toast.js';
import { bindProviderButtons } from '../ui/providers.js';

const backend = await initNavigation('login');

const validator = new Validator({
    email: [rules.required('Email address'), rules.email()],
    password: [rules.required('Password')],
});

const form = document.getElementById('loginForm');
const controller = new FormController(form, validator, async (values) => {
    const result = await backend.login(values.email, values.password);

    if (!result.ok) {
        controller.showFieldError(result.field, result.error);
        controller.showNotice(result.error, 'error');
        return;
    }

    controller.showNotice(`Welcome back, ${result.user.displayName}.`, 'success');
    toast.success('Logged in.');
    window.setTimeout(() => {
        window.location.href = 'game.html';
    }, 700);
});

controller.init();
bindProviderButtons(backend, document.getElementById('providerButtons'));

if (backend.kind === 'local' && !Storage.isAvailable()) {
    controller.showNotice(
        'This browser has local storage turned off, so there are no saved accounts to log in to.',
        'error',
    );
}

const current = backend.currentUser();
if (current) {
    controller.showNotice(
        `You are already logged in as ${current.displayName}. Logging in again will switch accounts.`,
        'info',
    );
}
