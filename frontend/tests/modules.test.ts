import { describe, it, expect } from 'vitest';
import { parsePositions, serializePositions } from '../src/features/modules/Modules';
import { rankBoard, DEFAULT_CHALLENGE, generateCompetitors } from '../src/domain/competition/competition';

describe('module position parsing', () => {
  it('parses ranges, singles, dedupes, sorts', () => {
    expect(parsePositions('1-8, 10, 12-15', 20)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 10, 12, 13, 14, 15]);
    expect(parsePositions('5, 5, 3-4', 20)).toEqual([3, 4, 5]);
  });
  it('rejects out-of-range and garbage with clear errors', () => {
    expect(() => parsePositions('0-3', 20)).toThrow();
    expect(() => parsePositions('1-99', 20)).toThrow();
    expect(() => parsePositions('abc', 20)).toThrow();
    expect(() => parsePositions('21', 20)).toThrow();
  });
  it('round-trips through serialization', () => {
    expect(serializePositions([1, 2, 3, 8, 10, 11, 12])).toBe('1-3, 8, 10-12');
    expect(serializePositions([])).toBe('');
  });
});

describe('Arena v2 ranks sustainable completion, never thin volume', () => {
  it('full progress and consistency ranks first; thin data stays provisional', () => {
    const basis = { totalSec: 36000, n: 100, avgVideoSec: 360 };
    const full = { uniqueContentSec: 36000, playlistDurationSec: 36000, qualifyingDays: 14, observedDays: 14 };
    const top = rankBoard(
      { ...DEFAULT_CHALLENGE, cohortSize: 20 },
      generateCompetitors({ ...DEFAULT_CHALLENGE, cohortSize: 20 }, basis),
      full,
    );
    expect(top.userRank).toBe(1);
    expect(top.userScore).toBe(100);
    const solo = rankBoard({ ...DEFAULT_CHALLENGE, cohortSize: 20 }, [], full);
    expect(solo.rows[0].isUser).toBe(true);
    const thin = rankBoard(
      { ...DEFAULT_CHALLENGE },
      [],
      { uniqueContentSec: 0, playlistDurationSec: 36000, qualifyingDays: 0, observedDays: 14 },
    );
    expect(thin.rows.find((r) => r.isUser)?.provisional).toBe(true);
    expect(thin.userRank).toBeNull();
  });
});
