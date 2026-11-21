/**
 * electron-store-capture.cjs - run by tools/capture-store-shots.mjs under Electron (not shipped).
 * Serves the built dist/ through the same app://counterbeat origin and preload bridge as the real
 * desktop shell, opens a 1920x1080 window and screenshots each ?atlas_scene= state.
 * The atlas hook keeps progress in memory: nothing is saved or submitted. Steam is forced off.
 */
const { app, BrowserWindow, ipcMain, protocol, net } = require('electron');
const { join, normalize, sep } = require('node:path');
const { pathToFileURL } = require('node:url');
const { writeFileSync, mkdirSync } = require('node:fs');
const { NullSteamService, API_METHODS } = require('../../electron/steam/NullSteamService.js');
const { registerSteamIpc } = require('../../electron/steam/ipc.js');
const { START_PAGE, APP_SCHEME, APP_URL } = require('../../electron/windowConfig.js');

const W = 1920;
const H = 1080;
const DIST = join(__dirname, '..', '..', 'dist');
const OUT = process.env.CB_SHOT_DIR;
const SHOTS = JSON.parse(process.env.CB_SHOTS);
app.commandLine.appendSwitch('force-device-scale-factor', '1');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.commandLine.appendSwitch('ignore-gpu-blocklist');
if (process.env.CB_SOFTWARE_GL === '1') {
    app.commandLine.appendSwitch('use-gl', 'angle');
    app.commandLine.appendSwitch('use-angle', 'swiftshader');
    app.commandLine.appendSwitch('enable-unsafe-swiftshader');
}
protocol.registerSchemesAsPrivileged([{ scheme: APP_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }]);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
    protocol.handle(APP_SCHEME, (req) => {
        let path = decodeURIComponent(new URL(req.url).pathname);
        if (path === '/') path = `/${START_PAGE}`;
        const file = normalize(join(DIST, path));
        if (!file.startsWith(DIST + sep)) return new Response('forbidden', { status: 403 });
        return net.fetch(pathToFileURL(file).toString());
    });
    registerSteamIpc(ipcMain, new NullSteamService('store capture'), {});
    ipcMain.on('cb:save:read', (e) => { e.returnValue = null; });
    ipcMain.on('cb:save:write', (e) => { e.returnValue = true; });
    ipcMain.on('cb:set-windowed', () => {});
    mkdirSync(OUT, { recursive: true });
    const errors = [];
    const win = new BrowserWindow({
        width: W, height: H, useContentSize: true, show: false, frame: false, backgroundColor: '#05070f',
        webPreferences: { preload: join(__dirname, '..', '..', 'electron', 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false },
    });
    win.setContentSize(W, H);
    win.webContents.on('console-message', (_e, level, message) => { if (level >= 3) errors.push(message); });
    for (const [name, scene, seed, t] of SHOTS) {
        await win.loadURL(`${APP_URL}/${START_PAGE}?atlas_scene=${scene}&atlas_seed=${seed}&atlas_t=${t}&atlas_clean=1`);
        for (let i = 0; i < 120; i++) {
            if (await win.webContents.executeJavaScript('window.__atlasReady === true')) break;
            await sleep(250);
        }
        // The real Play flow puts the stage fullscreen from a click, which sizes it to the screen. A capture window
        // must be exactly 1920x1080 whatever the monitor is, so the same `.stage:fullscreen` rule is applied by hand.
        await win.webContents.executeJavaScript(`(() => {
            const style = document.createElement('style');
            style.textContent = 'html,body{overflow:hidden!important}#stage{position:fixed!important;inset:0;width:100vw!important;height:100vh!important;border:0!important;border-radius:0!important;aspect-ratio:auto!important;z-index:9999}';
            document.head.appendChild(style);
            window.dispatchEvent(new Event('resize'));
        })()`);
        await sleep(2000);
        const image = await win.webContents.capturePage();
        const size = image.getSize();
        if (size.width !== W || size.height !== H) {
            // Never rescale: an upscaled or mis-framed capture must not pass the store size check.
            errors.push(`${name}: captured ${size.width}x${size.height}, needs exactly ${W}x${H} (check the display scale)`);
            continue;
        }
        writeFileSync(join(OUT, `${name}.png`), image.toPNG());
        console.log(`wrote ${name} (${size.width}x${size.height})`);
    }
    if (errors.length) console.error('console errors:', errors);
    app.exit(errors.length ? 1 : 0);
});
