/**
 * login-page.js
 *
 * The login form.  Validation catches the shape of the input; the auth
 * service reports the two real failures - unknown email and wrong password -
 * against the field they belong to.
 */
import { initNavigation } from '../ui/Navigation.js';
import { Validator, rules } from '../core/Validator.js';
import { FormController } from '../ui/FormController.js';
import { auth } from '../core/AuthService.js';
import { Storage } from '../core/Storage.js';
import { toast } from '../ui/Toast.js';

initNavigation('login');

const validator = new Validator({
    email: [rules.required('Email address'), rules.email()],
    password: [rules.required('Password')],
});

const form = document.getElementById('loginForm');
const controller = new FormController(form, validator, async (values) => {
    const result = await auth.login(values.email, values.password);

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

if (!Storage.isAvailable()) {
    controller.showNotice(
        'This browser has local storage turned off, so there are no saved accounts to log in to.',
        'error',
    );
}

if (auth.isLoggedIn()) {
    controller.showNotice(
        `You are already logged in as ${auth.currentUser().displayName}. Logging in again will switch accounts.`,
        'info',
    );
}
