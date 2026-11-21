/**
 * measure-load.mjs - reproducible time-to-main-menu under Chrome's "Fast 3G"
 * network preset (DevTools protocol, headless Chrome, build served over local http,
 * cache disabled, text assets gzipped like a real host).
 *
 *   node tools/measure-load.mjs <dist-dir> [runs=5]
 *   node tools/measure-load.mjs --compare <baseline-sha> [runs=5]   builds the baseline and the working tree, prints both
 *
 * Two times are reported per run, and only the second is "main menu":
 *   splash  = navigation start -> the Play splash is visible (a static page; not the menu)
 *   menu    = navigation start -> the REAL main menu is interactive: the start click has been
 *             processed (the script clicks Play the moment the splash shows, as a player would),
 *             the start overlay is hidden and the menu overlay is shown.  MenuScreen.enter also
 *             sets performance.mark('cb-menu-ready') in current builds.
 * The median of the runs is reported.
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { mkdtempSync, symlinkSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { resolve, extname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { gzipSync } from 'node:zlib';
import { launchPage } from './lib/cdp.mjs';

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.ogg': 'audio/ogg', '.mp3': 'audio/mpeg', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
// DevTools "Fast 3G" preset.
const THROTTLE = { offline: false, latency: 562.5, downloadThroughput: (1.6 * 1024 * 1024 / 8) * 0.9, uploadThroughput: (750 * 1024 / 8) * 0.9 };

const PROBE = `(() => {
  const vis = (id) => { const e = document.getElementById(id); return !!e && !e.hidden; };
  const btn = document.querySelector('#startOverlay [data-action="start-play"]');
  return { loadingHidden: !vis('loadingOverlay'), splash: vis('startOverlay'), menu: vis('menuOverlay'), clickable: !!btn };
})()`;

function serve(dir) {
    return createServer(async (req, res) => {
        const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
        try {
            let body = await readFile(join(dir, path === '/' ? 'index.html' : path));
            const headers = { 'content-type': types[extname(path)] ?? 'application/octet-stream', 'cache-control': 'no-store' };
            if (/\.(html|js|css|json|svg)$/.test(path) && /gzip/.test(req.headers['accept-encoding'] ?? '')) { body = gzipSync(body); headers['content-encoding'] = 'gzip'; }
            headers['content-length'] = body.length;
            res.writeHead(200, headers);
            res.end(body);
        } catch { res.writeHead(404).end(); }
    }).listen(0);
}

async function once(port) {
    const page = await launchPage();
    try {
        await page.send('Network.enable');
        await page.send('Network.setCacheDisabled', { cacheDisabled: true });
        await page.send('Network.emulateNetworkConditions', THROTTLE);
        const t0 = Date.now();
        await page.send('Page.navigate', { url: `http://localhost:${port}/game.html` });
        let splash = null, menu = null, clicked = false;
        while (Date.now() - t0 < 120000) {
            await new Promise((r) => setTimeout(r, 25));
            const { result } = await page.send('Runtime.evaluate', { expression: PROBE, returnByValue: true });
            const s = result?.result?.value;
            if (!s) continue;
            if (splash === null && s.splash && s.loadingHidden) splash = Date.now() - t0;
            if (splash !== null && !clicked && s.clickable) {
                clicked = true;
                await page.send('Runtime.evaluate', { expression: 'document.querySelector(\'#startOverlay [data-action="start-play"]\').click()' });
            }
            if (clicked && !s.splash && s.menu) { menu = Date.now() - t0; break; }
        }
        return { splash, menu };
    } finally { page.close(); }
}

const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

export async function measure(dir, runs) {
    const server = serve(dir);
    if (!server.listening) await new Promise((r) => server.once('listening', r));
    const out = [];
    for (let i = 0; i < runs; i++) {
        out.push(await once(server.address().port));
        console.log(`  run ${i + 1}: splash ${out[i].splash} ms, main menu ${out[i].menu} ms`);
    }
    server.close();
    return { splash: median(out.map((r) => r.splash)), menu: median(out.map((r) => r.menu)), runs: out };
}

const args = process.argv.slice(2);
if (args[0] === '--compare') {
    const sha = args[1];
    const runs = Number(args[2] ?? 5);
    const root = resolve('.');
    const tmp = mkdtempSync(join(tmpdir(), 'cb-baseline-'));
    execSync(`git archive ${sha} | tar -x -C "${tmp}"`, { stdio: 'inherit', shell: true });
    symlinkSync(resolve(root, 'node_modules'), join(tmp, 'node_modules'), 'junction');
    execSync('npx vite build', { cwd: tmp, stdio: 'inherit' });
    execSync('npx vite build', { cwd: root, stdio: 'inherit' });
    console.log(`before (${sha})`);
    const before = await measure(join(tmp, 'dist'), runs);
    console.log('after (working tree)');
    const after = await measure(resolve(root, 'dist'), runs);
    console.log(`median splash:    before ${before.splash} ms, after ${after.splash} ms (a static page, NOT the menu)`);
    console.log(`median main menu: before ${before.menu} ms, after ${after.menu} ms, reduction ${((1 - after.menu / before.menu) * 100).toFixed(1)}%`);
    process.exit(0);
} else if (args.length) {
    const dir = resolve(args[0]);
    if (!existsSync(dir)) throw new Error(`no such dir ${dir}`);
    const r = await measure(dir, Number(args[1] ?? 5));
    console.log(`median splash ${r.splash} ms, median main menu ${r.menu} ms`);
    process.exit(0);
}
