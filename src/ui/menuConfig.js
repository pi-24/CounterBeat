/**
 * menuConfig.js - the main menu entries, in order.  The menu offers exactly
 * these seven (AC4); `action` says what MainMenu does when one is chosen.
 */
export const MENU_ITEMS = Object.freeze([
    Object.freeze({ id: 'campaign', label: 'Campaign', action: 'panel:play', mode: 'campaign', blurb: 'Earn stars, unlock tracks' }),
    Object.freeze({ id: 'quickplay', label: 'Quick Play', action: 'panel:play', mode: 'quickPlay', blurb: 'Any unlocked track and difficulty' }),
    Object.freeze({ id: 'daily', label: 'Daily', action: 'daily', blurb: 'One chart for everyone, today' }),
    Object.freeze({ id: 'ranked', label: 'Ranked/Leaderboards', action: 'page:rankings.html', blurb: 'Hard and Expert, server-verified' }),
    Object.freeze({ id: 'custom', label: 'Custom (Beta)', action: 'panel:library', blurb: 'Your own songs, unranked' }),
    Object.freeze({ id: 'practice', label: 'Practice', action: 'panel:play', mode: 'practice', blurb: '0.75x speed, no rewards' }),
    Object.freeze({ id: 'settings', label: 'Settings', action: 'panel:settings', blurb: 'Controls, audio, accessibility' }),
]);

/** Secondary entries that are not modes (kept out of the seven). */
export const MENU_EXTRAS = Object.freeze([
    Object.freeze({ id: 'tutorial', label: 'Replay tutorial', action: 'tutorial' }),
    Object.freeze({ id: 'credits', label: 'Credits', action: 'credits' }),
]);
