import { defineConfig } from 'vite';
import { resolve } from 'node:path';

// A multi-page site: every HTML file at the root is an entry point.
const pages = ['index', 'game', 'how-to-play', 'register', 'login', 'rankings', 'profile'];

/**
 * game.html imports GameApp dynamically behind the Play splash.  Preload that chunk (and its static imports)
 * from the HTML so it downloads in parallel with the entry script instead of one round trip after it (AC19).
 */
function preloadGameApp() {
    return {
        name: 'preload-game-app',
        transformIndexHtml: {
            order: 'post',
            handler(html, ctx) {
                if (!ctx.bundle || !/game\.html$/.test(ctx.filename ?? '')) return html;
                const seen = new Set();
                const walk = (name) => {
                    const chunk = ctx.bundle[name];
                    if (!chunk || chunk.type !== 'chunk' || seen.has(name)) return;
                    seen.add(name);
                    chunk.imports.forEach(walk);
                };
                const app = Object.values(ctx.bundle).find((c) => c.type === 'chunk' && /GameApp\.js$/.test(c.facadeModuleId ?? ''));
                if (!app) return html;
                walk(app.fileName);
                const tags = [...seen].filter((n) => !html.includes(n))
                    .map((n) => `  <link rel="modulepreload" crossorigin href="/${n}">`).join('\n');
                return html.replace('</head>', `${tags}\n</head>`);
            },
        },
    };
}

export default defineConfig({
    plugins: [preloadGameApp()],
    build: {
        target: 'es2022',
        rollupOptions: {
            input: Object.fromEntries(pages.map((page) => [page, resolve(import.meta.dirname, `${page}.html`)])),
        },
        chunkSizeWarningLimit: 2000,
    },
    server: { port: 5173 },
});
