import test from 'node:test';
import assert from 'node:assert/strict';
import { MENU_ITEMS } from '../../src/ui/menuConfig.js';
import { parseMenuAction } from '../../src/ui/MainMenu.js';

test('the main menu offers exactly the seven entries, in order', () => {
    assert.deepEqual(MENU_ITEMS.map((i) => i.label), [
        'Campaign', 'Quick Play', 'Daily', 'Ranked/Leaderboards', 'Custom (Beta)', 'Practice', 'Settings',
    ]);
    assert.equal(new Set(MENU_ITEMS.map((i) => i.id)).size, 7);
});

test('menu actions parse', () => {
    assert.deepEqual(parseMenuAction('panel:settings'), { type: 'panel', target: 'settings' });
    assert.deepEqual(parseMenuAction('daily'), { type: 'daily', target: '' });
    for (const item of MENU_ITEMS) assert.ok(parseMenuAction(item.action).type);
});
