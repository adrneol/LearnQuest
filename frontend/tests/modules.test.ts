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

describe('efficiency-only ranking ignores volume', () => {
  it('highest average daily efficiency ranks first; thin data stays provisional', () => {
    const basis = { totalSec: 36000, n: 100, avgVideoSec: 360 };
    const comps = generateCompetitors({ ...DEFAULT_CHALLENGE, cohortSize: 20 }, basis);
    const top = rankBoard(
      { ...DEFAULT_CHALLENGE, cohortSize: 20 },
      comps,
      { dailyEffs: [115, 115, 115], uniqueContentSec: 1, verifiedCount: 0, focusSec: 1, activeDays: 0 },
    );
    expect(top.rows[0].isUser).toBe(true);
    expect(top.userRank).toBe(1);
    const thin = rankBoard(
      { ...DEFAULT_CHALLENGE },
      comps,
      { dailyEffs: [], uniqueContentSec: 0, verifiedCount: 0, focusSec: 0, activeDays: 0 },
    );
    expect(thin.rows.find((r) => r.isUser)?.provisional).toBe(true);
    expect(thin.userRank).toBeNull();
  });
});
