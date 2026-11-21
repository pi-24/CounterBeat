/**
 * menuPreview.js - the right-hand panel of the main menu: real data about the
 * focused entry (last session, best rank, accuracy...), and the player chips.
 * Pure: MenuScreen gathers a context from the game services, this turns it into
 * plain text, so every line is unit-tested without a browser.
 */

/** @param {number} stars @returns {number} one level per three stars (a chart's worth), from 1 */
export function playerLevel(stars) {
    return 1 + Math.floor(Math.max(0, stars) / 3);
}

/** @param {{name:string, bestRank:string|null, stars:number}} p @returns {Array<{label:string, value:string}>} */
export function chipsModel({ name, bestRank, stars }) {
    return [
        { label: 'PLAYER', value: String(name || 'Guest').toUpperCase() },
        { label: 'RANK', value: bestRank ?? '-' },
        { label: 'LEVEL', value: String(playerLevel(stars)) },
    ];
}

/** @param {number} fraction @returns {string} */
export function percent(fraction) {
    return `${(Math.max(0, fraction) * 100).toFixed(1)}%`;
}

const score = (value) => Math.round(value).toLocaleString('en-GB');

/**
 * @param {number} then ms since epoch @param {number} now
 * @returns {string} "just now", "5 min ago", "3 h ago", "2 days ago"
 */
export function ago(then, now = Date.now()) {
    const minutes = Math.max(0, Math.round((now - then) / 60000));
    if (minutes < 2) return 'just now';
    if (minutes < 90) return `${minutes} min ago`;
    const hours = Math.round(minutes / 60);
    if (hours < 36) return `${hours} h ago`;
    return `${Math.round(hours / 24)} days ago`;
}

/**
 * @typedef {object} PreviewContext
 * @property {number} stars @property {number} starTotal @property {number} tracksOpen @property {number} trackCount
 * @property {number|null} nextGate stars needed for the next locked track, null when all are open
 * @property {string|null} bestRank @property {number} bestAccuracy 0..1
 * @property {object|null} last the RunHistory `last` entry
 * @property {string|null} lastRank best rank on the last run's chart
 * @property {{trackId:string, trackName:string, difficulty:string, bpm:number, best:number, date:string, windows:number}|null} daily
 * @property {string} dailyClock @property {number|null} songs custom songs stored, null when unavailable
 * @property {boolean} loggedIn @property {boolean} desktop @property {string} focusTrackId cover for Campaign
 * @property {{sensitivity:number, fov:number, offsetMs:number}} settings @property {number} [now]
 */

/**
 * @typedef {{kicker:string, tag:string, title:string, body:string, cover:string|null,
 *            stats:Array<{label:string, value:string}>}} PreviewModel
 */

/** @param {string} id a menuConfig entry id @param {PreviewContext} ctx @returns {PreviewModel} */
export function buildMenuPreview(id, ctx) {
    const none = '-';
    switch (id) {
    case 'campaign': {
        const pct = ctx.starTotal ? Math.round((ctx.stars / ctx.starTotal) * 100) : 0;
        return {
            kicker: `CAMPAIGN - ${pct}%`, tag: 'PROGRESS', title: 'CAMPAIGN', cover: ctx.focusTrackId,
            body: ctx.nextGate === null
                ? 'Every track is open. Chase the third star on each chart.'
                : `${Math.max(0, ctx.nextGate - ctx.stars)} more stars open the next track. No fail-out on any difficulty.`,
            stats: [
                { label: 'STARS', value: `${ctx.stars}/${ctx.starTotal}` },
                { label: 'TRACKS', value: `${ctx.tracksOpen}/${ctx.trackCount}` },
                { label: 'BEST', value: ctx.bestRank ?? none },
            ],
        };
    }
    case 'quickplay': {
        const last = ctx.last;
        if (!last) {
            return {
                kicker: 'QUICK PLAY', tag: 'NO RUNS YET', title: 'QUICK PLAY', cover: ctx.focusTrackId,
                body: 'Any open track and difficulty, straight in. Stars at full speed.',
                stats: [
                    { label: 'TRACKS', value: `${ctx.tracksOpen}/${ctx.trackCount}` },
                    { label: 'STARS', value: String(ctx.stars) },
                    { label: 'BEST', value: ctx.bestRank ?? none },
                ],
            };
        }
        return {
            kicker: 'QUICK PLAY - RESUME', tag: 'LAST SESSION',
            title: `${last.trackName}${last.difficulty ? ` / ${last.difficulty}` : ''}`.toUpperCase(),
            cover: last.trackId ?? ctx.focusTrackId,
            body: `${score(last.score)} points, ${ago(last.at, ctx.now)}. Your last pick is pre-loaded.`,
            stats: [
                { label: 'SCORE', value: score(last.score) },
                { label: 'BEST', value: ctx.lastRank ?? last.rank ?? none },
                { label: 'ACC', value: percent(last.accuracy) },
            ],
        };
    }
    case 'daily': {
        const d = ctx.daily;
        if (!d) {
            return { kicker: 'DAILY', tag: '', title: 'DAILY', cover: null, body: 'One chart for everyone, today.', stats: [] };
        }
        return {
            kicker: `DAILY - ${d.date}`, tag: ctx.dailyClock, title: `${d.trackName} / ${d.difficulty}`.toUpperCase(), cover: d.trackId,
            body: 'One chart for everyone, its own leaderboard. Hard rules.',
            stats: [
                { label: 'BPM', value: String(d.bpm) },
                { label: 'BEST TODAY', value: d.best ? score(d.best) : none },
                { label: 'WINDOWS', value: String(d.windows) },
            ],
        };
    }
    case 'ranked':
        return {
            kicker: 'RANKED / LEADERBOARDS', tag: ctx.loggedIn ? 'SIGNED IN' : 'GUEST', title: 'RANKED', cover: null,
            body: ctx.loggedIn
                ? 'Hard and Expert only. Every run is replayed and verified by the server.'
                : 'Hard and Expert only, server-verified. Log in on the rankings page to have your runs count.',
            stats: [
                { label: 'BEST RANK', value: ctx.bestRank ?? none },
                { label: 'BEST ACC', value: ctx.bestAccuracy ? percent(ctx.bestAccuracy) : none },
                { label: 'ACCOUNT', value: ctx.loggedIn ? 'YES' : 'GUEST' },
            ],
        };
    case 'custom':
        return {
            kicker: 'CUSTOM (BETA)', tag: 'UNRANKED', title: 'YOUR SONGS', cover: null,
            body: 'Drop in a track and CounterBeat finds the beat. Personal bests only.',
            stats: [
                { label: 'SONGS', value: ctx.songs === null ? 'N/A' : String(ctx.songs) },
                { label: 'TEMPO', value: 'CONSTANT' },
                { label: 'RANKED', value: 'NO' },
            ],
        };
    case 'practice':
        return {
            kicker: 'PRACTICE', tag: 'NO REWARDS', title: 'PRACTICE', cover: ctx.focusTrackId,
            body: 'Every track and difficulty, loop a section, live timing readout.',
            stats: [{ label: 'SPEED', value: '0.75x' }, { label: 'TRACKS', value: String(ctx.trackCount) }, { label: 'STARS', value: 'NONE' }],
        };
    case 'shop':
        return {
            kicker: 'SHOP', tag: 'COMING SOON', title: 'SHOP', cover: null,
            body: 'Bots, skins and crosshairs, bought with coins earned on every level.',
            stats: [],
        };
    case 'settings':
        return {
            kicker: 'SETTINGS', tag: '', title: 'SETTINGS', cover: null,
            body: 'Controls, audio, accessibility and calibration.',
            stats: [
                { label: 'SENS', value: String(ctx.settings.sensitivity) },
                { label: 'FOV', value: String(ctx.settings.fov) },
                { label: 'OFFSET', value: `${ctx.settings.offsetMs >= 0 ? '+' : ''}${ctx.settings.offsetMs} MS` },
            ],
        };
    case 'credits':
        return { kicker: 'CREDITS', tag: '', title: 'CREDITS', cover: null, body: 'Who and what made CounterBeat, with every licence.', stats: [] };
    case 'quit':
        return {
            kicker: 'QUIT', tag: '', title: 'QUIT', cover: null,
            body: ctx.desktop ? 'Close CounterBeat. Progress is already saved.' : 'Leave the game and go back to the website.',
            stats: [],
        };
    default:
        return { kicker: '', tag: '', title: '', cover: null, body: '', stats: [] };
    }
}
