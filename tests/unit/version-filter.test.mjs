import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { filterCurrentVersion, rowVersion } from '../../src/net/submit.js';
import { currentChartVersions } from '../../src/net/versions.js';
import { seedSql } from '../../tools/seed-chart-versions.mjs';
import { ScoreRepository } from '../../src/core/ScoreRepository.js';

const run = (id, userId, score, chartVersion) => ({
    id, userId, chartId: 't:range:hard', kind: 'track', levelId: 3, score, chartVersion, verified: true,
});
const users = [{ id: 'a', displayName: 'A' }, { id: 'b', displayName: 'B' }];

test('currentChartVersions: authored Hard/Expert have versions, generated are 0', () => {
    const v = currentChartVersions();
    assert.ok(v['t:range:hard'] >= 1);
    assert.ok(v['t:range:expert'] >= 1);
    assert.equal(v['t:range:easy'], 0);
});

test('filterCurrentVersion hides rows on older versions', () => {
    const rows = [{ chartId: 'x', chartVersion: 2 }, { chartId: 'x', chartVersion: 1 }, { chartId: 'y' }];
    assert.deepEqual(filterCurrentVersion(rows, { x: 2 }), [rows[0], rows[2]]);
    assert.equal(rowVersion({}), 0);
});

test('bumping a version hides old scores, and a lower new-version run shows instead of the old best', () => {
    const repo = new ScoreRepository({ read: () => [], write: () => true });
    repo.all = () => [run('1', 'a', 9000, 3), run('2', 'a', 500, 4), run('3', 'b', 800, 3)];
    repo.logIds = () => new Set();
    const before = repo.leaderboard(users, 'best', { 't:range:hard': 3 });
    assert.deepEqual(before.map((r) => r.score).sort((x, y) => x - y), [800, 9000]);
    const after = repo.leaderboard(users, 'best', { 't:range:hard': 4 });
    assert.deepEqual(after.map((r) => [r.userId, r.score]), [['a', 500]]);
    assert.equal(repo.leaderboard(users, 'best', null).length, 2, 'null disables the filter explicitly');
    // Default is filtered: t:range:hard is at its authored version, so v3/v4 rows are retired.
    const active = currentChartVersions()['t:range:hard'];
    repo.all = () => [run('1', 'a', 9000, active + 5), run('2', 'b', 700, active)];
    assert.deepEqual(repo.leaderboard(users, 'best').map((r) => r.score), [700], 'default hides retired versions');
});

test('migration 0005 filters by version, gates Easy/Normal and resets once behind a flag', () => {
    const sql = readFileSync(new URL('../../supabase/migrations/0005_ranked_version_reset.sql', import.meta.url), 'utf8');
    assert.match(sql, /chart_version/);
    assert.match(sql, /join public\.chart_versions cv|left join public\.chart_versions cv/);
    assert.match(sql, /r\.chart_version = coalesce\(cv\.version, 0\)/);
    assert.doesNotMatch(sql, /versions jsonb/, 'the client must not choose the active versions');
    assert.match(sql, /grant execute on function public\.set_chart_version\(text, int\) to service_role/);
    assert.match(sql, /'hard', 'expert'/);
    assert.match(sql, /migration_flags/);
    assert.match(sql, /not exists \(select 1 from public\.migration_flags where name = 'leaderboard_reset_launch'\)/);
    assert.match(sql, /delete from public\.runs/);
});

test('submit-run stores the chart version', () => {
    const fn = readFileSync(new URL('../../supabase/functions/submit-run/index.ts', import.meta.url), 'utf8');
    assert.match(fn, /chart_version: level\.chartVersion \?\? 0/);
});

test('the server derives active versions; the client sends none', () => {
    const fn = readFileSync(new URL('../../supabase/functions/submit-run/index.ts', import.meta.url), 'utf8');
    assert.doesNotMatch(fn, /rpc\('set_chart_version'/, 'no per-start round trip');
    const be = readFileSync(new URL('../../src/core/backend/SupabaseBackend.js', import.meta.url), 'utf8');
    assert.doesNotMatch(be, /versions:/);
});

test('Daily charts are absent from the version map and still pass the filter at version 0', () => {
    const id = 'daily:2026-03-04';
    assert.equal(id in currentChartVersions(), false);
    const rows = [{ chartId: id, chartVersion: 0 }, { chartId: id }];
    assert.equal(filterCurrentVersion(rows, currentChartVersions()).length, 2);
});

test('seed SQL covers every chart with its active version', () => {
    const sql = seedSql({ 't:range:hard': 7, 't:range:easy': 0 });
    assert.match(sql, /\('t:range:hard', 7\)/);
    assert.match(sql, /on conflict \(chart_id\) do update/);
    const full = seedSql();
    for (const [id, v] of Object.entries(currentChartVersions())) assert.ok(full.includes(`('${id}', ${v})`));
    const migration = readFileSync(new URL('../../supabase/migrations/0006_seed_chart_versions.sql', import.meta.url), 'utf8');
    assert.equal(migration, full, 'migration 0006 is stale: run node tools/seed-chart-versions.mjs --write');
});
