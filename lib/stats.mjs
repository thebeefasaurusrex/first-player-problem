export function wilson(successes, total) {
  if (!total) return null;
  const z = 1.959963984540054;
  const rate = successes / total;
  const zSquared = z ** 2;
  const divisor = 1 + zSquared / total;
  const center = (rate + zSquared / (2 * total)) / divisor;
  const radius = z * Math.sqrt((rate * (1 - rate) + zSquared / (4 * total)) / total) / divisor;
  return [Math.max(0, center - radius), Math.min(1, center + radius)];
}
