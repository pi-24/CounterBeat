import test from 'node:test';
import assert from 'node:assert/strict';
import { validateAll, loadManifest, hexToRgb } from '../../tools/validate-assets.mjs';
import { AssetProvider } from '../../src/game/providers/AssetProvider.js';
import { TrackProvider } from '../../src/game/providers/TrackProvider.js';
import { ThemeProvider } from '../../src/game/providers/ThemeProvider.js';
import { FeedbackBus } from '../../src/game/providers/FeedbackBus.js';
import { TRACKS, ARENAS } from '../../src/game/rules/charts.js';

const m = () => ({
    tracks: loadManifest('tracks.json'), themes: loadManifest('themes.json'),
    targets: loadManifest('targets.json'), crosshairs: loadManifest('crosshairs.json'),
});
const providers = () => {
    const x = m();
    return {
        x, assets: new AssetProvider(x.targets, x.tracks), tracks: new TrackProvider(x.tracks),
        themes: new ThemeProvider(x.themes, x.targets, x.crosshairs),
    };
};

test('real manifests validate with no errors', () => {
    assert.deepEqual(validateAll(), []);
});

test('counts and star-cost fields', () => {
    const { x } = providers();
    assert.ok(x.crosshairs.crosshairs.length >= 10);
    assert.equal(x.themes.themes.length, 3);
    assert.equal(x.targets.targets.length, 3);
    for (const e of [...x.crosshairs.crosshairs, ...x.themes.themes, ...x.targets.targets]) assert.equal(typeof e.starCost, 'number');
});

test('manifest tracks match the rules TRACKS and arenas', () => {
    const { tracks, themes } = providers();
    for (const t of TRACKS) {
        const e = tracks.get(t.id);
        assert.ok(e, t.id);
        assert.equal(e.bpm, t.bpm);
        assert.equal(e.bars, t.bars);
        assert.equal(e.seed, t.seed);
        assert.equal(e.arena, t.arena);
    }
    for (const a of Object.values(ARENAS)) assert.ok(themes.theme(a.theme));
});

test('providers resolve from the manifest, so swapping is a manifest edit', () => {
    const { x } = providers();
    x.tracks.tracks[0].audio = ['audio/other.ogg'];
    x.targets.spark.path = 'images/other.png';
    assert.deepEqual(new TrackProvider(x.tracks).musicUrls(x.tracks.tracks[0].id), ['audio/other.ogg']);
    assert.equal(new AssetProvider(x.targets, x.tracks).spark(), 'images/other.png');
});

test('provider lookups and unlock filtering', () => {
    const { themes, tracks, assets } = providers();
    assert.throws(() => themes.theme('nope'));
    assert.throws(() => tracks.musicUrls('nope'));
    assert.equal(themes.target('missing').id, 'bot');
    assert.equal(themes.resolveArena({ theme: 'neon', accent: [1, 0, 0] }).accent[0], 1);
    assert.ok(themes.unlocked('crosshairs', 0).length >= 1);
    assert.ok(themes.unlocked('crosshairs', 999).length >= 10);
    assert.ok('sfx-shot' in assets.audioManifest() && 'music-menu' in assets.audioManifest());
});

test('validator catches bad manifests', () => {
    const bad = m();
    bad.crosshairs.crosshairs = bad.crosshairs.crosshairs.slice(0, 3);
    bad.tracks.tracks[0].placeholder = false; delete bad.tracks.tracks[0].licence;
    bad.themes.themes[0].floorTexture = 'images/missing.png';
    bad.targets.targets[1].starCost = 'x';
    bad.themes.palette.colours = ['#ffffff'];
    const errors = validateAll({ manifests: bad });
    for (const needle of ['at least 10', 'licence', 'not found', 'starCost', 'palette']) {
        assert.ok(errors.some((e) => e.includes(needle)), needle);
    }
});

test('palette check rejects an off-palette image', () => {
    const bad = m();
    bad.themes.palette.colours = ['#ff00ff', '#ff00ee', '#ee00ff'];
    bad.themes.palette.tolerance = 0.05;
    assert.ok(validateAll({ manifests: bad }).some((e) => e.includes('off-palette')));
    assert.deepEqual(hexToRgb('#ff0080'), [255, 0, 128]);
});

test('FeedbackBus delivers, unsubscribes and isolates failures', () => {
    const bus = new FeedbackBus(); const got = [];
    const off = bus.on('hit', (p) => got.push(p));
    bus.on('hit', () => { throw new Error('x'); });
    const orig = console.error; console.error = () => {};
    bus.emit('hit', 1); off(); bus.emit('hit', 2);
    console.error = orig;
    assert.deepEqual(got, [1]);
});

test('target skins are distinct images and a skin id selects its entry', () => {
    const { x, themes } = providers();
    const sheets = new Set(x.targets.targets.map((t) => t.sheet));
    assert.equal(sheets.size, x.targets.targets.length);
    for (const t of x.targets.targets) assert.equal(themes.target(t.id).sheet, t.sheet);
});

test('unknown skin ids fall back with a single warning; resolveArena is cached', () => {
    const { themes } = providers();
    const warns = []; const orig = console.warn; console.warn = (w) => warns.push(w);
    themes.target('typo'); themes.target('typo'); themes.crosshair('typo2');
    console.warn = orig;
    assert.equal(warns.length, 2);
    const arena = { theme: 'neon' };
    assert.equal(themes.resolveArena(arena), themes.resolveArena(arena));
});

test('localised off-palette pixels fail the outlier rule even when the mean passes', () => {
    const bad = m();
    bad.themes.palette.maxOutlierFraction = 0;
    bad.themes.palette.pixelTolerance = 0.05;
    assert.ok(validateAll({ manifests: bad }).some((e) => e.includes('pixels beyond')));
});

test('Settings accepts a targetSkin id', async () => {
    globalThis.window ??= { localStorage: { getItem: () => null, setItem() {}, removeItem() {} }, addEventListener() {} };
    const { Settings } = await import('../../src/game/Settings.js');
    assert.equal(Settings.sanitise({ targetSkin: 'bot-hex' }).targetSkin, 'bot-hex');
    assert.equal(Settings.sanitise({ targetSkin: '../x' }).targetSkin, undefined);
});
