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
import { resolveChart, dailyDate } from '../_shared/rules/charts.js';
import { validateRun } from '../_shared/rules/validateRun.js';

/** A replay log is a few thousand numbers; anything far bigger is not one. */
const MAX_LOG_BYTES = 400_000;
/** Custom-song charts the server cannot rebuild: stored as unranked bests. */
const CUSTOM_RECORD_KEYS = ['score', 'accuracy', 'bestCombo', 'counterStrafes', 'headshots', 'perfect',
    'good', 'loose', 'missed', 'notes', 'completed', 'passed', 'rank'];

/** The daily challenge is open on its day and for a grace hour after. */
function dailyIsOpen(date: string): boolean {
    const now = new Date();
    const yesterday = new Date(now.getTime() - 60 * 60 * 1000);
    return date === dailyDate(now) || date === dailyDate(yesterday);
}

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
    if (!record || !log || typeof record.chartId !== 'string') {
        return json({ error: 'record and log are required' }, 400);
    }
    if (JSON.stringify(log).length > MAX_LOG_BYTES) {
        return json({ accepted: false, reason: 'log too large' }, 200);
    }

    // Write with the service role: RLS has no insert policy for users.
    const admin = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const chartId = record.chartId as string;

    // A custom song: the server never hears it, so the chart cannot be
    // rebuilt or the run replayed.  It is stored as the player's own,
    // unverified best - never ranked - after a sanity check on the shape.
    if (chartId.startsWith('custom:')) {
        if (record.kind !== 'custom' || typeof record.score !== 'number' || record.score < 0 || record.score > 10_000_000) {
            return json({ accepted: false, reason: 'malformed custom run' }, 200);
        }
        const clean: Record<string, unknown> = {};
        for (const key of CUSTOM_RECORD_KEYS) {
            clean[key] = record[key];
        }
        const { data: inserted, error } = await admin.from('runs').insert({
            user_id: user.id,
            chart_id: chartId,
            kind: 'custom',
            track_id: String(record.trackId ?? '').slice(0, 80),
            track_name: String(record.trackName ?? 'Custom song').slice(0, 80),
            difficulty: String(record.difficulty ?? 'normal').slice(0, 16),
            level_id: 6,
            level_name: String(record.levelName ?? 'Custom song').slice(0, 120),
            score: clean.score,
            accuracy: clean.accuracy,
            best_combo: clean.bestCombo,
            counter_strafes: clean.counterStrafes,
            headshots: clean.headshots,
            perfect: clean.perfect,
            good: clean.good,
            loose: clean.loose,
            missed: clean.missed,
            notes: clean.notes,
            completed: clean.completed,
            passed: clean.passed,
            rank: clean.rank,
            stats: record.stats ?? null,
            log,
            client_score: record.score,
            verified: false,
        }).select('id, score, played_at, verified').single();
        if (error) {
            return json({ error: error.message }, 500);
        }
        return json({ accepted: true, mismatch: false, run: inserted, record: clean });
    }

    const level = resolveChart(chartId);
    if (!level || level.tutorial) {
        return json({ error: 'unknown or unranked chart' }, 400);
    }
    if (level.kind === 'daily' && !dailyIsOpen(level.date as string)) {
        return json({ accepted: false, reason: 'that daily challenge has closed' }, 200);
    }

    const verdict = validateRun(level, log, record.score as number);
    if (!verdict.ok) {
        return json({ accepted: false, reason: verdict.reason }, 200);
    }
    const v = verdict.record as Record<string, unknown>;

    const { data: inserted, error } = await admin.from('runs').insert({
        user_id: user.id,
        chart_id: level.chartId,
        kind: level.kind,
        track_id: level.trackId,
        track_name: level.trackName,
        difficulty: level.difficulty.id,
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
        stats: v.stats,
        log,
        client_score: record.score,
        verified: true,
    }).select('id, score, played_at, verified').single();

    if (error) {
        return json({ error: error.message }, 500);
    }
    return json({ accepted: true, mismatch: verdict.mismatch, run: inserted, record: v });
});
