import { wilson } from '../lib/stats.mjs';
import { runConfig, SECS } from './harness.mjs';

const baseTiming = { ...SECS };

export function simulate(adapter, seats, games, seed, options) {
  const timing = adapter.meta.secs;
  Object.assign(SECS, baseTiming, timing);
  if (timing?.adult !== undefined && timing['adult-kind'] === undefined) SECS['adult-kind'] = timing.adult;
  if (adapter.stats) for (const key of Object.keys(adapter.stats)) adapter.stats[key] = 0;

  const seatWins = seats.map(() => 0);
  let teamWins = 0;
  const fired = new Set();
  const { ms, ...summary } = runConfig(adapter, seats, games, seed, options, (records) => {
    for (const { res, log } of records) {
      for (const { event } of log) if (event) fired.add(event);
      if (res.winners === 'team' || res.team) teamWins++;
      if (!Array.isArray(res.winners)) continue;
      for (const seat of res.winners) seatWins[seat] += 1 / res.winners.length;
    }
  });

  const win = (label, successes) => ({ label, successes, games, interval: wilson(successes, games) });
  const wins = summary.winRateBySeat?.map(({ seat, type }) => win('Seat ' + (seat + 1) + ' ' + type, seatWins[seat])) ?? [];
  if (adapter.meta.kind === 'coop' || adapter.meta.kind === 'hybrid') wins.unshift(win('Team', teamWins));

  const neverFired = Object.keys(summary.events).filter((event) => !fired.has(event));
  return { ...summary, wins, neverFired, ...(adapter.stats ? { extra: { ...adapter.stats } } : {}) };
}

const percent = (value) => (100 * value).toFixed(1) + '%';
const rate = (win) => percent(win.successes / win.games);
export const describeWin = (win) => win.label + ' ' + rate(win) + ' (' + win.interval.map(percent).join(' to ') + ')';

function waits(label, stats) {
  if (!stats) return label + ' n/a';
  const { median, p90, maxEver } = stats;
  return median === null ? label + ' n/a' : label + ' ' + median + 's median / ' + p90 + 's p90 / ' + maxEver + 's max';
}

export function describeRun(label, result) {
  const never = result.neverFired;
  const runaway = result.runaway?.leaderWinsPct;
  return [
    label + ' | ' + result.games + ' games | ' + result.minutes.median + ' min median / ' + result.minutes.p90 + ' p90 | cap hits ' + result.capHits,
    result.wins.map(describeWin).join(' | '),
    'Age 4 | ' + waits('own turn', result.littleWaitSec) + ' | ' + waits('any touch', result.littleTouchWaitSec),
    'Never fired: ' + (never.join(', ') || 'none') + ' | halfway leader won ' + (runaway == null ? 'n/a' : runaway + '%'),
  ];
}

export function compareRuns(before, after) {
  if (before.meta.id !== after.meta.id) throw new Error('Compare reports from the same adapter id.');
  const labels = Object.keys(before.results);
  if (labels.length !== Object.keys(after.results).length) throw new Error('Compare runs with the same seat configurations.');
  return labels.map((label) => {
    const a = before.results[label];
    const b = after.results[label];
    if (!b || JSON.stringify(a.seats) !== JSON.stringify(b.seats)) throw new Error('Compare runs with the same seat configurations.');
    if (a.wins.length !== b.wins.length) throw new Error('Compare runs with the same win metrics.');
    return {
      label,
      wins: a.wins.map((from, index) => {
        const to = b.wins[index];
        if (from.label !== to.label) throw new Error('Compare runs with the same win metrics.');
        const real = from.interval[1] < to.interval[0] || to.interval[1] < from.interval[0];
        return { from, to, change: real ? 'real change' : 'within noise' };
      }),
    };
  });
}

export function describeComparison({ label, wins }) {
  return label + ' | ' + wins.map(({ from, to, change }) => from.label + ' ' + rate(from) + ' to ' + rate(to) + ' (' + change + ')').join(' | ');
}
