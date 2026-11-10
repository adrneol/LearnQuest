// Keep the Arena singleton validation aligned with the frontend backup and load validator.
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown, limit: number) => typeof value === 'string' && value.trim().length > 0 && value.length <= limit;
const integer = (value: unknown, min: number, max: number): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max;
const number = (value: unknown, max: number) => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= max;
const instant = (value: unknown) => typeof value === 'string' && value.length <= 32 && Number.isFinite(Date.parse(value));
const date = (value: unknown) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
const zone = (value: unknown) => {
  if (typeof value !== 'string' || !text(value, 100) || value === 'local') return false;
  try { new Intl.DateTimeFormat('en', { timeZone: value }); return true; }
  catch { return false; }
};

export function isArenaLedger(value: unknown): boolean {
  if (!object(value) || value.version !== 1 || !Array.isArray(value.history) || value.history.length > 20) return false;
  const ids = new Set<unknown>();
  const validRun = (run: unknown, archived: boolean) => {
    if (!object(run) || !text(run.id, 100) || ids.has(run.id) || run.model !== 'arena-v3' || !zone(run.zone)
      || !instant(run.startedAt) || !object(run.setup) || !object(run.basis)) return false;
    ids.add(run.id);
    const { setup, basis } = run;
    if (!text(setup.name, 80) || !integer(setup.seed, -Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER)
      || !integer(setup.days, 1, 90) || !integer(setup.opponents, 1, 2000)
      || !['relaxed', 'balanced', 'challenging'].includes(String(setup.difficulty))) return false;
    const dates = (list: unknown): list is string[] => Array.isArray(list) && list.length === setup.days
      && list.every(date) && list.every((key, index) => !index || list[index - 1] < key);
    if (setup.kind === 'fixed') {
      if (!dates(run.dates) || !instant(run.endsAt) || Date.parse(String(run.endsAt)) <= Date.parse(String(run.startedAt))) return false;
    } else if (setup.kind !== 'practice' || run.endsAt !== null || run.dates !== null) return false;
    if (archived ? !['archived', 'completed'].includes(String(run.state)) : !['active', 'paused'].includes(String(run.state))) return false;
    if (run.state === 'paused' && setup.kind !== 'practice') return false;
    if (!text(basis.playlistId, 128) || typeof basis.title !== 'string' || basis.title.length > 500
      || !Array.isArray(basis.entries) || basis.entries.length < 1 || basis.entries.length > 1000) return false;
    const occurrenceIds = new Set<string>();
    let position = 0;
    let duration = 0;
    for (const item of basis.entries) {
      if (!Array.isArray(item) || item.length !== 4 || !integer(item[0], position + 1, 1000)
        || !text(item[1], 200) || occurrenceIds.has(item[1]) || typeof item[2] !== 'string' || item[2].length > 64
        || !integer(item[3], 0, 10_000_000)) return false;
      occurrenceIds.add(item[1]);
      position = item[0];
      duration += item[3];
    }
    if (duration <= 0 || !Array.isArray(run.samples) || run.samples.length > 90 || !run.samples.every((sample) =>
      object(sample) && instant(sample.at) && integer(sample.of, 1, (setup.opponents as number) + 1)
      && integer(sample.rank, 1, sample.of) && number(sample.score, 100))) return false;
    const result = run.result;
    if (run.state === 'active') return result === null;
    return object(result) && instant(result.asOf) && dates(result.dates)
      && (!run.dates || (run.dates as string[]).every((key, index) => (result.dates as string[])[index] === key))
      && integer(result.observedDays, 0, setup.days) && number(result.uniqueContentSec, duration)
      && integer(result.rankedCount, 0, setup.opponents + 1)
      && (result.rank === null || integer(result.rank, 1, result.rankedCount))
      && (result.score === null || number(result.score, 100))
      && Array.isArray(result.daily) && result.daily.length === setup.days
      && result.daily.every((day, index) => object(day) && day.dateKey === (result.dates as string[])[index]
        && number(day.contentGainSec, duration) && typeof day.completedVideo === 'boolean'
        && number(day.focusSec, 1_000_000_000) && number(day.activePlaybackSec, 100_000));
  };
  return (value.active === null || validRun(value.active, false)) && value.history.every((run) => validRun(run, true));
}
