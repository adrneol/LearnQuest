import { describe, it, expect } from 'vitest';
import {
  autoCheckpointLabel, checkpointName, labelForEditedRange, parseCheckpointRange,
} from '../src/domain/checkpoints/rangeInput.js';

describe('checkpoint range parsing and naming', () => {
  it('accepts hyphen and en-dash ranges with reasonable spacing', () => {
    for (const input of ['1-8', '1 - 8', '1–8', ' 01 – 08 ', '1—8']) {
      const r = parseCheckpointRange(input, 20);
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.range.start).toBe(1);
        expect(r.range.end).toBe(8);
        expect(r.range.label).toBe('Videos 1–8');
      }
    }
  });

  it('accepts one position and derives a singular label', () => {
    const r = parseCheckpointRange('103', 120);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.range).toMatchObject({ start: 103, end: 103, isSingle: true, label: 'Video 103' });
    }
  });

  it('rejects reversed, malformed, fractional, negative, multi-range, and empty input', () => {
    const cases = ['8-1', '1-', '-8', '1.5-2', '1,8', '1-2-3', 'abc', '', '1 8', '0', '-1'];
    for (const input of cases) {
      const r = parseCheckpointRange(input, 20);
      expect(r.ok, `expected ${JSON.stringify(input)} to be rejected`).toBe(false);
    }
  });

  it('rejects out-of-bounds ranges without clamping', () => {
    const r = parseCheckpointRange('1-21', 20);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/outside this playlist \(1–20\)/);
    const single = parseCheckpointRange('21', 20);
    expect(single.ok).toBe(false);
  });

  it('reports empty or unavailable playlist metadata clearly', () => {
    for (const n of [0, -1, Number.NaN]) {
      const r = parseCheckpointRange('1-2', n);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toMatch(/no available videos/i);
    }
  });

  it('uses a custom name only when supplied, and trims it', () => {
    const r = parseCheckpointRange('9-16', 20);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(checkpointName(r.range)).toBe('Videos 9–16');
    expect(checkpointName(r.range, '   ')).toBe('Videos 9–16');
    expect(checkpointName(r.range, '  JavaScript fundamentals  ')).toBe('JavaScript fundamentals');
    expect(autoCheckpointLabel(9, 16)).toBe('Videos 9–16');
  });

  it('preserves custom names on edit and updates generated labels', () => {
    expect(labelForEditedRange('Videos 1–8', 1, 8, 2, 5)).toBe('Videos 2–5');
    expect(labelForEditedRange('Video 1', 1, 1, 2, 2)).toBe('Video 2');
    expect(labelForEditedRange('JavaScript fundamentals', 1, 8, 2, 5)).toBe('JavaScript fundamentals');
  });
});
