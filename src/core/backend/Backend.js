/**
 * Backend.js
 *
 * The one place the site decides where accounts and scores live.
 *
 * Two implementations share the same shape:
 *
 *   LocalBackend     everything in this browser's local storage.  Used when
 *                    no Supabase project is configured, so a clone of the
 *                    repo runs with `npm run dev` and nothing else.
 *   SupabaseBackend  real accounts, a shared leaderboard, and runs that are
 *                    replayed and verified on the server before they count.
 *
 * Pages and the game only ever talk to the interface described below.
 *
 * @typedef {object} User
 * @property {string} id
 * @property {string} displayName
 * @property {string} [email]
 * @property {string} [mainGame]
 * @property {string} [createdAt]
 *
 * @typedef {object} AuthResult
 * @property {boolean} ok
 * @property {User} [user]
 * @property {boolean} [needsConfirmation] sign-up succeeded but email must be confirmed
 * @property {string} [error]
 * @property {string} [field] the form field the error belongs to
 *
 * @typedef {object} SubmitResult
 * @property {boolean} saved        the run is stored somewhere
 * @property {boolean} accepted     the run counts for rankings
 * @property {boolean} [rejected]   the server refused the replay
 * @property {string} [reason]
 * @property {number} score         the score that was stored (server-side when verified)
 * @property {boolean} personalBest
 *
 * @typedef {object} Backend
 * @property {'local'|'supabase'} kind
 * @property {string[]} providers      OAuth providers available for login
 * @property {() => Promise<void>} init
 * @property {() => (User|null)} currentUser
 * @property {(listener:(user:User|null)=>void) => (() => void)} onAuthChange
 * @property {(form:{displayName:string,email:string,password:string,mainGame?:string}) => Promise<AuthResult>} register
 * @property {(email:string,password:string) => Promise<AuthResult>} login
 * @property {(provider:string) => Promise<AuthResult>} loginWithProvider
 * @property {() => Promise<void>} logout
 * @property {(record:object, log:object) => Promise<SubmitResult>} submitRun
 * @property {(userId:string) => Promise<object[]>} runsForUser
 * @property {(userId:string, levelId?:number) => Promise<object|null>} personalBest
 * @property {(levelId:number|'best') => Promise<object[]>} leaderboard
 * @property {() => Promise<{players:number,runs:number,topScore:number,topPlayer:string,averageScore:number}>} summary
 * @property {(userId:string) => Promise<void>} clearRuns
 * @property {() => Promise<object|null>} loadSettings
 * @property {(values:object) => Promise<void>} saveSettings
 */
import { LocalBackend } from './LocalBackend.js';

/** @type {Backend | null} */
let instance = null;

/**
 * Picks the backend from the build-time environment.  Supabase is used when
 * both VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are set (see .env.example).
 * @returns {Promise<Backend>}
 */
export async function getBackend() {
    if (instance) {
        return instance;
    }
    const url = import.meta.env.VITE_SUPABASE_URL;
    const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

    if (url && key) {
        const { SupabaseBackend } = await import('./SupabaseBackend.js');
        instance = new SupabaseBackend(url, key);
    } else {
        instance = new LocalBackend();
    }
    await instance.init();
    return instance;
}
