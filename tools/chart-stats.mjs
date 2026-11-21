/**
 * chart-stats.mjs
 *
 * Builds every official chart and asserts its measured density (notes per
 * second over the bars it uses) against data/rules.json:
 *   Easy 0.95, Normal 1.6, Hard 2.4 within +-10%; Expert >= 3.2.
 * Exits non-zero on any violation.
 */
import { allTrackCharts } from '../src/game/rules/charts.js';
import { BeatMap } from '../src/game/rules/BeatMap.js';
import { chartDensity } from '../src/game/rules/rules.js';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chartQualityProblems } from './lib/chart-quality.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const TARGET = { easy: 0.95, normal: 1.6, hard: 2.4 };
const EXPERT_MIN = 3.2;
let failures = 0;

for (const chart of allTrackCharts()) {
    const notes = new BeatMap(chart).notes.length;
    const nps = chartDensity(notes, chart.bpm, chart.bars, chart.firstNoteBar);
    const id = chart.difficulty.id;
    const ok = id === 'expert'
        ? nps >= EXPERT_MIN
        : Math.abs(nps - TARGET[id]) <= TARGET[id] * 0.1;
    if (!ok) {
        failures += 1;
    }
    // authored Hard/Expert charts must also pass the musical-quality checks
    const file = resolve(root, 'charts', chart.chartId.split(':')[1], `${id}.json`);
    if ((id === 'hard' || id === 'expert') && existsSync(file)) {
        for (const p of chartQualityProblems(JSON.parse(readFileSync(file, 'utf8')), id)) {
            failures += 1;
            console.log(`FAIL ${chart.chartId}: ${p}`);
        }
    }
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${chart.chartId.padEnd(22)} ${String(notes).padStart(4)} notes ${nps.toFixed(2)} n/s`);
}
if (failures) {
    console.error(`${failures} chart(s) outside the density / quality rules`);
    process.exit(1);
}
console.log('chart density ok');
