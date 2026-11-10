# First Player Problem

Run seeded bot matches to measure seat advantage and compare variants of a board game's rules.

## Install and try it

Install Node.js 22. First Player Problem has no runtime npm dependencies.

```sh
git clone https://github.com/thebeefasaurusrex/first-player-problem.git
cd first-player-problem
node bin/first-player-problem.mjs --help
node bin/first-player-problem.mjs run examples/comet-race.mjs --games 1000 --seed 7 --seats big,big
node bin/first-player-problem.mjs sweep examples/comet-race.mjs --games 1000 --seed 7 --seats big,big --dial secondSeatBoost=0,1,2
```

In Comet Race, each player either coasts two spaces or boosts by a random amount. The sweep changes how far ahead the second player starts so you can see how that affects win rates. Look for per-seat win percentages and Wilson intervals in the output. Add `--full` to the sweep command to print the individual report paths, then pass two of those paths to `node bin/first-player-problem.mjs compare`.

## Adapt your game

The simulator loads a JavaScript adapter. Run adapters you trust, since they execute as Node code. Use [Comet Race](examples/comet-race.mjs) as the starting point.

- Export a default object with `meta` containing an `id`, `name`, a `kind` of `competitive`, `coop`, `teams`, or `hybrid`, and optionally the supported seat counts.
- `init(seats, rng, options)` returns game state, including the current zero-based `turn` and `round`. `actions(state)` returns the legal action objects.
- `apply(state, action, rng)` mutates the state and advances the turn or round as appropriate. Keep game state compatible with `structuredClone` so bots can explore moves. Use the supplied seeded RNG for repeatability.
- `over(state)` detects a finished game. `result(state)` returns `winners` and `scores`. Use an array of winning seat indexes for competitive play, or `'team'` for a cooperative win. `value(state, seat)` gives bots a score for choosing moves before the game ends.
- Export a `dials` object with defaults for the rule options you want to sweep. Select built-in bot policies with `--seats` using `little`, `big`, `adult`, or `adult-kind`.

Reports and source stamps are written to `.gt/table/` in the current directory. Stamps can include local paths. The default stamp tracks neighboring JavaScript and JSON files. Add a `gt.json` file with a `sources` glob array to include adapters' dependencies in other folders. A changed source or modified report makes a saved comparison stale.

Run `npm test` to verify repeatable runs and sweeps, stale comparisons, and simulation caps. Timing uses estimated turn lengths. Use real playtests to assess how a rule change feels.

## License

Original project code is licensed under [Apache 2.0](LICENSE). See [NOTICE](NOTICE) for attribution.
