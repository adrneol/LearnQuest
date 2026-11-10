/** Inclusive zero-based scale. Calculate from integer multiples to avoid drift. */
export function niceTicks(max: number, steps = 4): number[] {
  if (!Number.isFinite(max) || max <= 0) return [0, 1];
  const raw = max / Math.max(1, Math.min(20, steps));
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  if (!magnitude || !Number.isFinite(magnitude)) return [0, max];
  const residual = raw / magnitude;
  const step = (residual <= 1 ? 1 : residual <= 2 ? 2 : residual <= 2.5 ? 2.5 : residual <= 5 ? 5 : 10) * magnitude;
  const intervals = Math.ceil(max / step - 1e-12);
  const ticks = Array.from({ length: intervals + 1 }, (_, i) => Number((i * step).toPrecision(15)));
  const last = ticks.length - 1;
  if (ticks[last] < max || !Number.isFinite(ticks[last])) ticks[last] = max;
  return ticks;
}
