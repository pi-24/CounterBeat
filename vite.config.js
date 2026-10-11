import { defineConfig } from 'vite';
import { resolve } from 'node:path';

// A multi-page site: every HTML file at the root is an entry point.
const pages = ['index', 'game', 'how-to-play', 'register', 'login', 'rankings', 'profile'];

export default defineConfig({
    build: {
        target: 'es2022',
        rollupOptions: {
            input: Object.fromEntries(pages.map((page) => [page, resolve(import.meta.dirname, `${page}.html`)])),
        },
        chunkSizeWarningLimit: 2000,
    },
    server: { port: 5173 },
});
