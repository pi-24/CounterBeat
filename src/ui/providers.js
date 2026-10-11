/**
 * providers.js
 *
 * Renders "Continue with …" buttons for whichever OAuth providers the
 * backend offers.  The local backend offers none, so the container simply
 * stays empty there.
 */
const LABELS = { discord: 'Continue with Discord' };

/**
 * @param {import('../core/backend/Backend.js').Backend} backend
 * @param {HTMLElement|null} container
 */
export function bindProviderButtons(backend, container) {
    if (!container || backend.providers.length === 0) {
        return;
    }
    container.hidden = false;
    for (const provider of backend.providers) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = `btn btn--ghost btn--block btn--${provider}`;
        button.textContent = LABELS[provider] ?? `Continue with ${provider}`;
        button.addEventListener('click', async () => {
            button.disabled = true;
            const result = await backend.loginWithProvider(provider);
            if (!result.ok) {
                button.disabled = false;
                console.warn(result.error);
            }
        });
        container.append(button);
    }
}
