/**
 * submit-run
 *
 * The only way a run reaches the `runs` table.  The client sends its record
 * and the RunRecorder log; this function checks the caller's session,
 * replays the log through the shared rules code, and inserts the run with
 * the *server-computed* score, marked verified.  A log that fails the replay
 * is refused and nothing is stored.
 *
 * Deploy:   supabase functions deploy submit-run
 * Secrets:  SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY are
 *           provided automatically in the hosted environment.
 *
 * The rules under ../_shared/rules are a copy of src/game/rules made by
 * `npm run sync-rules`; keep them in step when the rules change.
 */
import { createClient } from 'npm:@supabase/supabase-js@2';
import { getLevel } from '../_shared/rules/levels.js';
import { validateRun } from '../_shared/rules/validateRun.js';

const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
    status, headers: { ...CORS, 'Content-Type': 'application/json' },
});

Deno.serve(async (request) => {
    if (request.method === 'OPTIONS') {
        return new Response('ok', { headers: CORS });
    }
    if (request.method !== 'POST') {
        return json({ error: 'POST only' }, 405);
    }

    // Who is calling?  The anon client with the caller's JWT answers that.
    const authHeader = request.headers.get('Authorization') ?? '';
    const caller = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_ANON_KEY')!,
        { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user }, error: authError } = await caller.auth.getUser();
    if (authError || !user) {
        return json({ error: 'not signed in' }, 401);
    }

    let payload: { record?: Record<string, unknown>; log?: Record<string, unknown> };
    try {
        payload = await request.json();
    } catch {
        return json({ error: 'invalid JSON' }, 400);
    }
    const { record, log } = payload;
    if (!record || !log || typeof record.levelId !== 'number') {
        return json({ error: 'record and log are required' }, 400);
    }

    const level = getLevel(record.levelId as number);
    if (!level || level.tutorial) {
        return json({ error: 'unknown or unranked level' }, 400);
    }

    const verdict = validateRun(level, log, record.score as number);
    if (!verdict.ok) {
        return json({ accepted: false, reason: verdict.reason }, 200);
    }
    const v = verdict.record as Record<string, number | boolean | string>;

    // Write with the service role: RLS has no insert policy for users.
    const admin = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );
    const { data: inserted, error } = await admin.from('runs').insert({
        user_id: user.id,
        level_id: level.id,
        level_name: level.name,
        score: v.score,
        accuracy: v.accuracy,
        best_combo: v.bestCombo,
        counter_strafes: v.counterStrafes,
        headshots: v.headshots,
        perfect: v.perfect,
        good: v.good,
        loose: v.loose,
        missed: v.missed,
        notes: v.notes,
        completed: v.completed,
        passed: v.passed,
        rank: v.rank,
        client_score: record.score,
        verified: true,
    }).select('id, score, played_at').single();

    if (error) {
        return json({ error: error.message }, 500);
    }
    return json({ accepted: true, mismatch: verdict.mismatch, run: inserted, record: v });
});
