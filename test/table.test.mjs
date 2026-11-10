import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { appendFile, copyFile, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const cli = fileURLToPath(new URL('../bin/first-player-problem.mjs', import.meta.url));
const fixture = fileURLToPath(new URL('../fixtures/table/dials.mjs', import.meta.url));

async function sandbox() {
  const cwd = await mkdtemp(path.join(tmpdir(), 'first-player-problem-'));
  const adapter = path.join(cwd, 'dials.mjs');
  await copyFile(fixture, adapter);
  const run = (...args) => {
    const result = spawnSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8' });
    assert.ok(result.stdout.trim().split(/\r?\n/).length <= 20);
    return result;
  };
  return { adapter, run, remove: () => rm(cwd, { recursive: true, force: true }) };
}

const resultPath = (result) => result.stdout.trim().split(/\r?\n/).at(-1);

test('First Player Problem run and sweep are deterministic, and distinguish a rule change from a no-op', async (t) => {
  const { adapter, run, remove } = await sandbox();
  t.after(remove);
  const settings = ['--games', '100', '--seed', '19', '--seats', 'adult,little'];
  const first = run('run', adapter, ...settings);
  assert.equal(first.status, 0, first.stderr);
  assert.match(first.stdout, /Seat 1 adult 0\.0%.*Seat 2 little 100\.0%/);
  assert.match(first.stdout, /Never fired: never/);
  const path = resultPath(first);
  const bytes = await readFile(path);
  const second = run('run', adapter, ...settings);
  assert.equal(second.status, 0, second.stderr);
  assert.equal(second.stdout, first.stdout);
  assert.deepEqual(await readFile(path), bytes);

  const sweep = () => run('sweep', adapter, ...settings, '--dial', 'bias=0,1', '--dial', 'cosmetic=1,2');
  const swept = sweep();
  assert.equal(swept.status, 0, swept.stderr);
  assert.match(swept.stdout, /Real change vs case 1/);
  assert.match(swept.stdout, /Within noise vs case 1/);
  const sweepBytes = await readFile(resultPath(swept));
  assert.equal(sweep().stdout, swept.stdout);
  assert.deepEqual(await readFile(resultPath(swept)), sweepBytes);
  const { cases } = JSON.parse(sweepBytes);
  assert.deepEqual(cases.map(({ options }) => [options.bias, options.cosmetic]), [[0, 1], [0, 2], [1, 1], [1, 2]]);

  const changed = run('compare', cases[0].path, cases[2].path);
  assert.equal(changed.status, 0, changed.stderr);
  assert.match(changed.stdout, /0\.0% to 100\.0% \(real change\)/);
  const unchanged = run('compare', cases[0].path, cases[1].path);
  assert.equal(unchanged.status, 0, unchanged.stderr);
  assert.match(unchanged.stdout, /0\.0% to 0\.0% \(within noise\)/);

  await appendFile(adapter, '\n// Source changed after the reports.\n');
  const stale = run('compare', cases[0].path, cases[2].path);
  assert.equal(stale.status, 3, stale.stderr);
  assert.match(stale.stdout, /^STALE/);
});

test('First Player Problem returns exit 1 when a broken rule hits the simulation cap', async (t) => {
  const { adapter, run, remove } = await sandbox();
  t.after(remove);
  const result = run('sweep', adapter, '--games', '10', '--seats', 'adult,little', '--dial', 'broken=true');
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stdout, /cap hits 10/);
});
