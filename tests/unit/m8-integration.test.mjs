// M8 integration: drives the REAL submit-run edge-function handler (supabase/functions/submit-run/index.ts) with a fake
// Supabase client, once as a web submission and once as a desktop submission carrying a Steam ticket, and requires the
// verified result and the stored row to be identical. This is where a Steam-path regression (AC8/AC13) would live.
// (The desktop shell itself - menu, no web chrome, Alt+Enter, Steam fallback, clean exit - is asserted on the real Electron
// app in tests/desktop/smoke.test.mjs, which `npm test` also runs.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { stripTypeScriptTypes } from 'node:module';
import { resolveChart } from '../../src/game/rules/charts.js';
import { playAndRecord } from '../../tools/lib/scripted-player.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const fnDir = resolve(root, 'supabase/functions/submit-run');

const ID = '76561198000000001';
const TICKET = 'ab'.repeat(100);
const USER = 'user-1';
const TOKEN = '123e4567-e89b-42d3-a456-426614174000';

/** What the fake Supabase saw during one request. */
let seen;

/** A chainable stand-in for the query builder; only what submit-run touches. */
function fakeAdmin() {
    return {
        from(table) {
            const st = { op: null, row: null };
            const result = () => {
                if (table === 'runs' && st.op === 'insert') {
                    seen.inserts.push(st.row);
                    return { data: { id: 'run-1', score: st.row.score, played_at: '2026-01-01T00:00:00Z', verified: st.row.verified }, error: null };
                }
                if (table === 'run_tokens' && st.op === 'update') {
                    return { data: { issued_at: new Date(Date.now() - 900_000).toISOString() }, error: null };
                }
                if (table === 'profiles' && st.op === 'update') {
                    seen.profileUpdates.push(st.row);
                    return { data: null, error: null };
                }
                return { data: null, error: null };
            };
            const b = {
                select: () => { st.op ??= 'select'; return b; },
                insert: (row) => { st.op = 'insert'; st.row = row; return b; },
                update: (row) => { st.op = 'update'; st.row = row; return b; },
                delete: () => { st.op = 'delete'; return b; },
                eq: () => b, lt: () => b, is: () => b,
                single: async () => result(),
                maybeSingle: async () => result(),
                then: (ok, fail) => Promise.resolve(result()).then(ok, fail),
            };
            return b;
        },
        rpc: async () => ({ data: null, error: null }),
    };
}

/** Loads the real handler: types stripped, the Deno-only npm import pointed at the fake client, and the Deno globals provided. */
let handlerPromise;
function loadHandler() {
    handlerPromise ??= (async () => {
        const dir = mkdtempSync(join(tmpdir(), 'cb-submit-'));
        const stub = join(dir, 'supabase-stub.mjs');
        writeFileSync(stub, 'export const createClient = (url, key) => globalThis.__cbCreateClient(url, key);\n');
        let src = stripTypeScriptTypes(readFileSync(join(fnDir, 'index.ts'), 'utf8'));
        src = src.replace("'npm:@supabase/supabase-js@2'", JSON.stringify(pathToFileURL(stub).href));
        src = src.replace(/from '(\.\.\/_shared\/[^']+)'/g, (_m, p) => `from ${JSON.stringify(pathToFileURL(resolve(fnDir, p)).href)}`);
        const file = join(dir, 'submit-run.mjs');
        writeFileSync(file, src);
        const env = { SUPABASE_URL: 'http://fake', SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_ROLE_KEY: 'service', STEAM_WEB_API_SECRET: 'server-secret', STEAM_APP_ID: '480' };
        let handler;
        globalThis.Deno = { env: { get: (k) => env[k] }, serve: (h) => { handler = h; } };
        globalThis.__cbCreateClient = (_url, key) => (key === 'anon'
            ? { auth: { getUser: async () => ({ data: { user: { id: USER } }, error: null }) } }
            : fakeAdmin());
        await import(pathToFileURL(file).href);
        assert.equal(typeof handler, 'function', 'submit-run must register a Deno.serve handler');
        return handler;
    })();
    return handlerPromise;
}

/** POSTs a payload to the real handler; the Steam Web API (the only fetch) is stubbed to accept TICKET as ID. */
async function post(payload) {
    const handler = await loadHandler();
    seen = { inserts: [], profileUpdates: [] };
    const realFetch = globalThis.fetch;
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ response: { params: { result: 'OK', steamid: ID, ownersteamid: ID, vacbanned: false, publisherbanned: false } } }) });
    try {
        const response = await handler(new Request('http://fn/submit-run', {
            method: 'POST', headers: { Authorization: 'Bearer jwt', 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
        }));
        return { status: response.status, body: await response.json(), seen };
    } finally {
        globalThis.fetch = realFetch;
    }
}

for (const difficulty of ['hard', 'expert']) {
    test(`AC8/AC13: submit-run stores and returns the same verified run for web and Steam desktop submissions (${difficulty})`, async () => {
        const level = resolveChart(`t:neon:${difficulty}`);
        const { record, log } = playAndRecord(level);

        const web = await post({ record, log, token: TOKEN });
        assert.equal(web.status, 200);
        assert.equal(web.body.accepted, true, `web run must be accepted: ${JSON.stringify(web.body)}`);
        assert.equal(web.seen.inserts.length, 1);
        assert.equal(web.seen.inserts[0].verified, true);
        assert.equal(web.seen.profileUpdates.length, 0, 'a web submission never links a Steam account');

        const desktop = await post({ record, log, token: TOKEN, desktop: true, steamTicket: TICKET });
        assert.equal(desktop.status, 200);
        assert.deepEqual(desktop.body, web.body, 'Steam auth changed the response');
        assert.deepEqual(desktop.seen.inserts, web.seen.inserts, 'Steam auth changed the stored row');
        assert.deepEqual(desktop.seen.profileUpdates, [{ steam_id: ID }], 'the verified SteamID links to the profile');
    });
}

test('AC8/AC13: a Steam identity never makes an altered score acceptable, and a desktop run without a ticket is refused', async () => {
    const level = resolveChart('t:neon:hard');
    const { record, log } = playAndRecord(level);
    const forged = { ...record, score: record.score + 5000 };

    const web = await post({ record: forged, log, token: TOKEN });
    const desktop = await post({ record: forged, log, token: TOKEN, desktop: true, steamTicket: TICKET });
    assert.equal(web.body.mismatch, true);
    assert.deepEqual(desktop.body, web.body);
    // The stored score is the server-recomputed one, not the claim.
    assert.equal(desktop.seen.inserts[0].score, record.score);
    assert.equal(desktop.seen.inserts[0].client_score, forged.score);

    const noTicket = await post({ record, log, token: TOKEN, desktop: true });
    assert.equal(noTicket.body.accepted, false);
    assert.equal(noTicket.seen.inserts.length, 0, 'nothing is stored when the Steam identity check fails');
});
