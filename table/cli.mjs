import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { BOTS, matrixFor } from './harness.mjs';
import { compareRuns, describeComparison, describeRun, simulate } from './report.mjs';
import { freshReport, identity, save, sha } from './evidence.mjs';

function print(lines, footer, full) {
  for (const line of (full ? lines : lines.slice(0, 19))) console.log(line);
  console.log(footer);
}

function directory(mode, id, inputs) {
  const name = id.replace(/[^a-z0-9_-]/gi, '-').slice(0, 40);
  const key = sha(JSON.stringify(inputs)).slice(0, 16);
  return path.resolve('.gt', 'table', mode, name + '-' + key);
}

function integer(value, name, min = Number.MIN_SAFE_INTEGER) {
  const number = Number(value);
  if (!/^-?\d+$/.test(value) || !Number.isSafeInteger(number) || number < min) throw new Error(name + ' needs a valid integer.');
  return number;
}

function dialValue(value) {
  if (value === '') throw new Error('Dial values cannot be empty.');
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function variants(defaults, dials) {
  const names = new Set();
  let rows = [{ ...defaults }];
  for (const dial of dials) {
    const separator = dial.indexOf('=');
    const name = dial.slice(0, separator);
    if (separator <= 0 || !/^[a-zA-Z][\w-]*$/.test(name) || names.has(name)) throw new Error('Each dial needs a distinct name and values: name=a,b.');
    names.add(name);
    const values = dial.slice(separator + 1).split(',').map(dialValue);
    if (rows.length * values.length > 1000) throw new Error('A sweep can contain up to 1,000 cases.');
    rows = rows.flatMap((row) => values.map((value) => ({ ...row, [name]: value })));
  }
  return rows;
}

const capHits = (report) => Object.values(report.results).reduce((sum, result) => sum + result.capHits, 0);

export async function table(args) {
  const start = performance.now();
  const [command, ...rest] = args;
  const { values, positionals } = parseArgs({
    args: rest, allowPositionals: true,
    options: { games: { type: 'string' }, seed: { type: 'string' }, seats: { type: 'string' }, dial: { type: 'string', multiple: true }, full: { type: 'boolean' } },
  });

  if (command === 'compare' && positionals.length === 2) {
    if (values.games || values.seed || values.seats || values.dial) throw new Error('Compare takes two report paths and optional --full.');
    const files = positionals.map((file) => path.resolve(file));
    const inputs = files.map(freshReport);
    if (inputs.some((input) => !input)) {
      console.log('STALE First Player Problem report or stamp: ' + files[inputs.indexOf(null)]);
      return 3;
    }
    const [before, after] = inputs.map(({ report }) => report);
    const comparisons = compareRuns(before, after);
    const report = { type: 'table-compare', adapter: before.meta.id, comparisons };
    const evidence = { inputs: inputs.map(({ identity, sha256 }) => ({ identity, sha256 })), seed: [before.seed, after.seed], args, wallTimeMs: Math.round(performance.now() - start) };
    const file = save(directory('compare', before.meta.id, evidence.inputs), report, evidence);
    print(['First Player Problem compare ' + before.meta.name + ' | Wilson 95%', ...comparisons.map(describeComparison)], file, values.full);
    return 0;
  }

  if (!['run', 'sweep'].includes(command) || positionals.length !== 1) {
    throw new Error('Usage: first-player-problem run|sweep <adapter.mjs> [--games N] [--seed S] [--seats a,b,c] [--dial name=a,b], or first-player-problem compare <a.json> <b.json>.');
  }
  if (command === 'sweep' && !values.dial?.length) throw new Error('Sweep needs at least one --dial name=a,b.');
  if (command === 'run' && values.dial) throw new Error('Use sweep to set dials.');

  const adapterPath = path.resolve(positionals[0]);
  const stamp = identity(adapterPath);
  const module = await import(pathToFileURL(adapterPath).href);
  const adapter = module.default;
  const meta = adapter?.meta;
  if (!meta?.id || typeof meta.id !== 'string' || typeof meta.name !== 'string' || !['coop', 'competitive', 'teams', 'hybrid'].includes(meta.kind) ||
      !['init', 'actions', 'apply', 'over', 'result', 'value'].every((key) => typeof adapter[key] === 'function')) {
    throw new Error('Adapter needs a default export with meta, init, actions, apply, over, result, and value.');
  }
  const defaults = module.dials ?? adapter.dials ?? {};
  if (!defaults || Array.isArray(defaults) || typeof defaults !== 'object') throw new Error('Adapter dial defaults must be an object.');
  const games = integer(values.games ?? '3000', '--games', 1);
  const seed = integer(values.seed ?? '1', '--seed');
  if (!Number.isSafeInteger(seed * 1000003) || !Number.isSafeInteger(seed * 1000003 + games - 1)) throw new Error('Seed and game count exceed the supported range.');
  const configs = values.seats !== undefined ? [['custom', values.seats.split(',').map((item) => item.trim())]] : matrixFor(adapter);
  if (!configs.length || configs.some(([, seats]) => !(meta.seats ?? [2, 3, 4]).includes(seats.length) || !seats.every((seat) => Object.hasOwn(BOTS, seat)))) {
    throw new Error('Use a supported seat count with adult, adult-kind, big or little bots.');
  }

  const options = variants(defaults, values.dial ?? []);
  const runs = options.map((option) => ({
    type: 'table-run', meta, games, seed, options: option,
    results: Object.fromEntries(configs.map(([label, seats]) => [label, simulate(adapter, seats, games, seed, option)])),
  }));
  if (JSON.stringify(identity(adapterPath)) !== JSON.stringify(stamp)) {
    console.log('STALE adapter changed during First Player Problem run: ' + adapterPath);
    return 3;
  }
  const evidence = { identity: stamp, seed, args, wallTimeMs: Math.round(performance.now() - start) };
  const files = runs.map((run) => save(directory('runs', meta.id, [stamp, run.options, games, seed, configs]), run, evidence));
  const count = runs.reduce((sum, run) => sum + capHits(run), 0);

  if (command === 'run') {
    const details = Object.entries(runs[0].results).flatMap(([label, result]) => describeRun(label, result));
    print(['First Player Problem ' + meta.name + ' | seed ' + seed + ' | Wilson 95%', ...details], files[0], values.full);
    return count ? 1 : 0;
  }

  const cases = runs.map((run, index) => ({ options: run.options, capHits: capHits(run), path: files[index], comparisons: index ? compareRuns(runs[0], run) : [] }));
  const report = { type: 'table-sweep', meta, games, seed, cases };
  const file = save(directory('sweep', meta.id, [stamp, options, games, seed, configs]), report, evidence);
  const lines = cases.flatMap(({ options, capHits, path, comparisons }, index) => [
    'Case ' + (index + 1) + ' ' + JSON.stringify(options) + ' | cap hits ' + capHits + (index === 0 ? ' | baseline' : ''),
    ...(values.full ? [...comparisons.map(describeComparison), path] :
      index ? [comparisons.some(({ wins }) => wins.some(({ change }) => change === 'real change')) ? '  Real change vs case 1' : '  Within noise vs case 1'] : []),
  ]);
  print(['First Player Problem sweep ' + meta.name + ' | ' + cases.length + ' cases | cap hits ' + count + ' | Wilson 95%', ...lines], file, values.full);
  return count ? 1 : 0;
}
