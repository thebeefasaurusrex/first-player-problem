// Seeded board-game simulation with built-in bot policies.
// Time model constants (seconds):
export const SECS = { little: 15, big: 25, adult: 30, 'adult-kind': 30 };
export const EVENT_SECS = 6;   // per event animation
export const MOVE_SECS = 2;    // per piece move
export const ROUND_CAP = 200;  // hitting this is reported as a bug
export const STEP_CAP = 40000; // action guard

export function mulberry32(seed) {
  let a = seed >>> 0;
  const r = () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  r.int = (n) => Math.floor(r() * n);                          // 0..n-1
  r.range = (lo, hi) => lo + Math.floor(r() * (hi - lo + 1));  // inclusive
  r.chance = (p) => r() < p;
  r.pick = (arr) => arr[Math.floor(r() * arr.length)];
  r.shuffle = (arr) => { for (let i = arr.length - 1; i > 0; i--) { const j = r.int(i + 1); [arr[i], arr[j]] = [arr[j], arr[i]]; } return arr; };
  r.fork = () => mulberry32(Math.floor(r() * 4294967296));
  return r;
}

// Clone for lookahead; log is dropped (not needed) to stay fast.
export function cloneState(s) {
  const log = s.log; s.log = [];
  const c = structuredClone(s);
  s.log = log; c.log = [];
  return c;
}

function terminalValue(adapter, s, seat) {
  const r = adapter.result(s);
  if (r.winners === 'team') return 1000;
  if (Array.isArray(r.winners)) return r.winners.includes(seat) ? 1000 / r.winners.length : 0;
  return 0;
}
function evalState(adapter, s, seat) {
  return adapter.over(s) ? terminalValue(adapter, s, seat) : adapter.value(s, seat);
}
function legal(adapter, s) {
  const a = adapter.actions(s);
  return a && a.length ? a : [{ id: 'pass', pass: true }];
}

// ---- Bots. Each: (ctx, state, acts, seat) -> action ----
function argmaxRandomTie(items, scoreOf, rng) {
  let best = -Infinity, pool = [];
  for (const it of items) {
    const v = scoreOf(it);
    if (v > best + 1e-9) { best = v; pool = [it]; } else if (Math.abs(v - best) <= 1e-9) pool.push(it);
  }
  return rng.pick(pool);
}
function oneStep(ctx, state, a, seat) {
  const c = cloneState(state);
  ctx.adapter.apply(c, a, ctx.rng.fork());
  return evalState(ctx.adapter, c, seat);
}
export const BOTS = {
  little(ctx, state, acts) {
    const flashy = acts.filter(a => a.flashy);
    if (flashy.length && ctx.rng.chance(0.3)) return ctx.rng.pick(flashy);
    return ctx.rng.pick(acts);
  },
  big(ctx, state, acts, seat) {
    if (acts.length === 1 || ctx.rng.chance(0.15)) return ctx.rng.pick(acts);
    return argmaxRandomTie(acts, a => oneStep(ctx, state, a, seat), ctx.rng);
  },
  adult(ctx, state, acts, seat) {
    if (acts.length === 1) return acts[0];
    const { rollouts = 8, maxActs = 10, depth = state.seats.length * 2 } = ctx.options.bot || {};
    let cand = acts;
    if (cand.length > maxActs) cand = ctx.rng.shuffle(cand.slice()).slice(0, maxActs);
    return argmaxRandomTie(cand, a => {
      let sum = 0;
      for (let k = 0; k < rollouts; k++) {
        const r = ctx.rng.fork();
        const c = cloneState(state);
        ctx.adapter.apply(c, a, r);
        for (let d = 0; d < depth && !ctx.adapter.over(c) && c.round <= ROUND_CAP; d++) {
          ctx.adapter.apply(c, r.pick(legal(ctx.adapter, c)), r);
        }
        sum += evalState(ctx.adapter, c, seat);
      }
      return sum / rollouts;
    }, ctx.rng);
  },
  'adult-kind'(ctx, state, acts, seat) {
    let a2 = acts;
    if (ctx.adapter.meta.kind !== 'coop') {
      const f = acts.filter(a => !(a.hurts !== undefined && state.seats[a.hurts] === 'little'));
      if (f.length) a2 = f;
    }
    return BOTS.adult(ctx, state, a2, seat);
  },
};

// ---- Play one game, return a record ----
export function playGame(adapter, seats, seed, options = {}) {
  const rng = mulberry32(seed);
  const bots = { rng, adapter, options };
  const state = adapter.init(seats, rng, options);
  state.seats = seats; state.log = state.log || []; state.round = state.round || 1;
  let clock = 0, steps = 0, capHit = false;
  const lastEnd = {}, waits = [], touches = [];
  const leaders = [];          // leaders[r] = seats tied for best value at end of round r
  let lastRound = state.round;
  const compete = adapter.meta.kind !== 'coop';

  while (!adapter.over(state)) {
    if (state.round > ROUND_CAP || ++steps > STEP_CAP) { capHit = true; break; }
    const seat = state.turn;
    const type = seats[seat];
    const acts = legal(adapter, state);
    const act = BOTS[type](bots, state, acts, seat);
    if (type === 'little' && lastEnd[seat] !== undefined) waits.push(clock - lastEnd[seat]);
    const logBefore = state.log.length, clock0 = clock;
    adapter.apply(state, act, rng);
    let ev = 0, tl = 0;
    for (let k = logBefore; k < state.log.length; k++) { if (state.log[k].touch === 'little') tl++; else ev++; }
    clock += (SECS[type] || 30) + EVENT_SECS * ev + MOVE_SECS * (act.moves || 0);
    if (type === 'little') lastEnd[seat] = clock;
    if (type === 'little' || act.littleTouch || tl) touches.push([type === 'little' ? clock0 : clock, clock]);
    if (state.round !== lastRound) {
      if (compete) {
        const vs = seats.map((_, i) => adapter.value(state, i)); const m = Math.max(...vs);
        for (let r = lastRound; r < state.round; r++) leaders[r] = vs.map((v, i) => v === m ? i : -1).filter(i => i >= 0);
      }
      lastRound = state.round;
    }
  }
  const res = capHit ? { winners: 'none', scores: {} } : adapter.result(state);
  const touchWaits = []; for (let i = 1; i < touches.length; i++) touchWaits.push(touches[i][0] - touches[i - 1][1]);
  return { rounds: state.round, seconds: clock, capHit, res, log: state.log, waits, touchWaits, leaders };
}

// ---- Stats ----
const q = (arr, p) => { if (!arr.length) return null; const s = arr.slice().sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * (s.length - 1) + 0.5))]; };
const r1 = (x) => x === null || x === undefined ? null : Math.round(x * 10) / 10;

export function runConfig(adapter, seats, games, seed, options = {}, observe) {
  const t0 = Date.now();
  const recs = [];
  for (let g = 0; g < games; g++) recs.push(playGame(adapter, seats, seed * 1000003 + g, options));
  observe?.(recs);
  const n = recs.length;
  const kind = adapter.meta.kind;
  const rounds = recs.map(r => r.rounds), mins = recs.map(r => r.seconds / 60);
  const out = {
    seats, games: n, ms: Date.now() - t0,
    capHits: recs.filter(r => r.capHit).length,
    rounds: { median: q(rounds, .5), p10: q(rounds, .1), p90: q(rounds, .9) },
    minutes: { median: r1(q(mins, .5)), p10: r1(q(mins, .1)), p90: r1(q(mins, .9)) },
  };
  const types = [...new Set(seats)];
  if (kind === 'coop') {
    out.teamWinRate = r1(100 * recs.filter(r => r.res.winners === 'team').length / n);
    // optional result.margin (>=0, 0 = squeaker): histogram for wins and losses
    const bin = (m) => m <= 0 ? '0' : m === 1 ? '1' : m === 2 ? '2' : m <= 4 ? '3-4' : '5+';
    const nm = { wins: {}, losses: {} }; let any = false;
    for (const r of recs) {
      const m = r.res.margin; if (m === undefined) continue; any = true;
      const side = r.res.winners === 'team' ? nm.wins : nm.losses;
      const b = bin(Math.abs(m)); side[b] = (side[b] || 0) + 1;
    }
    if (any) out.nearMiss = nm;
  } else {
    const bySeat = seats.map(() => 0); let none = 0;
    for (const r of recs) {
      const ws = Array.isArray(r.res.winners) ? r.res.winners : [];
      if (!ws.length) none++;
      for (const s of ws) bySeat[s] += 1 / ws.length;
    }
    out.winRateBySeat = bySeat.map((x, i) => ({ seat: i, type: seats[i], pct: r1(100 * x / n) }));
    out.winRateByType = {};
    for (const t of types) {
      const idx = seats.map((x, i) => x === t ? i : -1).filter(i => i >= 0);
      out.winRateByType[t] = r1(100 * idx.reduce((a, i) => a + bySeat[i], 0) / n / idx.length);
    }
    out.fairShare = r1(100 / seats.length);
    out.noWinner = r1(100 * none / n);
    let tot = 0, hit = 0;
    for (const r of recs) {
      if (r.capHit || !Array.isArray(r.res.winners)) continue;
      const half = Math.max(1, Math.floor(r.rounds / 2));
      const L = r.leaders[half]; if (!L) continue;
      tot++; hit += L.filter(s => r.res.winners.includes(s)).length / L.length;
    }
    out.runaway = { leaderWinsPct: tot ? r1(100 * hit / tot) : null, fairShare: out.fairShare, sampled: tot };
  }
  const ev = {};
  for (const r of recs) {
    const seen = {};
    for (const e of r.log) if (e.event && !seen[e.event]) { seen[e.event] = 1; (ev[e.event] ||= []).push(e.round); }
  }
  out.events = Object.fromEntries(Object.entries(ev).map(([k, v]) => [k, { firedPct: r1(100 * v.length / n), medianRound: q(v, .5) }]));
  if (adapter.meta.events) for (const k of adapter.meta.events) if (!out.events[k]) out.events[k] = { firedPct: 0, medianRound: null };
  if (seats.includes('little')) {
    const all = recs.flatMap(r => r.waits), maxes = recs.map(r => r.waits.length ? Math.max(...r.waits) : 0);
    out.littleWaitSec = { median: r1(q(all, .5)), p90: r1(q(all, .9)), maxEver: all.reduce((m, x) => x > m ? x : m, 0), medianOfGameMax: r1(q(maxes, .5)) };
    const tall = recs.flatMap(r => r.touchWaits), tmax = recs.map(r => r.touchWaits.length ? Math.max(...r.touchWaits) : 0);
    out.littleTouchWaitSec = { median: r1(q(tall, .5)), p90: r1(q(tall, .9)), maxEver: tall.reduce((m, x) => x > m ? x : m, 0), medianOfGameMax: r1(q(tmax, .5)) };
  }
  return out;
}

export function matrixFor(adapter) {
  const ok = adapter.meta.seats || [2, 3, 4];
  const all = [
    ['4p', ['adult', 'adult', 'big', 'little']],
    ['3p', ['adult', 'big', 'little']],
    ['2p', ['adult', 'little']],
  ].filter(([, s]) => ok.includes(s.length));
  if (adapter.meta.kind !== 'coop' && ok.includes(4)) all.push(['4p-kind', ['adult-kind', 'adult-kind', 'big', 'little']]);
  return all;
}

export function reportMd(adapter, results) {
  const m = adapter.meta;
  let s = `# ${m.name} (${m.id}) sim report\n\nKind: ${m.kind}. Time model: little ${SECS.little}s, big ${SECS.big}s, adult ${SECS.adult}s, +${EVENT_SECS}s/event, +${MOVE_SECS}s/move.\n\n`;
  for (const [label, r] of results) {
    s += `## ${label}: ${r.seats.join(', ')}  (${r.games} games, ${r.ms} ms)\n`;
    s += `- Rounds median ${r.rounds.median} (p10 ${r.rounds.p10}, p90 ${r.rounds.p90}); minutes median ${r.minutes.median} (p10 ${r.minutes.p10}, p90 ${r.minutes.p90})\n`;
    s += `- Safety cap hits: ${r.capHits}${r.capHits ? '  **BUG: game did not end**' : ''}\n`;
    if (r.teamWinRate !== undefined) {
      s += `- Team win rate ${r.teamWinRate}% (target 60-70)\n`;
      if (r.nearMiss) s += `- Near-miss margins: wins ${JSON.stringify(r.nearMiss.wins)}, losses ${JSON.stringify(r.nearMiss.losses)}\n`;
    } else {
      s += `- Win rate by type (fair share ${r.fairShare}%): ${Object.entries(r.winRateByType).map(([k, v]) => `${k} ${v}%`).join(', ')}; no winner ${r.noWinner}%\n`;
      s += `- Runaway: halfway leader wins ${r.runaway.leaderWinsPct}% (sampled ${r.runaway.sampled})\n`;
    }
    const evs = Object.entries(r.events);
    s += evs.length ? `- Events: ${evs.map(([k, v]) => `${k} ${v.firedPct}% of games, median round ${v.medianRound}`).join('; ')}\n` : '- Events: none fired\n';
    if (r.littleTouchWaitSec) s += `- 4-year-old wait between any touch (own turn or side job): median ${r.littleTouchWaitSec.median}s, p90 ${r.littleTouchWaitSec.p90}s, worst ${r.littleTouchWaitSec.maxEver}s, median of per-game worst ${r.littleTouchWaitSec.medianOfGameMax}s
`;
    if (r.littleWaitSec) s += `- 4-year-old wait between own actions: median ${r.littleWaitSec.median}s, p90 ${r.littleWaitSec.p90}s, worst ${r.littleWaitSec.maxEver}s, median of per-game worst ${r.littleWaitSec.medianOfGameMax}s (limit ~60)\n`;
    s += '\n';
  }
  return s;
}
