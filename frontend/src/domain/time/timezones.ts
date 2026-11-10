// Timezone catalogue: full IANA list when the runtime supports
// Intl.supportedValuesOf('timeZone'), otherwise a dependable curated fallback
// covering every major region (never just a handful of cities).
// Offsets are always COMPUTED via Intl for a given instant — never hardcoded,
// so DST and historical changes are respected.

const FALLBACK_ZONES = [
  'UTC',
  'Europe/London', 'Europe/Paris', 'Europe/Berlin', 'Europe/Rome', 'Europe/Madrid',
  'Europe/Amsterdam', 'Europe/Brussels', 'Europe/Vienna', 'Europe/Zurich', 'Europe/Stockholm',
  'Europe/Oslo', 'Europe/Copenhagen', 'Europe/Helsinki', 'Europe/Athens', 'Europe/Istanbul',
  'Europe/Moscow', 'Europe/Kiev', 'Europe/Warsaw', 'Europe/Prague', 'Europe/Budapest',
  'Europe/Bucharest', 'Europe/Lisbon', 'Europe/Dublin', 'Atlantic/Azores', 'Atlantic/Reykjavik',
  'Africa/Cairo', 'Africa/Lagos', 'Africa/Nairobi', 'Africa/Johannesburg', 'Africa/Casablanca',
  'Africa/Algiers', 'Africa/Accra', 'Africa/Addis_Ababa', 'Africa/Dar_es_Salaam',
  'Asia/Dubai', 'Asia/Riyadh', 'Asia/Qatar', 'Asia/Karachi', 'Asia/Kolkata', 'Asia/Colombo',
  'Asia/Dhaka', 'Asia/Kathmandu', 'Asia/Almaty', 'Asia/Tashkent', 'Asia/Bangkok',
  'Asia/Jakarta', 'Asia/Singapore', 'Asia/Kuala_Lumpur', 'Asia/Manila', 'Asia/Hong_Kong',
  'Asia/Shanghai', 'Asia/Taipei', 'Asia/Seoul', 'Asia/Tokyo', 'Asia/Osaka',
  'Asia/Vladivostok', 'Asia/Magadan', 'Asia/Kamchatka', 'Asia/Tehran', 'Asia/Baghdad',
  'Asia/Jerusalem', 'Asia/Amman', 'Asia/Beirut', 'Asia/Tbilisi', 'Asia/Yerevan', 'Asia/Baku',
  'Australia/Perth', 'Australia/Darwin', 'Australia/Brisbane', 'Australia/Adelaide',
  'Australia/Sydney', 'Australia/Melbourne', 'Australia/Hobart', 'Pacific/Auckland',
  'Pacific/Fiji', 'Pacific/Guam', 'Pacific/Honolulu', 'Pacific/Auckland', 'Pacific/Tongatapu',
  'Pacific/Chatham', 'Pacific/Midway', 'Pacific/Pago_Pago',
  'America/Anchorage', 'America/Los_Angeles', 'America/Denver', 'America/Chicago',
  'America/New_York', 'America/Toronto', 'America/Vancouver', 'America/Edmonton',
  'America/Winnipeg', 'America/Halifax', 'America/St_Johns', 'America/Mexico_City',
  'America/Bogota', 'America/Lima', 'America/Santiago', 'America/Buenos_Aires',
  'America/Sao_Paulo', 'America/Caracas', 'America/Havana', 'America/Jamaica',
  'America/Panama', 'America/Denver', 'America/Phoenix', 'America/Detroit',
  'America/Indiana/Indianapolis', 'America/Puerto_Rico', 'America/Guatemala',
  'America/Costa_Rica', 'America/El_Salvador', 'America/La_Paz', 'America/Asuncion',
  'America/Montevideo', 'America/Guyana', 'America/Paramaribo', 'Atlantic/Bermuda',
];

const DEDUPED_FALLBACK = [...new Set(FALLBACK_ZONES)];

/**
 * Etc/GMT virtual zones are NOT returned by Intl.supportedValuesOf in most
 * runtimes. They are generated explicitly. POSIX sign inversion applies:
 * Etc/GMT+4 displays UTC−04:00, while Etc/GMT−4 displays UTC+04:00.
 * These are honestly-derived virtual zones — used for display and offset only.
 */
function buildEtcZones(): string[] {
  const out = new Set<string>(['Etc/UTC', 'Etc/GMT', 'Etc/Universal', 'Etc/Zulu']);
  for (let i = 1; i <= 12; i += 1) out.add(`Etc/GMT+${i}`); // displays UTC−i
  for (let i = 1; i <= 14; i += 1) out.add(`Etc/GMT-${i}`); // displays UTC+i
  return [...out];
}
const ETC_ZONES = buildEtcZones();

/** Alias search: common abbreviations/city spellings → canonical zones. */
const ALIASES: Record<string, string> = {
  ist: 'Asia/Kolkata',
  kolkata: 'Asia/Kolkata',
  calcutta: 'Asia/Kolkata',
  npt: 'Asia/Kathmandu',
  nepal: 'Asia/Kathmandu',
  pst: 'America/Los_Angeles',
  mst: 'America/Denver',
  cst: 'America/Chicago',
  est: 'America/New_York',
  edt: 'America/New_York',
  gmt: 'UTC',
  utc: 'UTC',
  bst: 'Europe/London',
  cet: 'Europe/Paris',
  aest: 'Australia/Sydney',
  jst: 'Asia/Tokyo',
  kst: 'Asia/Seoul',
  cstcn: 'Asia/Shanghai',
  nzst: 'Pacific/Auckland',
  sydney: 'Australia/Sydney',
  sydneytime: 'Australia/Sydney',
  london: 'Europe/London',
  paris: 'Europe/Paris',
  moscow: 'Europe/Moscow',
  istanbul: 'Europe/Istanbul',
  singapore: 'Asia/Singapore',
  hongkong: 'Asia/Hong_Kong',
  kyiv: 'Europe/Kyiv',
  kiev: 'Europe/Kyiv',
  local: 'local',
  auckland: 'Pacific/Auckland',
  apia: 'Pacific/Apia',
  casablanca: 'Africa/Casablanca',
  lordhowe: 'Australia/Lord_Howe',
};

/**
 * Canonical modern names mapped to legacy equivalents some ICU builds still
 * list (e.g. Asia/Calcutta, Europe/Kiev). Used to resolve a stored canonical
 * preference to something the runtime actually supports — offsets are still
 * computed live, never hardcoded.
 */
const LEGACY_LINKS: Record<string, string[]> = {
  'Asia/Kolkata': ['Asia/Calcutta'],
  'Europe/Kyiv': ['Europe/Kiev'],
  'Asia/Yangon': ['Asia/Rangoon'],
};

/** The device's actual IANA zone (never the `local` sentinel). */
export function deviceTimeZone(): string {
  try {
    const z = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (z && isValidTimezone(z)) return z;
  } catch {
    /* fall through */
  }
  return 'UTC';
}

export function isValidTimezone(tz: string): boolean {
  if (typeof tz !== 'string' || !tz || tz.length > 100) return false;
  if (tz === 'local') return true;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolve a canonical zone to one this runtime supports (canonical first).
 * `local` resolves to the device's IANA zone so every Intl call and stored
 * label uses one consistent zone instead of silently falling back to UTC.
 */
export function supportedZone(tz: string): string {
  if (tz === 'local') return deviceTimeZone();
  if (tz === 'UTC') return tz;
  if (isValidTimezone(tz)) return tz;
  for (const legacy of LEGACY_LINKS[tz] ?? []) {
    if (isValidTimezone(legacy)) return legacy;
  }
  return tz;
}

export function getAvailableZones(): string[] {
  const out = new Set<string>(['local', 'UTC']);
  try {
    const fn = (Intl as any).supportedValuesOf;
    if (typeof fn === 'function') {
      const list = fn.call(Intl, 'timeZone') as string[];
      if (Array.isArray(list)) for (const z of list) out.add(z);
    }
  } catch {
    /* fall through to curated list */
  }
  // Union with the curated catalogue so canonical modern names (Kolkata, Kyiv)
  // are always offered even when a runtime lists legacy equivalents.
  for (const z of [...DEDUPED_FALLBACK, ...ETC_ZONES]) out.add(z);
  return [...out];
}

export function cityOf(tz: string): string {
  if (tz === 'local') return 'Device';
  if (tz === 'UTC') return 'UTC';
  const last = tz.split('/').slice(-1)[0];
  return last.replace(/_/g, ' ');
}

export function regionOf(tz: string): string {
  if (tz === 'local' || tz === 'UTC') return 'System';
  return tz.split('/')[0];
}

/** Offset in minutes east of UTC for `date` in `tz`. Null when unsupported. */
export function utcOffsetMinutes(date: Date, timeZone: string): number | null {
  if (timeZone === 'local') return -date.getTimezoneOffset();
  const tz = supportedZone(timeZone);
  try {
    const dtf = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    const parts = dtf.formatToParts(date);
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
    const asUTC = Date.UTC(
      Number(get('year')),
      Number(get('month')) - 1,
      Number(get('day')),
      Number(get('hour')) % 24,
      Number(get('minute')),
      Number(get('second')),
    );
    return Math.round((asUTC - date.getTime()) / 60000);
  } catch {
    return null;
  }
}

export function formatOffset(min: number | null): string {
  if (min === null || !Number.isFinite(min)) return '';
  if (min === 0) return 'UTC±00:00';
  const sign = min > 0 ? '+' : '−';
  const a = Math.abs(min);
  const h = String(Math.floor(a / 60)).padStart(2, '0');
  const m = String(a % 60).padStart(2, '0');
  return `UTC${sign}${h}:${m}`;
}

/** Score-based search across city, region, identifier, UTC offset, and aliases. */
export function searchZones(query: string, zones: string[], limit = 60): string[] {
  const q = query.trim().toLowerCase();
  if (!q) {
    // sensible defaults first: local, UTC, then major hubs
    const hubs = ['local', 'UTC', 'Asia/Kolkata', 'America/New_York', 'Europe/London', 'Asia/Tokyo', 'Australia/Sydney'];
    const rest = zones.filter((z) => !hubs.includes(z));
    return [...hubs.filter((z) => zones.includes(z)), ...rest].slice(0, limit);
  }
  const aliasHit = ALIASES[q];
  const aliasHitComma = ALIASES[q.replace(/\s+/g, ' ')];
  const offsetQuery = parseOffsetQuery(q);
  const now = new Date();
  const scored: { z: string; score: number }[] = [];
  for (const z of zones) {
    if (z === aliasHit || z === aliasHitComma) {
      scored.push({ z, score: 0 });
      continue;
    }
    // UTC offset match (e.g. "+5:30", "+0530", "-0500", "+05:30")
    if (offsetQuery !== null) {
      const minutes = utcOffsetMinutes(now, z);
      if (minutes !== null && minutes === offsetQuery) {
        scored.push({ z, score: 0 });
        continue;
      }
    }
    const city = cityOf(z).toLowerCase();
    const region = regionOf(z).toLowerCase();
    const id = z.toLowerCase();
    let score = -1;
    if (id === q || city === q) score = 1;
    else if (city.startsWith(q)) score = 2;
    else if (id.startsWith(q)) score = 3;
    else if (city.includes(q)) score = 4;
    else if (region.includes(q) || region.startsWith(q)) score = 5;
    else if (id.includes(q)) score = 6;
    if (score >= 0) scored.push({ z, score });
  }
  return scored
    .sort((a, b) => a.score - b.score || a.z.localeCompare(b.z))
    .slice(0, limit)
    .map((s) => s.z);
}

const OFFSET_TOKEN_RE = /^([+-])(\d{2}):?(\d{2})$/;

/** Parse "+05:30", "+0530", "-0500" into minutes east of UTC. Null when not an offset query. */
function parseOffsetQuery(q: string): number | null {
  const match = q.match(OFFSET_TOKEN_RE);
  if (!match) return null;
  const hours = Number(match[2]);
  const minutes = Number(match[3]);
  const total = hours * 60 + minutes;
  if (total > 14 * 60) return null;
  return match[1] === '-' ? -total : total;
}
