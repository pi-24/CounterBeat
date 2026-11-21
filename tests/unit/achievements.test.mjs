import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { AchievementTracker, ACHIEVEMENT_EVENTS } from '../../src/progress/AchievementTracker.js';
import { FeedbackBus } from '../../src/game/providers/FeedbackBus.js';

const root = new URL('../../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const read = (p) => readFileSync(join(root, p), 'utf8');
const manifest = JSON.parse(read('data/achievements.json'));
const list = manifest.achievements;
const Tracker = class extends AchievementTracker {
    constructor(bus, storage, steam = null) { super(bus, storage, steam, list); }
};

const memStore = () => {
    const m = new Map();
    return { read: (k, f) => (m.has(k) ? JSON.parse(m.get(k)) : f), write: (k, v) => m.set(k, JSON.stringify(v)) };
};
const fakeSteam = (available = true) => {
    const calls = [];
    return { calls, getStatus: () => ({ available }), unlockAchievement: (n) => { calls.push(n); return true; } };
};

test('manifest schema: at least 12 unique, well-formed achievements', () => {
    assert.ok(list.length >= 12);
    assert.equal(new Set(list.map((a) => a.id)).size, list.length);
    assert.equal(new Set(list.map((a) => a.steamApiName)).size, list.length);
    for (const a of list) {
        for (const k of ['id', 'steamApiName', 'name', 'description']) assert.equal(typeof a[k], 'string', `${a.id}.${k}`);
        assert.match(a.steamApiName, /^ACH_[A-Z0-9_]+$/);
        assert.equal(typeof a.trigger.event, 'string');
        assert.ok(Number.isInteger(a.trigger.threshold) && a.trigger.threshold >= 1);
    }
});

test('every Steam API name is allow-listed in data/steam.json', () => {
    const allowed = new Set(JSON.parse(read('data/steam.json')).achievements);
    for (const a of list) assert.ok(allowed.has(a.steamApiName), a.steamApiName);
});

function sourceFiles(dir, out = []) {
    for (const f of readdirSync(join(root, dir))) {
        const p = `${dir}/${f}`;
        if (statSync(join(root, p)).isDirectory()) sourceFiles(p, out);
        else if (/\.(js|mjs|ts)$/.test(f)) out.push(p);
    }
    return out;
}

test('each trigger maps to an event that is really emitted', () => {
    const emitted = new Set();
    for (const f of sourceFiles('src')) {
        for (const m of read(f).matchAll(/feedbackBus\.emit\(\s*'([A-Za-z]+)'/g)) emitted.add(m[1]);
    }
    for (const a of list) {
        assert.ok(ACHIEVEMENT_EVENTS.includes(a.trigger.event), `${a.id} event not declared`);
        assert.ok(emitted.has(a.trigger.event), `${a.id}: "${a.trigger.event}" is never emitted`);
    }
});

test('covers the required milestones', () => {
    const events = (e) => list.filter((a) => a.trigger.event === e);
    assert.ok(events('tutorialComplete').length);
    assert.ok(events('practiceLoopPass').length);
    assert.ok(list.some((a) => a.trigger.where?.rank === 'S'));
    assert.ok(list.some((a) => a.trigger.where?.difficulty === 'expert'));
    assert.ok(events('starsChanged').length >= 2);
});

test('unlock is idempotent and persists', async () => {
    const bus = new FeedbackBus();
    const storage = memStore();
    const steam = fakeSteam();
    const t = new Tracker(bus, storage, steam);
    bus.emit('runComplete', { passed: true, rank: 'S', difficulty: 'normal', completed: true, fullCombo: false });
    bus.emit('runComplete', { passed: true, rank: 'S', difficulty: 'normal', completed: true, fullCombo: false });
    assert.equal(steam.calls.filter((n) => n === 'ACH_FIRST_CLEAR').length, 1);
    assert.equal(steam.calls.filter((n) => n === 'ACH_FIRST_S_RANK').length, 1);
    assert.ok(t.isUnlocked('first_clear'));
    await new Promise((r) => setTimeout(r, 0));
    // a fresh tracker from the same storage does not re-send
    const steam2 = fakeSteam();
    new Tracker(new FeedbackBus(), storage, steam2);
    const bus2 = new FeedbackBus();
    new Tracker(bus2, storage, steam2);
    bus2.emit('runComplete', { passed: true, rank: 'S', difficulty: 'normal', completed: true });
    assert.deepEqual(steam2.calls, []);
});

test('thresholds: counted and field-based triggers', () => {
    const bus = new FeedbackBus();
    const steam = fakeSteam();
    const t = new Tracker(bus, memStore(), steam);
    for (let i = 0; i < 99; i++) bus.emit('hit', { headshot: true });
    bus.emit('hit', { headshot: false });
    assert.ok(!t.isUnlocked('headshots_100'));
    bus.emit('hit', { headshot: true });
    assert.ok(t.isUnlocked('headshots_100'));
    bus.emit('starsChanged', { total: 12 });
    assert.ok(t.isUnlocked('stars_10') && !t.isUnlocked('stars_25'));
    bus.emit('runComplete', { passed: true, difficulty: 'expert', rank: 'B', completed: true });
    assert.ok(t.isUnlocked('expert_clear') && !t.isUnlocked('hard_clear'));
});

test('earned unlocks stay pending without Steam, flush on attach, retry when unavailable', async () => {
    const bus = new FeedbackBus();
    const t = new Tracker(bus, memStore(), null);
    bus.emit('tutorialComplete', {});
    bus.emit('practiceLoopPass', {});
    assert.equal(t.pending.length, 2);
    const steam = fakeSteam();
    t.attachSteam(steam);
    assert.deepEqual(steam.calls.sort(), ['ACH_PRACTICE_LOOP', 'ACH_TUTORIAL_COMPLETE']);
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(t.pending.length, 0);
    t.attachSteam(steam); // already delivered: no resend
    assert.equal(steam.calls.length, 2);

    // Steam unavailable: not burned, delivered once it is up
    const t2 = new Tracker(new FeedbackBus(), memStore(), null);
    t2.handle('perfectStop', {});
    const off = fakeSteam(false);
    t2.attachSteam(off);
    assert.deepEqual(off.calls, []);
    assert.equal(t2.pending.length, 1);
    const on = fakeSteam(true);
    t2.attachSteam(on);
    assert.deepEqual(on.calls, ['ACH_FIRST_PERFECT_STOP']);
});

test('a refused unlock (false) stays pending and is retried next session', async () => {
    const storage = memStore();
    const refuse = { getStatus: async () => ({ available: true }), unlockAchievement: async () => false };
    const bus = new FeedbackBus();
    const t = new Tracker(bus, storage, refuse);
    bus.emit('tutorialComplete', {});
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(t.pending.length, 1);
    t.persist();
    const steam = fakeSteam();
    new Tracker(new FeedbackBus(), storage, steam);
    assert.deepEqual(steam.calls, ['ACH_TUTORIAL_COMPLETE']);
});

test('steam may be a getter resolved late (bridge injected after construction)', () => {
    let bridge = null;
    const bus = new FeedbackBus();
    const t = new Tracker(bus, memStore(), () => bridge);
    bus.emit('tutorialComplete', {});
    assert.equal(t.pending.length, 1);
    const steam = fakeSteam();
    bridge = steam;
    bus.emit('runComplete', { passed: false }); // run end retries
    assert.deepEqual(steam.calls, ['ACH_TUTORIAL_COMPLETE']);
});

test('counters do not write storage per shot', () => {
    const bus = new FeedbackBus();
    let writes = 0;
    const base = memStore();
    const storage = { read: base.read, write: (k, v) => { writes++; base.write(k, v); } };
    const t = new Tracker(bus, storage, null);
    for (let i = 0; i < 50; i++) bus.emit('hit', { headshot: true });
    assert.equal(writes, 0);
    t.persist();
    assert.equal(writes, 1);
});

test('GameApp wiring: explicit option, late getter, steam-ready flush, pagehide persist', () => {
    const src = read('src/game/GameApp.js');
    assert.match(src, /options\.achievements \?\? !this\.skipStart/);
    assert.match(src, /\(\) => globalThis\.counterbeatDesktop\?\.steam/);
    assert.match(src, /counterbeat-steam-ready/);
    assert.match(src, /pagehide/);
    assert.match(read('src/pages/game-page.js'), /achievements: !atlasParams/);
});

test('payload contract: every where/field key is literally produced by the real emit', () => {
    const emitBody = (src, ev) => {
        const m = src.match(new RegExp(`feedbackBus\\.emit\\(\\s*'${ev}'\\s*,\\s*\\{([^}]*)\\}`));
        assert.ok(m, `no literal emit of ${ev}`);
        return m[1];
    };
    const result = read('src/game/screens/ResultScreen.js');
    const play = read('src/game/screens/PlayScreen.js');
    for (const a of list) {
        const t = a.trigger;
        if (t.event === 'tutorialComplete') continue;
        const src = ['runComplete', 'starsChanged'].includes(t.event) ? result : play;
        const body = emitBody(src, t.event);
        for (const k of [...Object.keys(t.where ?? {}), ...(t.field ? [t.field] : [])]) {
            assert.match(body, new RegExp(`\\b${k}\\b`), `${a.id}: emit of ${t.event} lacks "${k}"`);
        }
    }
});

test('payload values: difficulty ids, rank letters and types match real producers', async () => {
    const { DIFFICULTIES } = await import('../../src/game/rules/charts.js');
    const ids = DIFFICULTIES.map((d) => d.id);
    const scorer = read('src/game/rules/Scorer.js');
    for (const a of list) {
        const w = a.trigger.where ?? {};
        if ('difficulty' in w) assert.ok(ids.includes(w.difficulty), `${a.id}: difficulty "${w.difficulty}"`);
        if ('rank' in w) assert.match(scorer, new RegExp(`return '${w.rank}'`), `${a.id}: rank ${w.rank}`);
        for (const k of ['passed', 'completed', 'fullCombo', 'headshot']) if (k in w) assert.equal(typeof w[k], 'boolean');
    }
});

test('Expert runs reach the runComplete emit: every non-practice mode earns rewards', async () => {
    const { earnsRewards } = await import('../../src/game/modes/practice.js');
    for (const m of ['campaign', 'quickPlay', 'daily', 'ranked']) assert.ok(earnsRewards(m), m);
    assert.ok(!earnsRewards('practice'));
    const result = read('src/game/screens/ResultScreen.js');
    assert.match(result, /onStars: \(\) => \{\s*this\.recordStars\(\)/);
    // the emit precedes the star gate, so Expert (which awards no stars) still emits
    assert.ok(result.indexOf("emit('runComplete'") < result.indexOf('awardsStars('));
});

test('only the allow-listed client files reference achievements', () => {
    const allowed = new Set(['src/progress/AchievementTracker.js', 'src/game/GameApp.js']);
    const files = [...sourceFiles('src'), ...sourceFiles('supabase/functions'), ...sourceFiles('tools'), ...sourceFiles('electron')];
    assert.ok(files.length > 20);
    for (const f of files.filter((x) => !allowed.has(x))) {
        assert.doesNotMatch(read(f), /AchievementTracker|achievements\.json|progress\/Achievement/, `${f} references achievements`);
    }
});

test('a throwing Steam bridge never breaks gameplay', () => {
    const bus = new FeedbackBus();
    new Tracker(bus, memStore(), { getStatus() { throw new Error('x'); }, unlockAchievement() { throw new Error('x'); } });
    assert.doesNotThrow(() => bus.emit('perfectStop', {}));
});

test('ranked submission and server validation never import achievements', () => {
    const files = [
        ...sourceFiles('src/net'),
        'src/core/backend/LocalBackend.js',
        ...sourceFiles('src/game/rules'),
        'src/game/RunRecorder.js',
        'tools/test-validate.mjs',
        ...sourceFiles('supabase/functions'),
    ];
    assert.ok(files.length > 3);
    for (const f of files) {
        assert.doesNotMatch(read(f), /AchievementTracker|achievements(\.json)?['"]|progress\/Achievement/, `${f} references achievements`);
    }
});
