import { useState } from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { openDB } from 'idb';
import { StoreProvider, useStore } from '../src/app/store.js';
import { Focus } from '../src/features/focus/Focus.js';
import { findProgressForEntry } from '../src/domain/index.js';

const P = 'PLfocusworkflow00000';
const SNAP: any = {
  playlistId: P,
  title: 'Focus Course',
  reportedCount: 1,
  entries: [{ position: 1, entryId: 'f1', videoId: 'fv1', title: 'Focus lesson', durationSec: 600 }],
  source: 'api',
  fetchedAt: '2026-10-01T00:00:00.000Z',
  snapshotVersion: 2,
};

beforeEach(async () => {
  vi.useRealTimers();
  localStorage.clear();
  const db = await openDB('learnquest-db', 2, {
    upgrade(d) { if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv'); },
  });
  await db.clear('kv');
  await db.put('kv', { [P]: SNAP }, 'playlists');
  await db.put('kv', { [P]: { archived: false, addedAt: '2026-10-01T00:00:00.000Z' } }, 'meta');
  await db.put('kv', P, 'activeId');
  await db.put('kv', { timezone: 'UTC' }, 'prefs');
  await db.put('kv', {}, 'progress');
  await db.put('kv', [], 'sessions');
});

afterEach(() => {
  vi.useRealTimers();
});

function Harness() {
  const s = useStore();
  const [armed, setArmed] = useState(false);
  if (!s.ready || !s.activeId) return <p>loading</p>;
  const rec = findProgressForEntry(s.progress, s.activeId, s.playlists[s.activeId].entries[0]);
  return (
    <div>
      <button onClick={() => setArmed(true)}>arm focus</button>
      {armed && <Focus />}
      <pre data-testid="focus-probe">{JSON.stringify({ sessions: s.sessions, rec: rec ?? null })}</pre>
    </div>
  );
}

function TwoTabHarness() {
  const s = useStore();
  const [armed, setArmed] = useState(false);
  if (!s.ready || !s.activeId) return <p>loading</p>;
  return (
    <div>
      <button onClick={() => setArmed(true)}>arm focus</button>
      {/* Two Focus instances model two same-origin tabs sharing localStorage. */}
      {armed && <Focus />}
      {armed && <Focus />}
      <pre data-testid="focus-probe">{JSON.stringify({ sessions: s.sessions })}</pre>
    </div>
  );
}

async function mountTwoTabs(at = '2026-10-27T10:00:00.000Z') {
  const utils = render(<StoreProvider><TwoTabHarness /></StoreProvider>);
  await screen.findByRole('button', { name: 'arm focus' });
  vi.useFakeTimers();
  vi.setSystemTime(new Date(at));
  fireEvent.click(screen.getByRole('button', { name: 'arm focus' }));
  await act(async () => { await Promise.resolve(); });
  expect(screen.getAllByText(/Focus timer/)).toHaveLength(2);
  return utils;
}

async function mount(at = '2026-10-27T10:00:00.000Z') {
  // Let the store hydrate with real timers (IndexedDB can use timers), then
  // install the deterministic clock before Focus mounts its own intervals.
  const utils = render(<StoreProvider><Harness /></StoreProvider>);
  await screen.findByRole('button', { name: 'arm focus' });
  vi.useFakeTimers();
  vi.setSystemTime(new Date(at));
  fireEvent.click(screen.getByRole('button', { name: 'arm focus' }));
  await act(async () => { await Promise.resolve(); });
  expect(screen.getByText(/Focus timer/)).toBeTruthy();
  return utils;
}

function probe(): any {
  return JSON.parse(screen.getByTestId('focus-probe').textContent || '{}');
}

describe('Focus end-to-end state machine', () => {
  it('start, pause, resume, finish; active excludes pauses, duplicate finish is blocked', async () => {
    await mount();
    fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    await act(async () => { await vi.advanceTimersByTimeAsync(65_000); });
    expect(screen.getByText('00:01:05')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    expect(screen.getByRole('button', { name: 'Resume' })).toBeTruthy();
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(screen.getByText('00:01:05')).toBeTruthy(); // active time did not advance
    expect(screen.getByText(/Elapsed time 00:02:05/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Resume' }));
    await act(async () => { await vi.advanceTimersByTimeAsync(35_000); });
    fireEvent.click(screen.getByRole('button', { name: /Finish/ }));
    // A rapid second click must not create a duplicate session.
    fireEvent.click(screen.getByRole('button', { name: /Finish/ }));
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });

    const data = probe();
    expect(data.sessions).toHaveLength(1);
    expect(data.sessions[0].activeSec).toBe(100);
    expect(data.sessions[0].elapsedSec).toBe(160);
    expect(data.sessions[0].estimated).toBeFalsy();
    expect(data.sessions[0].intervals.filter((i: any) => i.kind === 'active')
      .reduce((a: number, i: any) => a + (i.endMs - i.startMs) / 1000, 0)).toBe(100);
    // Focus recording never fabricates completion or playback verification.
    expect(data.rec).toBeNull();
  });

  it('persists the note and recovers an interrupted timer as paused', async () => {
    const first = await mount();
    fireEvent.change(screen.getByLabelText('Session note'), { target: { value: 'persist this note' } });
    fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    await act(async () => { await vi.advanceTimersByTimeAsync(12_000); });
    first.unmount();
    vi.useRealTimers();

    // Reopen 30 seconds later: the persisted ~12 seconds are recovered, but
    // the closed-tab time is never invented.
    await mount('2026-10-27T10:00:30.000Z');
    expect((screen.getByLabelText('Session note') as HTMLInputElement).value).toBe('persist this note');
    expect(screen.getByText(/Recovered paused session/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Resume' })).toBeTruthy();
    expect(screen.getByText(/^00:00:1[12]$/)).toBeTruthy();
  });

  it('prevents a second tab from starting a duplicate timer while the lease is live', async () => {
    await mountTwoTabs();
    const starts = screen.getAllByRole('button', { name: 'Start' });
    fireEvent.click(starts[0]);
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
    expect(screen.getAllByRole('button', { name: 'Pause' })).toHaveLength(1);

    fireEvent.click(screen.getAllByRole('button', { name: 'Start' })[0]);
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    expect(screen.getByText(/Another LearnQuest tab is already tracking focus/)).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Pause' })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'Start' })).toHaveLength(1);
    expect(probe().sessions).toHaveLength(0);
  });

  it('requires explicit confirmation before discarding a running timer', async () => {
    await mount();
    fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });

    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
    const confirm = screen.getByRole('group', { name: 'Confirm timer reset' });
    expect(confirm).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Pause' })).toBeTruthy();
    expect(probe().sessions).toHaveLength(0);

    fireEvent.click(screen.getByRole('button', { name: 'Keep timer' }));
    expect(screen.queryByRole('group', { name: 'Confirm timer reset' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Pause' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
    fireEvent.click(screen.getByRole('button', { name: 'Discard timer' }));
    expect(screen.queryByRole('group', { name: 'Confirm timer reset' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Start' })).toBeTruthy();
    expect(probe().sessions).toHaveLength(0);
  });

  it('records a manual correction as estimated and does not present it as observed', async () => {
    await mount();
    fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    await act(async () => { await vi.advanceTimersByTimeAsync(20_000); });
    fireEvent.change(screen.getByLabelText(/Adjust recorded time/), { target: { value: '2' } });
    fireEvent.blur(screen.getByLabelText(/Adjust recorded time/));
    fireEvent.click(screen.getByRole('button', { name: /Finish/ }));
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    const data = probe();
    expect(data.sessions).toHaveLength(1);
    expect(data.sessions[0].activeSec).toBe(120);
    expect(data.sessions[0].estimated).toBe(true);
    expect(data.sessions[0].intervals).toEqual([]);
    expect(data.sessions[0].elapsedSec).toBeGreaterThanOrEqual(120);
  });
});
