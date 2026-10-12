/**
 * SupabaseBackend.js
 *
 * Real accounts and a shared, verified leaderboard.
 *
 *   auth      Supabase Auth: email + password, plus Discord OAuth.
 *   profiles  one row per user, created by a database trigger at sign-up;
 *             holds the display name, main game and synced settings.
 *   runs      written only by the submit-run edge function, which replays
 *             the input log and stores the score it computed.
 *
 * The schema is in supabase/migrations; the function in supabase/functions.
 */
import { createClient } from '@supabase/supabase-js';

/** Everything on a run row except the replay log, which is fetched on demand. */
const RUN_COLUMNS = 'id,user_id,chart_id,kind,track_id,track_name,difficulty,level_id,level_name,score,accuracy,'
    + 'best_combo,counter_strafes,headshots,perfect,good,loose,missed,notes,completed,passed,rank,stats,verified,'
    + 'played_at,has_log';

export class SupabaseBackend {
    /**
     * @param {string} url the project URL
     * @param {string} anonKey the public anon key
     */
    constructor(url, anonKey) {
        this.kind = 'supabase';
        this.providers = ['discord'];
        this.client = createClient(url, anonKey);
        /** @type {object|null} */
        this.user = null;
        /** @type {Set<(user:object|null)=>void>} */
        this.listeners = new Set();
    }

    async init() {
        const { data: { session } } = await this.client.auth.getSession();
        this.user = session ? await this.loadProfile(session.user) : null;

        this.client.auth.onAuthStateChange((event, newSession) => {
            // supabase-js holds its auth lock while this callback runs, so
            // awaiting another Supabase call inside it can deadlock every
            // later request.  Do the work once the callback has returned.
            window.setTimeout(async () => {
                if (event === 'SIGNED_OUT' || !newSession) {
                    this.user = null;
                } else if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') {
                    this.user = await this.loadProfile(newSession.user);
                }
                for (const listener of this.listeners) {
                    listener(this.user);
                }
            }, 0);
        });
    }

    /**
     * @param {object} authUser a Supabase auth user
     * @returns {Promise<object|null>}
     */
    async loadProfile(authUser) {
        const { data } = await this.client
            .from('profiles')
            .select('id, display_name, main_game, settings, created_at')
            .eq('id', authUser.id)
            .maybeSingle();
        if (!data) {
            // The trigger runs in the same transaction as sign-up, so a
            // missing row means the session is stale; treat as signed out.
            return null;
        }
        return {
            id: data.id,
            displayName: data.display_name,
            mainGame: data.main_game ?? '',
            email: authUser.email,
            settings: data.settings ?? {},
            createdAt: data.created_at,
        };
    }

    currentUser() {
        return this.user;
    }

    onAuthChange(listener) {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    // ------------------------------------------------------------ auth ----

    async register(form) {
        const displayName = String(form.displayName).trim();
        // The sign-up trigger would quietly rename a taken name to "Name_2", so
        // check first.  ilike is case-insensitive; escape _ and % so they match literally.
        const pattern = displayName.replace(/[\\%_]/g, (c) => `\\${c}`);
        const { data: taken } = await this.client.from('profiles').select('id').ilike('display_name', pattern).limit(1);
        if (taken && taken.length > 0) {
            return { ok: false, error: 'That display name is already taken.', field: 'displayName' };
        }

        const { data, error } = await this.client.auth.signUp({
            email: String(form.email).trim().toLowerCase(),
            password: form.password,
            options: {
                data: {
                    display_name: displayName,
                    main_game: String(form.mainGame ?? '').trim(),
                },
                emailRedirectTo: `${window.location.origin}/login.html`,
            },
        });
        if (error) {
            return { ok: false, error: SupabaseBackend.friendly(error), field: SupabaseBackend.fieldFor(error) };
        }
        if (!data.session) {
            return { ok: true, needsConfirmation: true };
        }

        this.user = await this.loadProfile(data.user);
        if (!this.user) {
            await this.client.auth.signOut();
            return { ok: false, error: 'Your account was created but the profile could not be loaded. Try logging in.', field: 'email' };
        }
        return { ok: true, user: this.user };
    }

    async login(email, password) {
        const { data, error } = await this.client.auth.signInWithPassword({
            email: String(email).trim().toLowerCase(),
            password,
        });
        if (error) {
            return { ok: false, error: SupabaseBackend.friendly(error), field: SupabaseBackend.fieldFor(error) };
        }

        this.user = await this.loadProfile(data.user);
        if (!this.user) {
            // Signed in to Supabase but there is no profiles row
            await this.client.auth.signOut();
            return { ok: false, error: 'Your player profile could not be loaded. Try again, or register a new account.', field: 'email' };
        }
        return { ok: true, user: this.user };
    }

    async loginWithProvider(provider) {
        const { error } = await this.client.auth.signInWithOAuth({
            provider,
            options: { redirectTo: `${window.location.origin}/game.html` },
        });
        return error ? { ok: false, error: SupabaseBackend.friendly(error) } : { ok: true };
    }

    async logout() {
        await this.client.auth.signOut();
        this.user = null;
    }

    // ------------------------------------------------------------ runs ----

    /**
     * Asks the server for a one-use token for a run that is about to start.
     * submit-run only ranks a run that brings its token back, after at least
     * the run's own length has passed, so a log copied from someone else's
     * replay cannot simply be resubmitted.
     * @param {string} chartId
     * @returns {Promise<string|null>} null for unranked charts or on failure
     */
    async startRun(chartId) {
        if (!this.user || !/^(t|daily):/.test(String(chartId))) {
            return null;
        }
        try {
            const { data, error } = await this.client.functions.invoke('submit-run', {
                body: { action: 'start', chartId },
            });
            if (error || !data || typeof data.token !== 'string') {
                console.warn('Could not start a ranked run', error ?? data);
                return null;
            }
            return data.token;
        } catch (error) {
            console.warn('Could not start a ranked run', error);
            return null;
        }
    }

    async submitRun(record, log, token = null) {
        if (!this.user) {
            return { saved: false, accepted: false, score: record.score, personalBest: false };
        }
        const previous = await this.personalBest(this.user.id, record.chartId);

        const { data, error } = await this.client.functions.invoke('submit-run', {
            body: { record, log, token },
        });
        if (error) {
            return SupabaseBackend.submitFailure(error, record);
        }
        if (!data.accepted) {
            return { saved: false, accepted: false, rejected: true, reason: data.reason,
                score: record.score, personalBest: false };
        }
        const score = data.run.score;
        return {
            saved: true,
            accepted: true,
            ranked: Boolean(data.run.verified),
            score,
            personalBest: !previous || score > previous.score,
        };
    }

    /**
     * functions.invoke reports any non-2xx answer as an error.  Tell an
     * expired session (401) and a refusal (other 4xx, with the function's own
     * reason) apart from the network or the server actually failing.
     * @param {Error & {context?: Response}} error
     * @param {object} record
     */
    static async submitFailure(error, record) {
        const response = error.context;
        const status = response && typeof response.status === 'number' ? response.status : 0;
        let message = '';
        if (response && typeof response.json === 'function') {
            try {
                const body = await response.json();
                message = body?.error ?? body?.reason ?? '';
            } catch (parseError) {
                // Not JSON: keep the status code alone.
            }
        }
        const base = { saved: false, accepted: false, score: record.score, personalBest: false };
        if (status === 401) {
            return { ...base, rejected: false, reason: 'signed-out' };
        }
        if (status >= 400 && status < 500) {
            return { ...base, rejected: true, reason: message || `refused by the server (${status})` };
        }
        console.warn('submit-run failed', error);
        return { ...base, rejected: false, reason: 'network' };
    }

    /**
     * Best score, accuracy and pass state per chart over all of a player's
     * runs, computed in the database (see player_progress in
     * supabase/migrations/0003_hardening.sql) so it is not limited to the
     * most recent runs.
     * @param {string} userId
     * @returns {Promise<Map<string, object>>}
     */
    async progress(userId) {
        const { data, error } = await this.client.rpc('player_progress', { player: userId });
        if (error) {
            throw new Error(error.message);
        }
        const byChart = new Map();
        for (const row of data ?? []) {
            byChart.set(row.chart_id, {
                chartId: row.chart_id,
                kind: row.kind,
                trackId: row.track_id,
                trackName: row.track_name,
                bestScore: row.best_score,
                bestAccuracy: row.best_accuracy,
                maxAccuracy: row.max_accuracy,
                passed: Boolean(row.passed),
                runs: Number(row.runs),
                counterStrafes: Number(row.counter_strafes),
            });
        }
        return byChart;
    }

    async runsForUser(userId) {
        const { data } = await this.client
            .from('runs')
            .select(RUN_COLUMNS)
            .eq('user_id', userId)
            .order('played_at', { ascending: false })
            .limit(200);
        return (data ?? []).map(SupabaseBackend.runFromRow);
    }

    async personalBest(userId, chartId) {
        let query = this.client
            .from('runs')
            .select(RUN_COLUMNS)
            .eq('user_id', userId)
            .order('score', { ascending: false })
            .limit(1);
        if (chartId !== undefined) {
            query = query.eq('chart_id', chartId);
        } else {
            query = query.eq('verified', true).in('kind', ['track', 'daily']);
        }
        const { data } = await query;
        return data && data[0] ? SupabaseBackend.runFromRow(data[0]) : null;
    }

    async leaderboard(chartFilter = 'best') {
        const { data, error } = await this.client.rpc('leaderboard', {
            chart_filter: chartFilter === 'best' ? null : String(chartFilter),
        });
        if (error) {
            throw new Error(error.message);
        }
        return (data ?? []).map((row) => ({
            runId: row.run_id,
            userId: row.user_id,
            displayName: row.display_name,
            mainGame: row.main_game || '-',
            chartId: row.chart_id,
            levelId: row.level_id,
            levelName: row.level_name,
            score: row.score,
            accuracy: row.accuracy,
            bestCombo: row.best_combo,
            counterStrafes: row.counter_strafes,
            headshots: row.headshots,
            playedAt: row.played_at,
            runs: Number(row.runs),
            hasReplay: Boolean(row.has_replay),
        }));
    }

    async replay(runId) {
        const { data, error } = await this.client.rpc('run_replay', { run: runId });
        if (error || !data || !data[0] || !data[0].log) {
            return null;
        }
        const row = data[0];
        return {
            run: {
                id: row.id, userId: row.user_id, displayName: row.display_name, chartId: row.chart_id,
                levelName: row.level_name, score: row.score, accuracy: row.accuracy, playedAt: row.played_at,
            },
            log: row.log,
        };
    }

    async summary() {
        const [{ count: players }, { count: runs }, { data: best }] = await Promise.all([
            this.client.from('profiles').select('id', { count: 'exact', head: true }),
            this.client.from('runs').select('id', { count: 'exact', head: true }).eq('verified', true).in('kind', ['track', 'daily']),
            this.client.from('runs').select('score, profiles(display_name)')
                .eq('verified', true).in('kind', ['track', 'daily']).order('score', { ascending: false }).limit(1),
        ]);
        const top = best && best[0];
        return {
            players: players ?? 0,
            runs: runs ?? 0,
            topScore: top ? top.score : 0,
            topPlayer: top && top.profiles ? top.profiles.display_name : '-',
            averageScore: 0,
        };
    }

    async clearRuns(userId) {
        await this.client.from('runs').delete().eq('user_id', userId);
    }

    // -------------------------------------------------------- settings ----

    async loadSettings() {
        return this.user ? (this.user.settings ?? null) : null;
    }

    async saveSettings(values) {
        if (!this.user) {
            return;
        }
        this.user.settings = values;
        await this.client.from('profiles').update({ settings: values }).eq('id', this.user.id);
    }

    // --------------------------------------------------------- helpers ----

    /** @param {object} row */
    static runFromRow(row) {
        return {
            id: row.id,
            userId: row.user_id,
            chartId: row.chart_id,
            kind: row.kind,
            trackId: row.track_id,
            trackName: row.track_name,
            difficulty: row.difficulty,
            levelId: row.level_id,
            levelName: row.level_name,
            score: row.score,
            accuracy: row.accuracy,
            bestCombo: row.best_combo,
            counterStrafes: row.counter_strafes,
            headshots: row.headshots,
            perfect: row.perfect,
            good: row.good,
            loose: row.loose,
            missed: row.missed,
            notes: row.notes,
            completed: row.completed,
            passed: row.passed,
            rank: row.rank,
            stats: row.stats ?? null,
            verified: row.verified,
            hasReplay: Boolean(row.has_log),
            playedAt: row.played_at,
        };
    }

    /** @param {{message:string}} error */
    static friendly(error) {
        const message = error.message ?? 'Something went wrong.';
        if (/invalid login credentials/i.test(message)) {
            return 'That email and password do not match.';
        }
        if (/already registered/i.test(message)) {
            return 'An account already uses that email address.';
        }
        if (/email not confirmed/i.test(message)) {
            return 'Confirm your email address first. Check your inbox for the link.';
        }
        if (/password/i.test(message) && /short|weak|at least/i.test(message)) {
            return 'Password must be at least 8 characters.';
        }
        return message;
    }

    /** @param {{message:string}} error */
    static fieldFor(error) {
        const message = error.message ?? '';
        if (/password/i.test(message)) {
            return 'password';
        }
        return 'email';
    }
}
