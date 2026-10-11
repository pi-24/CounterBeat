/**
 * monitoring.js
 *
 * Optional error reporting.  When VITE_SENTRY_DSN is set the Sentry SDK is
 * loaded lazily (it lives in its own chunk, so players on a build without a
 * DSN never download it) and uncaught errors and rejected promises are
 * reported with the page and backend kind as tags.  Without a DSN this is a
 * no-op, so the game runs identically in development.
 */

/**
 * @param {object} context
 * @param {string} context.page the page key, e.g. 'game'
 * @param {string} [context.backend] 'local' or 'supabase'
 */
export async function initMonitoring({ page, backend }) {
    const dsn = import.meta.env.VITE_SENTRY_DSN;
    if (!dsn) {
        return;
    }
    try {
        const Sentry = await import('@sentry/browser');
        Sentry.init({
            dsn,
            release: import.meta.env.VITE_APP_VERSION || undefined,
            environment: import.meta.env.MODE,
            // Keep the payloads small: no session replay, light tracing.
            tracesSampleRate: 0.1,
            sendDefaultPii: false,
        });
        Sentry.setTag('page', page);
        if (backend) {
            Sentry.setTag('backend', backend);
        }
    } catch (error) {
        console.warn('Error reporting could not start', error);
    }
}
