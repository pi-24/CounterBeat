/**
 * Validator.js
 *
 * Field-level validation rules plus a small Validator class that runs a
 * schema over a plain object and returns a map of field -> error message.
 * All validation on this site is done here in JavaScript; the forms use
 * `novalidate` so the browser never shows its own bubbles.
 */

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;
const NAME_PATTERN = /^[A-Za-z0-9 _.-]+$/;

/**
 * A rule is a function that receives the field value and the whole form
 * object, and returns either an error message or null when the value is
 * acceptable.
 * @typedef {(value: string, form: Record<string, string>) => (string | null)} Rule
 */

export const rules = {
    /** @returns {Rule} */
    required(label) {
        return (value) => (String(value ?? '').trim() === '' ? `${label} is required.` : null);
    },

    /** @returns {Rule} */
    minLength(label, min) {
        return (value) => (String(value).trim().length < min
            ? `${label} must be at least ${min} characters.`
            : null);
    },

    /** @returns {Rule} */
    maxLength(label, max) {
        return (value) => (String(value).trim().length > max
            ? `${label} must be ${max} characters or fewer.`
            : null);
    },

    /** @returns {Rule} */
    pattern(regex, message) {
        return (value) => (regex.test(String(value).trim()) ? null : message);
    },

    /** @returns {Rule} */
    email() {
        return rules.pattern(EMAIL_PATTERN, 'Enter a valid email address, for example you@example.com.');
    },

    /** @returns {Rule} */
    displayName() {
        return rules.pattern(NAME_PATTERN, 'Use letters, numbers, spaces, dots, hyphens or underscores only.');
    },

    /** @returns {Rule} */
    strongPassword() {
        return (value) => {
            const text = String(value);
            if (!/[A-Za-z]/.test(text)) {
                return 'Password must contain at least one letter.';
            }
            if (!/[0-9]/.test(text)) {
                return 'Password must contain at least one number.';
            }
            return null;
        };
    },

    /** @returns {Rule} */
    matches(otherField, message) {
        return (value, form) => (String(value) === String(form[otherField] ?? '') ? null : message);
    },

    /**
     * Async-free uniqueness check driven by a lookup function.
     * @param {(value: string) => boolean} isTaken
     * @param {string} message
     * @returns {Rule}
     */
    unique(isTaken, message) {
        return (value) => (isTaken(String(value).trim()) ? message : null);
    },
};

export class Validator {
    /**
     * @param {Record<string, Rule[]>} schema field name -> ordered rule list.
     */
    constructor(schema) {
        this.schema = schema;
    }

    /**
     * Validates a single field and returns the first failing message.
     * @param {string} field
     * @param {Record<string, string>} form
     * @returns {string | null}
     */
    validateField(field, form) {
        const fieldRules = this.schema[field] ?? [];
        for (const rule of fieldRules) {
            const message = rule(form[field] ?? '', form);
            if (message) {
                return message;
            }
        }
        return null;
    }

    /**
     * Validates every field in the schema.
     * @param {Record<string, string>} form
     * @returns {{ valid: boolean, errors: Record<string, string> }}
     */
    validate(form) {
        const errors = {};
        for (const field of Object.keys(this.schema)) {
            const message = this.validateField(field, form);
            if (message) {
                errors[field] = message;
            }
        }
        return { valid: Object.keys(errors).length === 0, errors };
    }
}
