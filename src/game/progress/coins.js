/**
 * coins.js
 *
 * Pure coin award for one finished run (the creator's "you earn coins for each
 * level"). The numbers live in data/rules.json `economy`:
 *   clear   clearBase x the difficulty multiplier (Easy 1 / Normal 1.5 / Hard 2 / Expert 3)
 *   rank    S 30 / A 20 / B 10 on top of a clear
 *   stars   +25 for every star earned for the first time on the chart
 *   first   +50 the first time a track + difficulty is cleared
 * Campaign, Quick Play (full speed) and Daily runs earn coins; Practice, the
 * tutorial, replays, Custom songs and unfinished or failed runs earn nothing.
 *
 * Coins are local/synced progression only: the ranked submit path and the
 * edge function never read them (README, "Stars and tampering").
 */
import { RULES } from '../rules/rules.js';

export const COIN_MODES = Object.freeze(['campaign', 'quickPlay', 'daily']);
export const COIN_KINDS = Object.freeze(['track', 'daily']);

/**
 * @param {{mode:string, kind?:string, speed?:number, completed?:boolean, passed?:boolean, replay?:boolean}} run
 * @returns {boolean} whether this run can pay coins at all.
 */
export function awardsCoins({ mode, kind = 'track', speed = 1, completed = true, passed = true, replay = false }) {
    if (replay || completed === false || passed === false) {
        return false;
    }
    if (!COIN_MODES.includes(mode) || !COIN_KINDS.includes(kind)) {
        return false;
    }
    return mode !== 'quickPlay' || speed >= 1;
}

/**
 * @param {object} run awardsCoins fields plus
 *   difficulty, rank ('S'|'A'|'B'|...), newStars (stars earned for the first time), firstClear (bool)
 * @param {object} [economy] defaults to RULES.economy
 * @returns {{total:number, lines:{id:string, label:string, amount:number}[]}} no lines when nothing is earned
 */
export function calculateAward(run, economy = RULES.economy) {
    const none = { total: 0, lines: [] };
    const multiplier = economy.difficultyMultiplier[run.difficulty];
    if (!awardsCoins(run) || typeof multiplier !== 'number') {
        return none;
    }
    const lines = [{ id: 'clear', label: 'Clear', amount: Math.round(economy.clearBase * multiplier) }];
    const rank = economy.rankBonus[run.rank] ?? 0;
    if (rank > 0) {
        lines.push({ id: 'rank', label: `Rank ${run.rank}`, amount: rank });
    }
    const newStars = Math.max(0, Math.trunc(run.newStars ?? 0));
    if (newStars > 0) {
        lines.push({ id: 'stars', label: `${newStars} new ${newStars === 1 ? 'star' : 'stars'}`, amount: newStars * economy.perNewStar });
    }
    if (run.firstClear === true && run.kind !== 'daily') {
        lines.push({ id: 'first', label: 'First clear', amount: economy.firstClear });
    }
    return { total: lines.reduce((sum, line) => sum + line.amount, 0), lines };
}

/** "+85 coins" for the results screen. @param {number} total */
export function coinsText(total) {
    return `+${total.toLocaleString('en-GB')} ${total === 1 ? 'coin' : 'coins'}`;
}
