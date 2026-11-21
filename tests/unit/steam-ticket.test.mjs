// AC32: Steam session-ticket identity, verified server-side (verifier stubbed).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifySteamTicket, authenticateSteamIdentity, normalizeTicketHex } from '../../supabase/functions/_shared/steamAuth.js';
import { buildSubmitBody } from '../../src/net/rankedSubmit.js';
import { resolveChart } from '../../src/game/rules/charts.js';
import { validateRun } from '../../src/game/rules/validateRun.js';
import { playAndRecord } from '../../tools/lib/scripted-player.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const GOOD = 'ab'.repeat(100);
const ID = '76561198000000001';
const stub = (body, ok = true) => async () => ({ ok, json: async () => body });
const deps = (fetchImpl) => ({ fetchImpl, apiKey: 'server-secret', appId: 480 });
const okBody = { response: { params: { result: 'OK', steamid: ID, ownersteamid: ID, vacbanned: false, publisherbanned: false } } };

test('valid ticket is accepted and maps to a SteamID', async () => {
    let url;
    const r = await verifySteamTicket(GOOD, deps(async (u) => { url = u; return { ok: true, json: async () => okBody }; }));
    assert.deepEqual(r, { ok: true, steamId: ID, ownerSteamId: ID });
    assert.match(url, /AuthenticateUserTicket/);
    assert.match(url, new RegExp(`ticket=${GOOD}`));
});

test('forged / expired ticket rejected', async () => {
    const err = { response: { error: { errorcode: 3, errordesc: 'Invalid ticket' } } };
    assert.equal((await verifySteamTicket(GOOD, deps(stub(err)))).ok, false);
    assert.equal((await verifySteamTicket(GOOD, deps(stub({ response: { params: { result: 'Fail' } } })))).ok, false);
    assert.equal((await verifySteamTicket(GOOD, deps(stub({}, false)))).ok, false);
    assert.equal((await verifySteamTicket(GOOD, deps(async () => { throw new Error('net'); }))).ok, false);
    const banned = { response: { params: { ...okBody.response.params, vacbanned: true } } };
    assert.equal((await verifySteamTicket(GOOD, deps(stub(banned)))).ok, false);
});

test('malformed ticket rejected before any network call', async () => {
    let called = false;
    const d = deps(async () => { called = true; return { ok: true, json: async () => okBody }; });
    for (const bad of ['zz', 'abc', '', 'ab', 12, null, 'ab'.repeat(5000), 'G'.repeat(40)]) {
        assert.equal((await verifySteamTicket(bad, d)).ok, false);
    }
    assert.equal(called, false);
    assert.equal(normalizeTicketHex(GOOD.toUpperCase()), GOOD);
});

test('server without a configured secret rejects', async () => {
    assert.equal((await verifySteamTicket(GOOD, { fetchImpl: stub(okBody) })).ok, false);
});

test('desktop submission without a ticket is rejected; web may omit it', async () => {
    const d = deps(stub(okBody));
    assert.equal((await authenticateSteamIdentity({ desktop: true }, d)).ok, false);
    assert.equal((await authenticateSteamIdentity({ desktop: true, steamTicket: '' }, d)).ok, false);
    assert.deepEqual(await authenticateSteamIdentity({}, d), { ok: true, steamId: null });
    assert.deepEqual(await authenticateSteamIdentity({ desktop: true, steamTicket: GOOD }, d), { ok: true, steamId: ID, ownerSteamId: ID });
    assert.equal((await authenticateSteamIdentity({ desktop: true, steamTicket: 'ff' }, d)).ok, false);
});

test('client attaches the ticket in desktop mode and refuses without one', async () => {
    const web = await buildSubmitBody({ a: 1 }, { b: 2 }, 't', {});
    assert.deepEqual(web.body, { record: { a: 1 }, log: { b: 2 }, token: 't' });
    const mk = (t) => ({ counterbeatDesktop: { platform: 'desktop', steam: { getAuthTicket: async () => t } } });
    const ok = await buildSubmitBody({}, {}, 't', mk(GOOD));
    assert.equal(ok.body.steamTicket, GOOD);
    assert.equal(ok.body.desktop, true);
    assert.equal((await buildSubmitBody({}, {}, 't', mk(null))).ok, false);
});

test('validation output is unchanged with and without a ticket', async () => {
    const level = resolveChart('t:neon:hard');
    const { record, log } = playAndRecord(level);
    const before = JSON.stringify(validateRun(level, log, record.score));
    const payload = Object.freeze({ record, log, desktop: true, steamTicket: GOOD });
    const id = await authenticateSteamIdentity(payload, deps(stub(okBody)));
    assert.equal(id.ok, true);
    assert.equal(JSON.stringify(validateRun(level, payload.log, payload.record.score)), before);
    // the identity module never receives record/log
    const src = readFileSync(resolve(root, 'supabase/functions/_shared/steamAuth.js'), 'utf8');
    assert.doesNotMatch(src, /validateRun|\.record|\.log\b/);
});

function walk(dir, out = []) {
    for (const n of readdirSync(dir)) {
        const p = join(dir, n);
        statSync(p).isDirectory() ? walk(p, out) : out.push(p);
    }
    return out;
}

test('no Steam Web API key literal or reference in src/, the preload or the build output', () => {
    const re = /steam.?web.?api|STEAM_WEB_API|publisherKey|api\.steampowered\.com|AuthenticateUserTicket/i;
    const files = [...walk(resolve(root, 'src')), resolve(root, 'electron/preload.js')];
    if (existsSync(resolve(root, 'dist'))) files.push(...walk(resolve(root, 'dist')).filter((f) => /\.(js|html|css|json|map)$/.test(f)));
    for (const f of files) assert.doesNotMatch(readFileSync(f, 'utf8'), re, f);
});
