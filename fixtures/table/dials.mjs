export const dials = { bias: 0, cosmetic: 1, broken: false };

export default {
  meta: { id: 'dial-fixture', name: 'Dial fixture', kind: 'competitive', seats: [2], events: ['never'] },
  init(seats, rng, options) {
    return { turn: 0, round: 1, options, winner: null };
  },
  actions() { return [{ id: 'finish' }]; },
  apply(state, action, rng) {
    state.round = state.options.broken ? 201 : 2;
    if (!state.options.broken) state.winner = rng.chance(state.options.bias) ? 0 : 1;
    return state;
  },
  over(state) { return state.winner !== null; },
  result(state) { return { winners: [state.winner], scores: {} }; },
  value() { return 0; },
};
