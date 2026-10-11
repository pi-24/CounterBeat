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

        this.client.auth.onAuthStateChange(async (event, newSession) => {
            if (event === 'SIGNED_OUT' || !newSession) {
                this.user = null;
            } else if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') {
                this.user = await this.loadProfile(newSession.user);
            }
            for (const listener of this.listeners) {
                listener(this.user);
            }
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
        const { data, error } = await this.client.auth.signUp({
            email: String(form.email).trim().toLowerCase(),
            password: form.password,
            options: {
                data: {
                    display_name: String(form.displayName).trim(),
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

    async submitRun(record, log) {
        if (!this.user) {
            return { saved: false, accepted: false, score: record.score, personalBest: false };
        }
        const previous = await this.personalBest(this.user.id, record.levelId);

        const { data, error } = await this.client.functions.invoke('submit-run', {
            body: { record, log },
        });
        if (error) {
            console.warn('submit-run failed', error);
            return { saved: false, accepted: false, rejected: false, reason: 'network',
                score: record.score, personalBest: false };
        }
        if (!data.accepted) {
            return { saved: false, accepted: false, rejected: true, reason: data.reason,
                score: record.score, personalBest: false };
        }
        const score = data.run.score;
        return {
            saved: true,
            accepted: true,
            score,
            personalBest: !previous || score > previous.score,
        };
    }

    async runsForUser(userId) {
        const { data } = await this.client
            .from('runs')
            .select('*')
            .eq('user_id', userId)
            .order('played_at', { ascending: false })
            .limit(100);
        return (data ?? []).map(SupabaseBackend.runFromRow);
    }

    async personalBest(userId, levelId) {
        let query = this.client
            .from('runs')
            .select('*')
            .eq('user_id', userId)
            .eq('verified', true)
            .order('score', { ascending: false })
            .limit(1);
        if (levelId !== undefined) {
            query = query.eq('level_id', levelId);
        } else {
            query = query.gt('level_id', 0);
        }
        const { data } = await query;
        return data && data[0] ? SupabaseBackend.runFromRow(data[0]) : null;
    }

    async leaderboard(levelId = 'best') {
        const { data, error } = await this.client.rpc('leaderboard', {
            level_filter: levelId === 'best' ? null : Number(levelId),
        });
        if (error) {
            throw new Error(error.message);
        }
        return (data ?? []).map((row) => ({
            userId: row.user_id,
            displayName: row.display_name,
            mainGame: row.main_game || '—',
            country: '—',
            levelId: row.level_id,
            levelName: row.level_name,
            score: row.score,
            accuracy: row.accuracy,
            bestCombo: row.best_combo,
            counterStrafes: row.counter_strafes,
            headshots: row.headshots,
            playedAt: row.played_at,
            runs: Number(row.runs),
        }));
    }

    async summary() {
        const [{ count: players }, { count: runs }, { data: best }] = await Promise.all([
            this.client.from('profiles').select('id', { count: 'exact', head: true }),
            this.client.from('runs').select('id', { count: 'exact', head: true }).eq('verified', true).gt('level_id', 0),
            this.client.from('runs').select('score, profiles(display_name)')
                .eq('verified', true).gt('level_id', 0).order('score', { ascending: false }).limit(1),
        ]);
        const top = best && best[0];
        return {
            players: players ?? 0,
            runs: runs ?? 0,
            topScore: top ? top.score : 0,
            topPlayer: top && top.profiles ? top.profiles.display_name : '—',
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
            verified: row.verified,
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
            return 'Confirm your email address first — check your inbox.';
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
