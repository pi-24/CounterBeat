// Node resolve hook: Babylon's package ships extensionless deep imports that
// browsers/bundlers accept but Node's ESM resolver does not.
export async function resolve(specifier, context, next) {
    try {
        return await next(specifier, context);
    } catch (error) {
        if (error.code === 'ERR_MODULE_NOT_FOUND' && specifier.startsWith('@babylonjs/')) {
            for (const suffix of ['.js', '/index.js']) {
                try {
                    return await next(specifier + suffix, context);
                } catch { /* try the next form */ }
            }
        }
        throw error;
    }
}

// Vite lets the app import .json without an attribute; Node wants one.
export async function load(url, context, next) {
    if (url.endsWith('.json')) {
        return next(url, { ...context, importAttributes: { type: 'json' } });
    }
    return next(url, context);
}
