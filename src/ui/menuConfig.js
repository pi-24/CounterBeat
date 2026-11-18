/**
 * menuConfig.js - the main menu entries, in display order.
 *
 * Two rows (Direction C, mockup frame 01): four big Anton entries, then a ruled
 * row of utility entries.  `action` says what MainMenu does when one is chosen.
 * The seven game modes of AC4 are the `core` entries; MENU_ITEMS lists exactly
 * those, in order.  Shop, Credits and Quit are extras and are not modes.
 */
const entry = (fields) => Object.freeze(fields);

export const MENU_ENTRIES = Object.freeze([
    entry({ id: 'campaign', row: 'primary', core: true, label: 'Campaign', action: 'panel:play', mode: 'campaign', blurb: 'Earn stars, unlock tracks' }),
    entry({ id: 'quickplay', row: 'primary', core: true, label: 'Quick Play', action: 'panel:play', mode: 'quickPlay', blurb: 'Any unlocked track and difficulty' }),
    entry({ id: 'daily', row: 'primary', core: true, label: 'Daily', action: 'daily', blurb: 'One chart for everyone, today' }),
    entry({ id: 'ranked', row: 'primary', core: true, label: 'Ranked/Leaderboards', action: 'page:rankings.html', blurb: 'Hard and Expert, server-verified' }),
    entry({ id: 'custom', row: 'secondary', core: true, label: 'Custom (Beta)', action: 'panel:library', blurb: 'Your own songs, unranked', beta: true }),
    entry({ id: 'practice', row: 'secondary', core: true, label: 'Practice', action: 'panel:play', mode: 'practice', blurb: '0.75x speed, no rewards' }),
    entry({ id: 'shop', row: 'secondary', core: false, label: 'Shop', action: 'shop', blurb: 'Bots, skins, crosshairs' }),
    entry({ id: 'settings', row: 'secondary', core: true, label: 'Settings', action: 'panel:settings', blurb: 'Controls, audio, accessibility' }),
    entry({ id: 'credits', row: 'secondary', core: false, label: 'Credits', action: 'credits' }),
    entry({ id: 'quit', row: 'secondary', core: false, label: 'Quit', action: 'quit' }),
]);

/** The seven game modes (AC4), in menu order. */
export const MENU_ITEMS = Object.freeze(MENU_ENTRIES.filter((e) => e.core));

/** Entries that are not modes: Shop, Credits, Quit. */
export const MENU_EXTRAS = Object.freeze(MENU_ENTRIES.filter((e) => !e.core));

export const MENU_PRIMARY = Object.freeze(MENU_ENTRIES.filter((e) => e.row === 'primary'));
export const MENU_SECONDARY = Object.freeze(MENU_ENTRIES.filter((e) => e.row === 'secondary'));
