// Central preference validation. Invalid numeric values must never reach
// calculations such as sessionsNeeded (which correctly rejects a zero-length
// session) or be persisted to IndexedDB.

import type { AppPreferences } from '../../types/index.js';
import { deviceTimeZone, isValidTimezone } from '../time/timezones.js';

export const SESSION_LEN_MIN = 1;
export const SESSION_LEN_MAX = 600;
export const BREAK_MIN_MIN = 0;
export const BREAK_MIN_MAX = 240;
export const MIN_VIABLE_MIN = 1;
export const MIN_VIABLE_MAX = 600;

export function defaultPreferences(): AppPreferences {
  return {
    timezone: deviceTimeZone(),
    sessionLenMin: 25,
    breakMin: 5,
    reducedMotion: false,
    minViableMin: 10,
  };
}

function numeric(
  value: unknown,
  name: string,
  min: number,
  max: number,
  integer = true,
): { value?: number; error?: string } {
  if (value === '' || value === null || value === undefined) return { error: `${name} is required.` };
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return { error: `${name} must be a finite number.` };
  if (integer && !Number.isInteger(n)) return { error: `${name} must be a whole number.` };
  if (n < min || n > max) return { error: `${name} must be ${min}–${max}.` };
  return { value: n };
}

/** Validate a patch against the current preferences; returns errors, never a partial invalid object. */
export function validatePreferencePatch(
  current: AppPreferences,
  patch: Partial<AppPreferences>,
): { value: AppPreferences; errors: string[] } {
  const errors: string[] = [];
  const next: AppPreferences = { ...current };
  if (patch.timezone !== undefined) {
    if (typeof patch.timezone !== 'string' || !isValidTimezone(patch.timezone)) {
      errors.push('Choose a valid IANA timezone (for example Europe/Berlin).');
    } else {
      next.timezone = patch.timezone;
    }
  }
  if (patch.sessionLenMin !== undefined) {
    const r = numeric(patch.sessionLenMin, 'Default session length', SESSION_LEN_MIN, SESSION_LEN_MAX);
    if (r.error) errors.push(r.error);
    else next.sessionLenMin = r.value!;
  }
  if (patch.breakMin !== undefined) {
    const r = numeric(patch.breakMin, 'Break length', BREAK_MIN_MIN, BREAK_MIN_MAX);
    if (r.error) errors.push(r.error);
    else next.breakMin = r.value!;
  }
  if (patch.minViableMin !== undefined) {
    const r = numeric(patch.minViableMin, 'Minimum viable session', MIN_VIABLE_MIN, MIN_VIABLE_MAX);
    if (r.error) errors.push(r.error);
    else next.minViableMin = r.value!;
  }
  if (patch.reducedMotion !== undefined) {
    if (typeof patch.reducedMotion !== 'boolean') errors.push('Reduce motion must be on or off.');
    else next.reducedMotion = patch.reducedMotion;
  }
  return { value: next, errors };
}

/** Repair persisted/legacy preferences without silently keeping invalid values. */
export function sanitizePreferences(raw: unknown, fallback = defaultPreferences()): AppPreferences {
  if (typeof raw !== 'object' || raw === null) return fallback;
  const r = raw as Record<string, unknown>;
  const value: AppPreferences = {
    timezone: typeof r.timezone === 'string' && isValidTimezone(r.timezone) ? r.timezone : fallback.timezone,
    sessionLenMin: finiteInt(r.sessionLenMin, fallback.sessionLenMin, SESSION_LEN_MIN, SESSION_LEN_MAX),
    breakMin: finiteInt(r.breakMin, fallback.breakMin, BREAK_MIN_MIN, BREAK_MIN_MAX),
    reducedMotion: typeof r.reducedMotion === 'boolean' ? r.reducedMotion : fallback.reducedMotion,
    minViableMin: finiteInt(r.minViableMin, fallback.minViableMin, MIN_VIABLE_MIN, MIN_VIABLE_MAX),
  };
  return value;
}

function finiteInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < min || n > max) return fallback;
  return n;
}

/** Validate settings (currently the verified-completion threshold). */
export function sanitizeSettings(raw: unknown): { verifiedThreshold: number } {
  const fallback = 0.9;
  if (typeof raw !== 'object' || raw === null) return { verifiedThreshold: fallback };
  const n = Number((raw as Record<string, unknown>).verifiedThreshold);
  if (!Number.isFinite(n)) return { verifiedThreshold: fallback };
  return { verifiedThreshold: Math.min(1, Math.max(0.5, n)) };
}
