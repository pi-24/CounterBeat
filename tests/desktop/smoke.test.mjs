import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

test('electron boots the built app, shows the menu and no web chrome', { timeout: 60000 }, () => {
    assert.ok(existsSync('dist/game.html'), 'run `npm run build` first');
    const electronPath = require('electron');
    const env = { ...process.env, CB_SMOKE: '1' };
    delete env.ELECTRON_RUN_AS_NODE;
    const r = spawnSync(electronPath, ['electron/main.js'], { env, encoding: 'utf8', timeout: 45000 });
    const line = r.stdout.split('\n').map((l) => l.trim()).filter((l) => l.startsWith('{')).pop();
    assert.ok(line, `no JSON output. stdout=${r.stdout} stderr=${r.stderr}`);
    console.log(line);
    assert.equal(JSON.parse(line).ok, true, line);
    assert.equal(r.status, 0);
});
