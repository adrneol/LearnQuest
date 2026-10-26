import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { openDB } from 'idb';
import { StoreProvider, useStore } from '../src/app/store.js';
import { Efficiency } from '../src/features/efficiency/Efficiency.js';

const P = 'PLeffscreen000000000';
const Q = 'PLeffscreenq00000000';
const SNAP_Q: any = {
  playlistId: Q,
  title: 'Second Course',
  reportedCount: 1,
  entries: [{ position: 1, entryId: 'q1', videoId: 'qv1', title: 'Second lesson', durationSec: 600 }],
  source: 'api',
  fetchedAt: '2026-10-01T00:00:00.000Z',
  snapshotVersion: 2,
};
const SNAP: any = {
  playlistId: P,
  title: 'Efficiency Course',
  reportedCount: 1,
  entries: [{ position: 1, entryId: 'e1', videoId: 'v1', title: 'Lesson', durationSec: 900 }],
  source: 'api',
  fetchedAt: '2026-10-01T00:00:00.000Z',
  snapshotVersion: 2,
};
const NOON = Date.parse('2026-10-27T12:00:00.000Z');
const observed = {
  id: 'obs', playlistId: P, startedAt: new Date(NOON).toISOString(),
  finishedAt: new Date(NOON + 600_000).toISOString(), activeSec: 600, elapsedSec: 600,
  pausedSec: 0, dateKey: '2026-10-27',
  intervals: [{ startMs: NOON, endMs: NOON + 600_000, kind: 'active' }],
};
const estimated = {
  id: 'est', playlistId: P, startedAt: new Date(NOON + 700_000).toISOString(),
  finishedAt: new Date(NOON + 1_300_000).toISOString(), activeSec: 600, elapsedSec: 600,
  pausedSec: 0, dateKey: '2026-10-27', estimated: true, intervals: [],
};
const verifiedSegment = {
  id: 'sv', playlistId: P, position: 1, entryId: 'e1', videoId: 'v1', sessionId: 'obs',
  wallStartMs: NOON, wallEndMs: NOON + 600_000, timelineStartSec: 0, timelineEndSec: 600,
  playbackRate: 1, source: 'verified',
};
const manualSegment = {
  id: 'sm', playlistId: P, position: 1, entryId: 'e1', videoId: 'v1', sessionId: 'est',
  wallStartMs: NOON + 700_000, wallEndMs: NOON + 1_000_000, timelineStartSec: 600, timelineEndSec: 900,
  playbackRate: 1, source: 'manual',
};

async function seed(withFocus: boolean) {
  const db = await openDB('learnquest-db', 2, {
    upgrade(d) { if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv'); },
  });
  await db.clear('kv');
  await db.put('kv', { [P]: SNAP, [Q]: SNAP_Q }, 'playlists');
  await db.put('kv', {
    [P]: { archived: false, addedAt: '2026-10-01T00:00:00.000Z' },
    [Q]: { archived: false, addedAt: '2026-10-01T00:00:00.000Z' },
  }, 'meta');
  await db.put('kv', P, 'activeId');
  await db.put('kv', { timezone: 'UTC' }, 'prefs');
  await db.put('kv', [verifiedSegment, manualSegment], 'segments');
  await db.put('kv', withFocus ? [observed, estimated] : [], 'sessions');
  await db.put('kv', [], 'playSessions');
}

function Harness() {
  const s = useStore();
  return (
    <div>
      <button
        onClick={() => s.addSession({
          clientId: 'new-observed-focus',
          playlistId: P,
          startedAt: new Date(NOON + 2_000_000).toISOString(),
          finishedAt: new Date(NOON + 2_060_000).toISOString(),
          activeSec: 60,
          elapsedSec: 60,
          pausedSec: 0,
          intervals: [],
        })}
      >
        add observed focus
      </button>
      <button
        onClick={() => s.addSession({
          clientId: 'new-estimated-focus',
          playlistId: P,
          startedAt: new Date(NOON + 3_000_000).toISOString(),
          finishedAt: new Date(NOON + 3_060_000).toISOString(),
          activeSec: 60,
          elapsedSec: 60,
          pausedSec: 0,
          estimated: true,
          intervals: [],
        })}
      >
        add estimated focus
      </button>
      <Efficiency />
    </div>
  );
}

function valueFor(label: string): string {
  const labels = screen.getAllByText(label);
  for (const labelEl of labels) {
    const prev = labelEl.previousElementSibling;
    if (prev?.classList.contains('font-mono')) return prev.textContent ?? '';
  }
  return '';
}

beforeEach(async () => {
  await seed(true);
});

async function evidence(option: RegExp) {
  fireEvent.click(screen.getByRole('button', { name: 'Evidence' }));
  fireEvent.click(await screen.findByRole('option', { name: option }));
}

describe('Efficiency screen evidence selector and explanations', () => {
  it('filters both the numerator and the focus denominator and updates after new sessions', async () => {
    render(<StoreProvider><Harness /></StoreProvider>);
    await screen.findByText(/Learning efficiency/);
    await waitFor(() => expect(valueFor('Unique content / focused study')).toBe('15m / 20m'));
    expect(valueFor('Content efficiency')).toBe('75.0%');
    expect(valueFor('Playback utilization')).toBe('75.0%');

    fireEvent.click(screen.getByRole('button', { name: 'add observed focus' }));
    await waitFor(() => expect(valueFor('Unique content / focused study')).toBe('15m / 21m'));
    expect(valueFor('Content efficiency')).toBe('71.4%');

    await evidence(/Verified only/);
    await waitFor(() => expect(valueFor('Unique content / focused study')).toBe('10m / 11m'));
    expect(valueFor('Content efficiency')).toBe('90.9%');
    expect(valueFor('Playback utilization')).toBe('90.9%');

    await evidence(/Self-reported only/);
    await waitFor(() => expect(valueFor('Unique content / focused study')).toBe('5m / 10m'));
    expect(valueFor('Content efficiency')).toBe('50.0%');
    expect(valueFor('Playback utilization')).toBe('50.0%');

    // Scope changes recompute every statistic and explain an empty selection.
    await evidence(/All evidence/);
    fireEvent.click(screen.getByRole('button', { name: 'Scope' }));
    fireEvent.click(await screen.findByRole('option', { name: /Second Course/ }));
    await waitFor(() => expect(valueFor('Unique content / focused study')).toBe('0m / 0m'));
    expect(valueFor('Content efficiency')).toBe('n/a');
    expect(screen.getByText(/No focused study and no unique content/)).toBeTruthy();
  });

  it('explains unique content without a Focus denominator instead of suggesting the content is invalid', async () => {
    await seed(false);
    render(<StoreProvider><Harness /></StoreProvider>);
    await screen.findByText(/Learning efficiency/);
    await waitFor(() => expect(valueFor('Unique content / focused study')).toBe('15m / 0m'));
    expect(valueFor('Content efficiency')).toBe('n/a');
    expect(valueFor('Playback utilization')).toBe('n/a');
    expect(screen.getByText(/no matching focused study/i)).toBeTruthy();
    expect(screen.getByText(/content measurement itself is\s+still valid/i)).toBeTruthy();
    expect(screen.queryByText(/play a lesson to unlock efficiency/i)).toBeNull();
  });
});
