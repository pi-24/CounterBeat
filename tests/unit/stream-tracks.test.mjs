import test from 'node:test';
import assert from 'node:assert/strict';
import { streamBytes, loadStreamed, streamPriority } from '../../src/audio/streamLoader.js';
import { validateTracks, oggDuration } from '../../tools/validate-tracks.mjs';
import { loadManifest } from '../../tools/validate-assets.mjs';

const fakeFetch = (chunks) => async () => {
    let i = 0;
    return {
        ok: true,
        headers: { get: () => String(chunks.reduce((n, c) => n + c.length, 0)) },
        body: { getReader: () => ({ read: async () => (i < chunks.length ? { done: false, value: chunks[i++] } : { done: true }) }) },
    };
};

test('streamBytes reads chunks incrementally and reassembles them', async () => {
    const seen = [];
    const buf = await streamBytes('x', (r, t) => seen.push([r, t]), fakeFetch([Uint8Array.of(1, 2), Uint8Array.of(3)]));
    assert.deepEqual([...new Uint8Array(buf)], [1, 2, 3]);
    assert.deepEqual(seen, [[2, 3], [3, 3]]);
});

test('streamBytes returns null on a failed request', async () => {
    assert.equal(await streamBytes('x', null, async () => ({ ok: false })), null);
});

test('streamBytes without a progress callback uses the plain body read', async () => {
    const buf = await streamBytes('x', undefined, async () => ({ ok: true, arrayBuffer: async () => Uint8Array.of(9).buffer }));
    assert.deepEqual([...new Uint8Array(buf)], [9]);
});

test('menu music sorts ahead of other music, then effects', () => {
    const keys = ['sfx-a', 'music-vault', 'music-menu', 'music-neon'];
    assert.deepEqual(keys.sort((a, b) => streamPriority(a) - streamPriority(b)),
        ['music-menu', 'music-vault', 'music-neon', 'sfx-a']);
});

test('real tracks pass the MVP validation and fail --release while placeholders', () => {
    const m = loadManifest('tracks.json');
    assert.deepEqual(validateTracks(m).errors, []);
    const release = validateTracks(m, { release: true }).errors;
    assert.equal(release.length, m.tracks.filter((t) => t.placeholder).length);
});

test('validator catches drift, missing licence and tempo maps', () => {
    const m = structuredClone(loadManifest('tracks.json'));
    m.tracks[0].bpm = 91;
    m.tracks[1].placeholder = false; m.tracks[1].licence = 'LICENSES/nope.txt';
    m.tracks[2].tempoMap = [];
    const errors = validateTracks(m).errors.join('\n');
    assert.match(errors, /track range: tempo drift/);
    assert.match(errors, /track drift: licence file LICENSES.nope.txt not found/);
    assert.equal((errors.match(/track drift:/g) ?? []).length, 1);
    assert.match(errors, /track neon: constant BPM only/);
});

test('oggDuration reads sample rate and length of a real Ogg', async () => {
    const { readFileSync } = await import('node:fs');
    const buf = readFileSync(new URL('../../public/audio/music-neon.ogg', import.meta.url));
    assert.equal(buf.readUInt32LE(buf.indexOf(Buffer.from([0x01, 0x76, 0x6f, 0x72, 0x62, 0x69, 0x73])) /* 0x01 'vorbis' */ + 12), 44100);
    const d = oggDuration(buf);
    assert.ok(Math.abs(d - 66) < 1, `duration ${d}`);
});

test('oggDuration rejects non-ogg data', () => {
    assert.throws(() => oggDuration(Buffer.from('nope')));
});

test('loadStreamed requests menu music first, reports arrivals and survives a failing sound', async () => {
    const order = [];
    const audio = {
        load: async () => {},
        ensure: async (key) => { if (key === 'sfx-bad') throw new Error('boom'); order.push(key); return true; },
    };
    const arrived = [];
    const warn = console.warn; console.warn = () => {};
    try {
        const r = await loadStreamed(audio, { 'sfx-a': ['a'], 'sfx-bad': ['b'], 'music-menu': ['m'] }, (k) => arrived.push(k));
        await r.background;
    } finally { console.warn = warn; }
    assert.equal(order[0], 'music-menu');
    assert.deepEqual(arrived.sort(), ['music-menu', 'sfx-a']);
});

test('tempo detector measures a click track and flags drift', async () => {
    const { measureTempoDrift } = await import('../../tools/lib/tempo.mjs');
    const rate = 22050;
    const click = (bpmFirst, bpmSecond, secs) => {
        const s = new Float32Array(rate * secs);
        let t = 0;
        while (t < secs) {
            const i = Math.floor(t * rate);
            for (let j = 0; j < 200 && i + j < s.length; j++) s[i + j] = Math.exp(-j / 40) * (j % 2 ? 1 : -1);
            t += 60 / (t < secs / 2 ? bpmFirst : bpmSecond);
        }
        return s;
    };
    const steady = measureTempoDrift(click(120, 120, 24), rate, 120);
    assert.ok(steady.drift < 0.005, `steady drift ${steady.drift}`);
    const drifting = measureTempoDrift(click(120, 126, 24), rate, 120);
    assert.ok(drifting.drift > 0.02, `drifting drift ${drifting.drift}`);
});

// --- generator-independent beat check, on the fixtures decoded from the shipped Ogg files ---
const stretch = (fixture, factor) => {
    const src = Buffer.from(fixture.energy, 'base64');
    const out = Buffer.alloc(Math.round(src.length * factor));
    for (let i = 0; i < out.length; i++) out[i] = src[Math.min(src.length - 1, Math.floor(i / factor))];
    return { ...fixture, duration: out.length * fixture.hopSec, energy: out.toString('base64') };
};
const shift = (fixture, seconds, hz = 250) => {   // delays the second half only: a mid-track tempo slip
    const src = Buffer.from(fixture.energy, 'base64');
    const mid = src.length >> 1, n = Math.round(seconds * hz);
    const out = Buffer.concat([src.subarray(0, mid), Buffer.alloc(n), src.subarray(mid)]);
    return { ...fixture, duration: out.length * fixture.hopSec, energy: out.toString('base64') };
};

test('the shipped audio fixtures pass the beat-comb check with measured tails', async () => {
    const { loadFixture } = await import('../../tools/validate-tracks.mjs');
    const m = loadManifest('tracks.json');
    for (const t of m.tracks) assert.ok(loadFixture(new URL('../../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'), t.id), `fixture for ${t.id}`);
    assert.deepEqual(validateTracks(m).errors, []);
});

test('a time-stretched or mid-track-shifted fixture fails the drift check', async () => {
    const { loadFixture } = await import('../../tools/validate-tracks.mjs');
    const m = loadManifest('tracks.json');
    const root = new URL('../../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
    const track = m.tracks[0];
    const real = loadFixture(root, track.id);
    // fixtureFor returns a modified copy; the Ogg-length staleness check is the only other gate, so keep length equal
    const fix = (f) => ({ ...f, duration: real.duration });
    const stretched = validateTracks({ tracks: [track] }, { fixtureFor: () => fix(stretch(real, 1.02)) });
    assert.match(stretched.errors.join('\n'), /tailSeconds|tempo drift/);
    const shifted = validateTracks({ tracks: [track] }, { fixtureFor: () => fix(shift(real, 0.5)) });
    assert.match(shifted.errors.join('\n'), /tempo drift|tailSeconds/);
});

test('a fixture that does not belong to the Ogg is rejected as stale', async () => {
    const { loadFixture } = await import('../../tools/validate-tracks.mjs');
    const m = loadManifest('tracks.json');
    const root = new URL('../../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
    const real = loadFixture(root, m.tracks[0].id);
    const r = validateTracks({ tracks: [m.tracks[0]] }, { fixtureFor: () => stretch(real, 1.02) });
    assert.match(r.errors.join('\n'), /stale fixture/);
});

test('the Ogg capture pattern in the validator is a byte array, not a literal control char', async () => {
    const { readFileSync } = await import('node:fs');
    for (const f of ['../../tools/validate-tracks.mjs', './stream-tracks.test.mjs']) {
        assert.ok(!/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(readFileSync(new URL(f, import.meta.url), 'utf8')), f);
    }
});
