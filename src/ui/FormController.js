/**
 * FormController.js
 *
 * Binds a Validator to a <form>: reads the values, shows per-field messages
 * inline (never with alert()), validates a field again as soon as the user
 * leaves it or corrects it, and only calls the submit handler once the whole
 * form passes.
 */
export class FormController {
    /**
     * @param {HTMLFormElement} form
     * @param {import('../core/Validator.js').Validator} validator
     * @param {(values: Record<string, string>) => Promise<void> | void} onSubmit
     */
    constructor(form, validator, onSubmit) {
        this.form = form;
        this.validator = validator;
        this.onSubmit = onSubmit;
        this.submitted = false;
        this.notice = document.getElementById('formNotice');
        this.noticeText = document.getElementById('formNoticeText');
    }

    init() {
        for (const field of Object.keys(this.validator.schema)) {
            const input = this.form.elements.namedItem(field);
            if (!(input instanceof HTMLElement)) {
                continue;
            }
            input.addEventListener('blur', () => this.checkField(field));
            input.addEventListener('input', () => {
                if (this.submitted || this.wrapperFor(field)?.classList.contains('field--invalid')) {
                    this.checkField(field);
                }
            });
            if (input instanceof HTMLSelectElement) {
                input.addEventListener('change', () => this.checkField(field));
            }
        }

        this.form.addEventListener('submit', (event) => {
            event.preventDefault();
            this.handleSubmit();
        });
    }

    /** @returns {Record<string, string>} the current form values. */
    values() {
        const data = new FormData(this.form);
        const out = {};
        for (const [key, value] of data.entries()) {
            out[key] = typeof value === 'string' ? value : '';
        }
        return out;
    }

    /** @param {string} field */
    wrapperFor(field) {
        return this.form.querySelector(`[data-field="${field}"]`);
    }

    /** @param {string} field */
    checkField(field) {
        const message = this.validator.validateField(field, this.values());
        this.showFieldError(field, message);
        return message === null;
    }

    /**
     * @param {string} field
     * @param {string | null} message
     */
    showFieldError(field, message) {
        const wrapper = this.wrapperFor(field);
        const errorNode = this.form.querySelector(`[data-error-for="${field}"]`);
        const input = this.form.elements.namedItem(field);

        if (errorNode) {
            errorNode.textContent = message ?? '';
        }
        if (wrapper) {
            wrapper.classList.toggle('field--invalid', Boolean(message));
            wrapper.classList.toggle('field--valid', !message && String(this.values()[field] ?? '').trim() !== '');
        }
        if (input instanceof HTMLElement) {
            input.setAttribute('aria-invalid', message ? 'true' : 'false');
        }
    }

    /** @param {Record<string, string>} errors */
    showErrors(errors) {
        for (const field of Object.keys(this.validator.schema)) {
            this.showFieldError(field, errors[field] ?? null);
        }
        const firstField = Object.keys(errors)[0];
        if (firstField) {
            const input = this.form.elements.namedItem(firstField);
            if (input instanceof HTMLElement) {
                input.focus();
            }
        }
    }

    /**
     * @param {string | null} message
     * @param {'error'|'success'|'info'} [variant]
     */
    showNotice(message, variant = 'error') {
        if (!this.notice || !this.noticeText) {
            return;
        }
        if (!message) {
            this.notice.hidden = true;
            return;
        }
        this.notice.className = `notice notice--${variant}`;
        this.noticeText.textContent = message;
        this.notice.hidden = false;
    }

    /** Disables the submit button while an async handler is running. */
    setBusy(busy) {
        const button = this.form.querySelector('button[type="submit"]');
        if (button instanceof HTMLButtonElement) {
            button.disabled = busy;
            button.textContent = busy ? 'Please wait…' : button.dataset.label ?? button.textContent;
        }
    }

    async handleSubmit() {
        this.submitted = true;
        this.showNotice(null);

        const values = this.values();
        const { valid, errors } = this.validator.validate(values);
        this.showErrors(errors);

        if (!valid) {
            const count = Object.keys(errors).length;
            this.showNotice(`Please fix ${count} ${count === 1 ? 'field' : 'fields'} below before continuing.`);
            return;
        }

        const button = this.form.querySelector('button[type="submit"]');
        if (button instanceof HTMLButtonElement && !button.dataset.label) {
            button.dataset.label = button.textContent ?? 'Submit';
        }

        this.setBusy(true);
        try {
            await this.onSubmit(values);
        } finally {
            this.setBusy(false);
        }
    }
}
