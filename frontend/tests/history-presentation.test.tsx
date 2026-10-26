import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { openDB } from 'idb';
import { StoreProvider } from '../src/app/store.js';
import { HistoryView } from '../src/features/history/History.js';
import { addDaysToDateKey, dateKeyInTimezone, formatDuration } from '../src/domain/index.js';

const P = 'PLhistorypresent0000';
const SNAP: any = {
  playlistId: P,
  title: 'History Course',
  reportedCount: 2,
  entries: [
    { position: 1, entryId: 'h1', videoId: 'hv1', title: 'History One', durationSec: 600 },
    { position: 2, entryId: 'h2', videoId: 'hv2', title: 'History Two', durationSec: 600 },
  ],
  source: 'api',
  fetchedAt: '2026-10-01T00:00:00.000Z',
  snapshotVersion: 2,
};

const now = new Date();
const todayKey = dateKeyInTimezone(now, 'UTC');
const noon = Date.parse(`${todayKey}T12:00:00.000Z`);

async function seed(data: { sessions?: any[]; playSessions?: any[]; segments?: any[]; progress?: any }) {
  const db = await openDB('learnquest-db', 2, {
    upgrade(d) { if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv'); },
  });
  await db.clear('kv');
  await db.put('kv', { [P]: SNAP }, 'playlists');
  await db.put('kv', { [P]: { archived: false, addedAt: '2026-10-01T00:00:00.000Z' } }, 'meta');
  await db.put('kv', P, 'activeId');
  await db.put('kv', { timezone: 'UTC' }, 'prefs');
  await db.put('kv', data.progress ?? {}, 'progress');
  await db.put('kv', data.sessions ?? [], 'sessions');
  await db.put('kv', data.playSessions ?? [], 'playSessions');
  await db.put('kv', data.segments ?? [], 'segments');
}

function valueFor(label: string): string {
  const labelEl = screen.getByText(label);
  return labelEl.previousElementSibling?.textContent ?? '';
}

const focusObserved = {
  id: 'focus-observed', playlistId: P, startedAt: new Date(noon).toISOString(),
  finishedAt: new Date(noon + 10 * 60_000).toISOString(), activeSec: 600, elapsedSec: 600,
  pausedSec: 0, dateKey: todayKey,
  intervals: [{ startMs: noon, endMs: noon + 10 * 60_000, kind: 'active' }],
};
const focusEstimated = {
  id: 'focus-estimated', playlistId: P, startedAt: new Date(noon + 11 * 60_000).toISOString(),
  finishedAt: new Date(noon + 16 * 60_000).toISOString(), activeSec: 300, elapsedSec: 300,
  pausedSec: 0, dateKey: todayKey, estimated: true, intervals: [],
};
const verifiedPlay = {
  id: 'play-verified', playlistId: P, position: 1, entryId: 'h1', videoId: 'hv1',
  startedAt: new Date(noon).toISOString(), finishedAt: new Date(noon + 4 * 60_000).toISOString(),
  activePlaybackSec: 240, contentSec: 240, uniqueGainSec: 240, pauseSec: 0, source: 'verified',
};
const manualPlay = {
  id: 'play-manual', playlistId: P, position: 2, entryId: 'h2', videoId: 'hv2',
  startedAt: new Date(noon + 20 * 60_000).toISOString(), finishedAt: new Date(noon + 22 * 60_000).toISOString(),
  activePlaybackSec: 120, contentSec: 120, uniqueGainSec: 0, pauseSec: 0, source: 'manual',
};
const verifiedSegment = {
  id: 'seg-verified', playlistId: P, position: 1, entryId: 'h1', videoId: 'hv1', sessionId: 'play-verified',
  wallStartMs: noon, wallEndMs: noon + 4 * 60_000, timelineStartSec: 0, timelineEndSec: 240,
  playbackRate: 1, source: 'verified',
};
const manualSegment = {
  id: 'seg-manual', playlistId: P, position: 2, entryId: 'h2', videoId: 'hv2', sessionId: 'play-manual',
  wallStartMs: noon + 20 * 60_000, wallEndMs: noon + 22 * 60_000, timelineStartSec: 0, timelineEndSec: 120,
  playbackRate: 1, source: 'manual',
};

beforeEach(async () => {
  await seed({});
});

describe('History presentation and range scoping', () => {
  it('formats durations consistently without bare 0s', () => {
    expect(formatDuration(0)).toBe('0m');
    expect(formatDuration(45)).toBe('45s');
    expect(formatDuration(90)).toBe('1m 30s');
    expect(formatDuration(3600)).toBe('1h');
    expect(formatDuration(3660)).toBe('1h 1m');
  });

  it('keeps verified, self-reported, observed, and estimated evidence separate', async () => {
    await seed({
      sessions: [focusObserved, focusEstimated],
      playSessions: [verifiedPlay, manualPlay],
      segments: [verifiedSegment, manualSegment],
      progress: {
        [`${P}::h1`]: {
          playlistId: P, position: 1, entryId: 'h1', videoId: 'hv1',
          status: 'done', completedAt: new Date(noon).toISOString(), source: 'verified',
        },
        [`${P}::h2`]: {
          playlistId: P, position: 2, entryId: 'h2', videoId: 'hv2',
          status: 'done', completedAt: new Date(noon + 60_000).toISOString(), source: 'manual',
        },
      },
    });
    render(<StoreProvider><HistoryView /></StoreProvider>);
    await screen.findByText(/Study history/);
    await waitFor(() => expect(valueFor('Focused (timer-observed)')).toBe('10m'));

    expect(valueFor('Focused (timer-observed)')).toBe('10m');
    expect(valueFor('Verified playback active')).toBe('4m');
    expect(valueFor('Self-reported playback active')).toBe('2m');
    expect(valueFor('Unique content · verified / self-reported')).toBe('4m / 2m');
    expect(valueFor('Videos with playback · verified / self-reported')).toBe('1 / 1');
    expect(valueFor('Completed videos · verified / manual')).toBe('1 / 1');
    expect(screen.getByText(/\+ 5m estimated correction/)).toBeTruthy();
    // Session detail is human-readable, not raw JSON.
    fireEvent.click(screen.getByRole('button', { name: /Focus · 10m in range/ }));
    expect(await screen.findByText('observed timer')).toBeTruthy();
    expect(screen.queryByText(/"activeSec": 600/)).toBeNull();
  });

  it('shows a useful true-empty state for the selected range', async () => {
    render(<StoreProvider><HistoryView /></StoreProvider>);
    await screen.findByText(/Study history/);
    expect(screen.getByText(/No focus, playback, or coverage records were found in week/)).toBeTruthy();
    expect(screen.getByText(/No sessions have been recorded in week/)).toBeTruthy();
  });

  it('persists a self-reported entry and updates stats, sessions, and per-video detail after reload', async () => {
    const first = render(<StoreProvider><HistoryView /></StoreProvider>);
    await screen.findByText(/Study history/);
    // Wait for async store hydration to give the form its default playlist,
    // then pin the UTC date explicitly. The form's initial date may still use
    // the pre-hydration device timezone when this screen is mounted directly.
    await screen.findByText('History Course');
    fireEvent.change(screen.getByLabelText('Date'), { target: { value: todayKey } });
    fireEvent.click(screen.getByRole('button', { name: /Save self-reported/ }));

    await waitFor(() => expect(valueFor('Self-reported playback active')).toBe('20m'));
    expect(valueFor('Unique content · verified / self-reported')).toBe('0m / 10m');
    expect(valueFor('Videos with playback · verified / self-reported')).toBe('0 / 1');
    expect(screen.getByText(/Self-reported playback · #1/)).toBeTruthy();

    // The form goes through the same debounced store persistence as the rest
    // of the app; wait for the real write before remounting.
    const db = await openDB('learnquest-db', 2);
    await waitFor(async () => {
      const sessions = (await db.get('kv', 'playSessions')) as any[] | undefined;
      const segments = (await db.get('kv', 'segments')) as any[] | undefined;
      expect(sessions?.some((x) => x.source === 'manual' && x.position === 1)).toBe(true);
      expect(segments?.some((x) => x.source === 'manual' && x.entryId === 'h1')).toBe(true);
    });

    first.unmount();
    expect(first.container).toBeEmptyDOMElement();
    // Let any in-flight debounced write finish before a fresh provider reads.
    await new Promise((resolve) => setTimeout(resolve, 400));
    render(<StoreProvider><HistoryView /></StoreProvider>);
    await screen.findByText(/Study history/);
    expect(await screen.findByText(/Self-reported playback · #1/)).toBeTruthy();
    await waitFor(() => expect(valueFor('Self-reported playback active')).toBe('20m'));

    // Per-video drill-down uses the reloaded segment, not just in-memory state.
    // The top filter and the manual-entry form both expose a "Playlist"
    // control; the first one scopes the History views.
    fireEvent.click(screen.getAllByRole('button', { name: 'Playlist' })[0]);
    fireEvent.click(await screen.findByRole('option', { name: 'History Course' }));
    const position = screen.getByLabelText('Video position');
    fireEvent.change(position, { target: { value: '1' } });
    fireEvent.blur(position);
    expect(await screen.findByText(/Combined unique 10m/)).toBeTruthy();
  });

  it('tells the user when a manual entry falls outside the selected range and moves the range to it', async () => {
    render(<StoreProvider><HistoryView /></StoreProvider>);
    await screen.findByText(/Study history/);
    await screen.findByText('History Course');
    fireEvent.click(screen.getByRole('button', { name: 'today' }));
    const yesterday = addDaysToDateKey(todayKey, -1);
    fireEvent.change(screen.getByLabelText('Date'), { target: { value: yesterday } });
    fireEvent.click(screen.getByRole('button', { name: /Save self-reported/ }));

    expect(await screen.findByText(/outside today/)).toBeTruthy();
    expect(screen.getByText(/view switched to that date/)).toBeTruthy();
    await waitFor(() => expect(screen.getAllByText(/Self-reported playback/).length).toBeGreaterThanOrEqual(2));
    expect(screen.getByText(/Sessions in 2026-/)).toBeTruthy();
  });
});
