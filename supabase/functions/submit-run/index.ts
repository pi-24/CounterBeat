/**
 * submit-run
 *
 * The only way a run reaches the `runs` table.  The client sends its record
 * and the RunRecorder log; this function checks the caller's session,
 * replays the log through the shared rules code, and inserts the run with
 * the *server-computed* score, marked verified.  A log that fails the replay
 * is refused and nothing is stored.
 *
 * Two calls share this function:
 *
 *   { action: 'start', chartId }   at the start of a ranked run: returns a
 *                                  one-use token (a row in run_tokens).
 *   { record, log, token }         at the end: the run, with that token.
 *
 * The token ties a submission to a run that was started by this account at
 * least as long ago as the run lasts, and is spent on use; together with the
 * log fingerprint (a unique index on runs) that stops a replay log copied
 * from the rankings being resubmitted as someone else's run.  It cannot stop
 * a player who writes a whole input log themselves: the rules are replayed
 * exactly, but where the player's hands were is only ever the client's word.
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
import { validateRun, logDuration } from '../_shared/rules/validateRun.js';
import { TIMING_BUCKETS } from '../_shared/rules/Scorer.js';

/** A replay log is a few thousand numbers; anything far bigger is not one (60,000 ticks fit). */
const MAX_LOG_BYTES = 800_000;
/** Custom-song charts the server cannot rebuild: stored as unranked bests. */
const CUSTOM_RECORD_KEYS = ['score', 'accuracy', 'bestCombo', 'counterStrafes', 'headshots', 'perfect',
    'good', 'loose', 'missed', 'notes', 'completed', 'passed', 'rank'];
/** A token is good for this long after it is issued. */
const TOKEN_LIFETIME_MS = 3 * 60 * 60 * 1000;
/** Slack between the run's simulated length and the real time since its token was issued. */
const TOKEN_ELAPSED_SLACK_SECONDS = 10;
/** More run starts than this in ten minutes is not someone playing. */
const MAX_STARTS_PER_10_MIN = 60;
/** Runs with fewer shots than this are too short to fingerprint without false matches. */
const FINGERPRINT_MIN_SHOTS = 8;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The daily challenge is open on its day and for a grace hour after. */
function dailyIsOpen(date: string): boolean {
    const now = new Date();
    const yesterday = new Date(now.getTime() - 60 * 60 * 1000);
    return date === dailyDate(now) || date === dailyDate(yesterday);
}

/**
 * Keeps a client-supplied timing histogram only if it has exactly the shape
 * Scorer.timingStats() produces; anything else is dropped rather than stored.
 */
function cleanStats(stats: unknown): Record<string, unknown> | null {
    if (!stats || typeof stats !== 'object') {
        return null;
    }
    const s = stats as Record<string, unknown>;
    const count = (value: unknown) => Number.isInteger(value) && (value as number) >= 0 && (value as number) <= 100_000;
    const seconds = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 1;
    if (!Array.isArray(s.buckets) || s.buckets.length !== TIMING_BUCKETS || !s.buckets.every(count)
        || !count(s.hits) || !seconds(s.mean) || !seconds(s.median)) {
        return null;
    }
    return { buckets: s.buckets, hits: s.hits, mean: s.mean, median: s.median };
}

/**
 * A fingerprint of what the run did: which bot each shot went to, where,
 * and when to the nearest 10 ms.  Tick lengths are left out, so re-timing a
 * copied log's frames does not change it.
 */
async function fingerprint(chartId: string, shots: unknown[]): Promise<string | null> {
    if (shots.length < FINGERPRINT_MIN_SHOTS) {
        return null;
    }
    const essence = shots.map((shot) => {
        const [, songMs, noteIndex, zone, blocked] = shot as number[];
        return [noteIndex, zone, blocked, Math.round(songMs / 10)];
    });
    const bytes = new TextEncoder().encode(JSON.stringify({ chartId, essence }));
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Only a player's best run on each chart keeps its replay: every run is
 * stored with its log, then this clears the log from all of the player's
 * other runs on that chart (keep_best_replay in migration 0003).  A failure
 * here only leaves an extra replay behind, so it does not fail the run.
 */
async function keepBestReplay(
    admin: ReturnType<typeof createClient>, userId: string, chartId: string,
): Promise<void> {
    const { error } = await admin.rpc('keep_best_replay', { p_user: userId, p_chart: chartId });
    if (error) {
        console.warn('keep_best_replay failed', error.message);
    }
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

    let payload: {
        action?: string; chartId?: unknown; token?: unknown;
        record?: Record<string, unknown>; log?: Record<string, unknown>;
    };
    try {
        payload = await request.json();
    } catch {
        return json({ error: 'invalid JSON' }, 400);
    }

    // Write with the service role: RLS has no insert policy for users.
    const admin = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    // ---- start: issue a token for a ranked run ----------------------------
    if (payload.action === 'start') {
        const level = resolveChart(payload.chartId);
        if (!level || level.tutorial || level.custom) {
            return json({ error: 'unknown or unranked chart' }, 400);
        }
        if (level.kind === 'daily' && !dailyIsOpen(level.date as string)) {
            return json({ error: 'that daily challenge has closed' }, 400);
        }
        // Housekeeping: this player's tokens from abandoned runs a day ago.
        await admin.from('run_tokens').delete()
            .eq('user_id', user.id)
            .lt('issued_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());
        // Count and insert in one locked step (issue_run_token in migration
        // 0003), so simultaneous requests cannot all slip under the limit.
        const { data: issued, error } = await admin.rpc('issue_run_token', {
            p_user: user.id, p_chart: level.chartId, p_max: MAX_STARTS_PER_10_MIN,
        });
        if (error) {
            return json({ error: error.message }, 500);
        }
        if (!issued) {
            return json({ error: 'too many runs started; wait a few minutes' }, 429);
        }
        return json({ token: issued });
    }

    // ---- submit -----------------------------------------------------------
    const { record, log } = payload;
    if (!record || !log || typeof record.chartId !== 'string') {
        return json({ error: 'record and log are required' }, 400);
    }
    if (JSON.stringify(log).length > MAX_LOG_BYTES) {
        return json({ accepted: false, reason: 'log too large' }, 200);
    }

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
            chart_id: chartId.slice(0, 120),
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
            stats: cleanStats(record.stats),
            log,
            client_score: record.score,
            verified: false,
        }).select('id, score, played_at, verified').single();
        if (error) {
            return json({ error: error.message }, 500);
        }
        await keepBestReplay(admin, user.id, chartId.slice(0, 120));
        return json({ accepted: true, mismatch: false, run: inserted, record: clean });
    }

    const level = resolveChart(chartId);
    if (!level || level.tutorial) {
        return json({ error: 'unknown or unranked chart' }, 400);
    }
    if (level.kind === 'daily' && !dailyIsOpen(level.date as string)) {
        return json({ accepted: false, reason: 'that daily challenge has closed' }, 200);
    }

    // Spend the run's token: it must be this player's, for this chart,
    // unused, and issued at least as long ago as the run lasted.
    const token = typeof payload.token === 'string' && UUID_RE.test(payload.token) ? payload.token : null;
    if (!token) {
        return json({ accepted: false, reason: 'the run was not started online' }, 200);
    }
    const { data: spent } = await admin.from('run_tokens')
        .update({ used_at: new Date().toISOString() })
        .eq('id', token)
        .eq('user_id', user.id)
        .eq('chart_id', level.chartId)
        .is('used_at', null)
        .select('issued_at')
        .maybeSingle();
    if (!spent) {
        return json({ accepted: false, reason: 'the run was not started online, or was already submitted' }, 200);
    }
    const sinceIssued = (Date.now() - new Date(spent.issued_at).getTime()) / 1000;
    if (sinceIssued * 1000 > TOKEN_LIFETIME_MS) {
        return json({ accepted: false, reason: 'the run was started too long ago' }, 200);
    }
    if (sinceIssued + TOKEN_ELAPSED_SLACK_SECONDS < logDuration(log)) {
        return json({ accepted: false, reason: 'the run is longer than the time since it started' }, 200);
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
        log_fingerprint: await fingerprint(level.chartId, (log.shots as unknown[]) ?? []),
        client_score: record.score,
        verified: true,
    }).select('id, score, played_at, verified').single();

    if (error) {
        if (error.code === '23505') {
            // unique_violation on runs_log_fingerprint
            return json({ accepted: false, reason: 'this run has already been submitted' }, 200);
        }
        return json({ error: error.message }, 500);
    }
    await keepBestReplay(admin, user.id, level.chartId);
    return json({ accepted: true, mismatch: verdict.mismatch, run: inserted, record: v });
});
