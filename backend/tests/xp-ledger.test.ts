import { describe, expect, it } from 'vitest';
import { validateCollectionPayload } from '../src/services/userData.js';

function xp(id: string, dedupKey: string, points = 10) {
  return {
    id,
    reason: 'videoDone',
    points,
    dedupKey,
    at: '2026-10-27T10:00:00.000Z',
  };
}

describe('server-side XP ledger boundary', () => {
  it('accepts distinct stable dedup keys', () => {
    const payload = [xp('x1', 'done:PL1:e1'), xp('x2', 'done:PL1:e2')];
    expect(validateCollectionPayload('xp', payload)).toBe(payload);
  });

  it('rejects a repeated award key even when the event id differs', () => {
    const payload = [xp('x1', 'focus:f1'), xp('retry-with-new-id', 'focus:f1')];
    expect(() => validateCollectionPayload('xp', payload)).toThrowError(/duplicate dedupKey/i);
    try {
      validateCollectionPayload('xp', payload);
    } catch (error: any) {
      expect(error.status).toBe(400);
      expect(error.code).toBe('XP_DUPLICATE_DEDUP_KEY');
    }
  });

  it('still rejects duplicate event ids', () => {
    expect(() => validateCollectionPayload('xp', [xp('same', 'a'), xp('same', 'b')]))
      .toThrowError(/duplicate id/i);
  });
});
