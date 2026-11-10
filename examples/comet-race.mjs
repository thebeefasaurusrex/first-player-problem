export const dials = { finish: 12, secondSeatBoost: 0 };

export default {
  meta: { id: 'comet-race', name: 'Comet Race', kind: 'competitive', seats: [2] },

  init(seats, rng, { finish, secondSeatBoost }) {
    return { turn: 0, round: 1, positions: [0, secondSeatBoost], finish };
  },

  actions() {
    return [{ id: 'coast' }, { id: 'boost', flashy: true }];
  },

  apply(state, action, rng) {
    const distance = action.id === 'coast' ? 2 : rng.range(0, 5);
    state.positions[state.turn] += distance;
    state.turn = (state.turn + 1) % state.positions.length;
    if (state.turn === 0) state.round++;
  },

  over(state) {
    return state.positions.some((position) => position >= state.finish);
  },

  result(state) {
    return {
      winners: [state.positions.findIndex((position) => position >= state.finish)],
      scores: Object.fromEntries(state.positions.entries()),
    };
  },

  value(state, seat) {
    return state.positions[seat];
  },
};
