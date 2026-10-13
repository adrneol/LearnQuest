import { describe, it, expect } from 'vitest';
import {
  dateKeyInTimezone,
  splitIntervalByDay,
  isValidTimezone,
} from '../src/domain/time/time.js';
import {
  utcOffsetMinutes,
  formatOffset,
  searchZones,
  getAvailableZones,
  cityOf,
  isValidTimezone,
} from '../src/domain/time/timezones.js';

// Deterministic UTC fixtures (all timestamps absolute instants)
const T = (s: string) => new Date(s).getTime();

describe('timezone offsets (computed, DST-aware)', () => {
  it('UTC is always +0', () => {
    expect(utcOffsetMinutes(new Date('2026-03-08T06:30:00Z'), 'UTC')).toBe(0);
    expect(utcOffsetMinutes(new Date('2026-11-01T06:30:00Z'), 'UTC')).toBe(0);
  });
  it('Asia/Kolkata is +5:30 with no DST', () => {
    expect(utcOffsetMinutes(new Date('2026-03-08T06:30:00Z'), 'Asia/Kolkata')).toBe(330);
    expect(utcOffsetMinutes(new Date('2026-11-01T06:30:00Z'), 'Asia/Kolkata')).toBe(330);
  });
  it('Asia/Tokyo is +9:00 year-round', () => {
    expect(utcOffsetMinutes(new Date('2026-01-15T00:00:00Z'), 'Asia/Tokyo')).toBe(540);
    expect(utcOffsetMinutes(new Date('2026-07-15T00:00:00Z'), 'Asia/Tokyo')).toBe(540);
  });
  it('America/New_York across the March 2026 spring-forward (Mar 8, 07:00 UTC)', () => {
    // 06:30Z -> 01:30 EST (-5); 07:30Z -> 03:30 EDT (-4)
    expect(utcOffsetMinutes(new Date('2026-03-08T06:30:00Z'), 'America/New_York')).toBe(-300);
    expect(utcOffsetMinutes(new Date('2026-03-08T07:30:00Z'), 'America/New_York')).toBe(-240);
    expect(dateKeyInTimezone(new Date('2026-03-08T06:30:00Z'), 'America/New_York')).toBe('2026-03-08');
  });
  it('America/New_York across the Nov 2026 fall-back (Nov 1, 06:00 UTC)', () => {
    expect(utcOffsetMinutes(new Date('2026-11-01T05:30:00Z'), 'America/New_York')).toBe(-240);
    expect(utcOffsetMinutes(new Date('2026-11-01T06:30:00Z'), 'America/New_York')).toBe(-300);
  });
  it('Europe/London across BST transitions 2026', () => {
    // clocks forward Mar 29 01:00 UTC; back Oct 25 01:00 UTC
    expect(utcOffsetMinutes(new Date('2026-03-29T00:30:00Z'), 'Europe/London')).toBe(0);
    expect(utcOffsetMinutes(new Date('2026-03-29T01:30:00Z'), 'Europe/London')).toBe(60);
    expect(utcOffsetMinutes(new Date('2026-10-25T00:30:00Z'), 'Europe/London')).toBe(60);
    expect(utcOffsetMinutes(new Date('2026-10-25T01:30:00Z'), 'Europe/London')).toBe(0);
  });
  it('unsupported zone returns null instead of a misleading number', () => {
    expect(utcOffsetMinutes(new Date(), 'Mars/Olympus')).toBeNull();
    expect(isValidTimezone('Mars/Olympus')).toBe(false);
    expect(isValidTimezone('Asia/Kolkata')).toBe(true);
  });
});

describe('daily attribution vs raw UTC', () => {
  it('same instant lands on different dates per tz (no UTC slicing)', () => {
    const d = new Date('2026-03-08T20:00:00Z');
    expect(dateKeyInTimezone(d, 'UTC')).toBe('2026-03-08');
    expect(dateKeyInTimezone(d, 'Asia/Kolkata')).toBe('2026-03-09'); // 01:30 IST
    expect(dateKeyInTimezone(d, 'America/New_York')).toBe('2026-03-08'); // 15:00 EST
  });
  it('cross-midnight session splits at local boundaries (Kolkata)', () => {
    const slices = splitIntervalByDay(T('2026-10-12T18:00:00Z'), T('2026-10-12T19:00:00Z'), 'Asia/Kolkata');
    expect(slices).toHaveLength(2);
    expect(slices[0]).toEqual({ dateKey: '2026-10-12', seconds: 1800 });
    expect(slices[1]).toEqual({ dateKey: '2026-10-13', seconds: 1800 });
  });
  it('cross-month boundary splits correctly (UTC)', () => {
    const slices = splitIntervalByDay(T('2026-01-31T23:30:00Z'), T('2026-02-01T00:30:00Z'), 'UTC');
    expect(slices).toHaveLength(2);
    expect(slices[0].dateKey).toBe('2026-01-31');
    expect(slices[1].dateKey).toBe('2026-02-01');
    expect(slices[0].seconds + slices[1].seconds).toBe(3600);
  });
  it('switching display tz keeps UTC total identical, only attribution moves', () => {
    const a = T('2026-10-12T18:00:00Z');
    const b = T('2026-10-12T19:00:00Z');
    for (const tz of ['UTC', 'Asia/Kolkata', 'America/New_York', 'Australia/Sydney']) {
      const slices = splitIntervalByDay(a, b, tz);
      expect(slices.reduce((x, s) => x + s.seconds, 0)).toBe(3600);
    }
    // and in New York this interval is fully one local day, in Kolkata it spans two
    expect(splitIntervalByDay(a, b, 'America/New_York')).toHaveLength(1);
    expect(splitIntervalByDay(a, b, 'Asia/Kolkata')).toHaveLength(2);
  });
});

describe('picker catalogue', () => {
  it('covers the world, not a handful of cities', () => {
    const zones = getAvailableZones();
    expect(zones.length).toBeGreaterThan(100);
    for (const z of ['UTC', 'Asia/Kolkata', 'America/New_York', 'Europe/London', 'Asia/Tokyo', 'Australia/Sydney']) {
      expect(zones).toContain(z);
    }
  });
  it('search by city, alias, and region', () => {
    const zones = getAvailableZones();
    expect(searchZones('kolkata', zones)[0]).toBe('Asia/Kolkata');
    expect(searchZones('ist', zones)).toContain('Asia/Kolkata');
    expect(searchZones('new york', zones)[0]).toBe('America/New_York');
    expect(searchZones('', zones).slice(0, 2)).toEqual(['local', 'UTC']);
    expect(cityOf('America/Argentina/Buenos_Aires')).toBe('Buenos Aires');
  });
  it('offset formatting', () => {
    expect(formatOffset(330)).toBe('UTC+05:30');
    expect(formatOffset(-300)).toBe('UTC−05:00');
    expect(formatOffset(0)).toBe('UTC±00:00');
    expect(formatOffset(765)).toBe('UTC+12:45');
    expect(formatOffset(null)).toBe('');
  });
});
