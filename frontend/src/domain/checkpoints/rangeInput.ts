// Checkpoint range input: one required, human-friendly video range.
// Inclusive ranges are unchanged: 1-8 means videos 1 through 8.

export interface ParsedCheckpointRange {
  start: number;
  end: number;
  /** Automatically derived milestone name, e.g. "Videos 1–8". */
  label: string;
  isSingle: boolean;
}

export type RangeParseResult =
  | { ok: true; range: ParsedCheckpointRange }
  | { ok: false; error: string };

export function autoCheckpointLabel(start: number, end: number): string {
  return start === end ? `Video ${start}` : `Videos ${start}–${end}`;
}

/**
 * Parse a single contiguous range (`1-8`, `1 – 8`, `1–8`) or one position
 * (`103`). Invalid input is reported, never silently clamped.
 */
export function parseCheckpointRange(input: string, playlistLength: number): RangeParseResult {
  const raw = String(input ?? '').trim();
  if (!raw) return { ok: false, error: 'Enter a video range, for example 1-8, or one position such as 103.' };
  if (!Number.isSafeInteger(playlistLength) || playlistLength < 1) {
    return { ok: false, error: 'This playlist has no available videos to checkpoint yet. Refresh it or add a playlist first.' };
  }
  if (raw.length > 64) return { ok: false, error: 'That range is too long. Enter a single range such as 1-8.' };

  const single = /^(\d+)$/.exec(raw);
  const pair = /^(\d+)\s*[-–—]\s*(\d+)$/.exec(raw);
  if (!single && !pair) {
    if (/[.,]/.test(raw)) return { ok: false, error: 'Use whole video positions only. Fractions and comma lists are not supported.' };
    if (/^-\d/.test(raw)) return { ok: false, error: 'Positions start at 1; negative numbers are not valid.' };
    if (/^\d+\s*[-–—]\s*$/.test(raw) || /^\s*[-–—]\s*\d+$/.test(raw)) {
      return { ok: false, error: 'Enter both ends of the range, for example 1-8.' };
    }
    if ((raw.match(/[-–—]/g) ?? []).length > 1) return { ok: false, error: 'Enter one contiguous range only, for example 1-8.' };
    return { ok: false, error: 'Enter a range such as 1-8 or one position such as 103.' };
  }

  const start = Number(single ? single[1] : pair![1]);
  const end = Number(single ? single[1] : pair![2]);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 1 || end < 1) {
    return { ok: false, error: 'Positions must be whole numbers starting at 1.' };
  }
  if (start > end) return { ok: false, error: `The range is reversed: start ${start} is after end ${end}.` };
  if (start > playlistLength || end > playlistLength) {
    return { ok: false, error: `That range is outside this playlist (1–${playlistLength}). Nothing was clamped.` };
  }
  return {
    ok: true,
    range: {
      start,
      end,
      label: autoCheckpointLabel(start, end),
      isSingle: start === end,
    },
  };
}

/** A custom name is optional; blank means use the generated label. */
export function checkpointName(range: ParsedCheckpointRange, customName?: string): string {
  const custom = (customName ?? '').trim();
  return custom || range.label;
}

/**
 * Editing an existing checkpoint preserves a custom name. An auto-generated
 * label follows the new range; a user-authored label is never overwritten.
 */
export function labelForEditedRange(existingLabel: string, oldStart: number, oldEnd: number, newStart: number, newEnd: number): string {
  return existingLabel === autoCheckpointLabel(oldStart, oldEnd)
    ? autoCheckpointLabel(newStart, newEnd)
    : existingLabel;
}
