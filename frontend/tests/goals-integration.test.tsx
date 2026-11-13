import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { Goals } from '../src/features/goals/Goals.js';
import { Focus } from '../src/features/focus/Focus.js';
import { openDB } from 'idb';
import { StoreProvider, useStore } from '../src/app/store.js';

const P = 'PLgoalsintegration000';
const TZ = 'UTC';
// Pinned, deterministic reference instant (midday keeps the whole scenario
// inside one calendar day regardless of the host wall clock).
const FIXED_NOW = '2026-06-15T12:00:00.000Z';
const FIXED_DATE_MS = Date.parse(FIXED_NOW);
const todayKey = new Date(FIXED_DATE_MS).toISOString().slice(0, 10);

const SNAP: any = {
  playlistId: P,
  title: 'Goals Course',
  reportedCount: 2,
  entries: [
    { position: 1, entryId: 'g1', videoId: 'gv1', title: 'Intro', durationSec: 300 },
    { position: 2, entryId: 'g2', videoId: 'gv2', title: 'Deep dive', durationSec: 600 },
  ],
  source: 'imported',
  fetchedAt: '2026-06-01T00:00:00.000Z',
  snapshotVersion: 2,
};

const DAILY = { dateKey: todayKey, targetFocusSec: 1800, minViableSec: 600 };
// 20 minutes ago — entirely inside today, so day-boundary attribution is exact.
const SESSION = {
  id: 'focus-1', clientId: 'focus-1', playlistId: P,
  startedAt: new Date(FIXED_DATE_MS - 1200_000).toISOString(),
  finishedAt: new Date(FIXED_DATE_MS - 600_000).toISOString(),
  activeSec: 600, elapsedSec: 600,
  dateKey: todayKey, source: 'verified' as const,
};

async function seed({ withDailyGoal = true, withSession = true, flexGoals = [] as any[] } = {}) {
  const db = await openDB('learnquest-db', 2, {
    upgrade(d) { if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv'); },
  });
  await db.clear('kv');
  await db.put('kv', { [P]: SNAP }, 'playlists');
  await db.put('kv', { [P]: { archived: false, addedAt: '2026-06-01T00:00:00.000Z' } }, 'meta');
  await db.put('kv', P, 'activeId');
  await db.put('kv', { timezone: TZ }, 'prefs');
  await db.put('kv', {}, 'progress');
  await db.put('kv', withSession ? [SESSION] : [], 'sessions');
  await db.put('kv', withDailyGoal ? { [todayKey]: DAILY } : {}, 'goals');
  await db.put('kv', flexGoals, 'flexGoals');
  await db.put('kv', [], 'xp');
  await db.put('kv', {}, 'achievements');
  await db.put('kv', [], 'segments');
  await db.put('kv', [], 'playSessions');
  await db.put('kv', [], 'checkpoints');
  await db.put('kv', [], 'modules');
  await db.put('kv', [], 'ranges');
  await db.put('kv', { verifiedThreshold: 0.9 }, 'settings');
}

function Probe() {
  const s = useStore();
  const json = JSON.stringify({ ready: s.ready, goals: s.goals, flexGoals: s.flexGoals, tz: s.prefs.timezone });
  return <div data-testid="probe">{json}</div>;
}

async function renderAndSettle(node: React.ReactElement<any>) {
  render(node);
  for (let i = 0; i < 100; i++) {
    await act(async () => { await Promise.resolve(); });
    const probe = screen.queryByTestId('probe');
    if (probe?.textContent?.includes('"ready":true')) return;
  }
  throw new Error('store never became ready');
}

beforeEach(async () => {
  vi.setSystemTime(new Date(FIXED_NOW));
  await seed();
});

afterEach(() => {
  vi.useRealTimers();
  window.location.hash = '';
});

describe('Goals and Focus integration', () => {
  it('shows the same daily focus goal on the Goals page', async () => {
    await renderAndSettle(
      <StoreProvider mode="local">
        <Goals />
        <Probe />
      </StoreProvider>,
    );
    expect(screen.getByText("Today's focus goal")).toBeTruthy();
    expect(screen.getByLabelText("Today's focus goal")).toHaveAttribute('aria-valuenow', '33'); // 600 / 1800
  });

  it('still shows the flexible-goal sections alongside', async () => {
    await renderAndSettle(
      <StoreProvider mode="local">
        <Goals />
        <Probe />
      </StoreProvider>,
    );
    expect(screen.getByText('Flexible goals')).toBeTruthy();
    expect(screen.getByText('No flexible goals')).toBeTruthy();
  });

  it('expresses the same daily target on the Focus page with a working goal editor', async () => {
    await renderAndSettle(
      <StoreProvider mode="local">
        <Focus />
        <Probe />
      </StoreProvider>,
    );
    // Daily study goal NumberField reflects the stored target (30 minutes).
    expect(screen.getByLabelText('Daily study goal (min)')).toHaveAttribute('value', '30');
    expect(screen.getByText('Flexible goals →').closest('a')).toHaveAttribute('href', '#/goals');
  });

  it('handles a missing daily goal without inventing one', async () => {
    await seed({ withDailyGoal: false });
    await renderAndSettle(
      <StoreProvider mode="local">
        <Goals />
        <Probe />
      </StoreProvider>,
    );
    expect(screen.getByText(/No focus goal set for today/)).toBeTruthy();
  });

  it('counts today\'s focused minutes against the target', async () => {
    await seed({ withSession: true });
    await renderAndSettle(
      <StoreProvider mode="local">
        <Goals />
        <Probe />
      </StoreProvider>,
    );
    // 600 active seconds are recorded → 33% of the 1800s target.
    expect(screen.getByLabelText("Today's focus goal")).toHaveAttribute('aria-valuenow', '33');
  });

  it('renders paused and completed flexible goals with their own metric semantics', async () => {
    const flex: any = {
      id: 'flex-1', label: 'Five videos', metric: 'video-count', target: 5,
      playlistId: null, checkpointId: undefined, dateKey: null, paused: true,
      createdAt: '2026-06-01T00:00:00.000Z', achievedAt: null, achievedValue: null,
    };
    await seed({ flexGoals: [flex] });
    await renderAndSettle(
      <StoreProvider mode="local">
        <Goals />
        <Probe />
      </StoreProvider>,
    );
    expect(screen.getByText('Five videos')).toBeTruthy();
    expect(screen.getByText('paused')).toBeTruthy();
    expect(screen.queryByText('No flexible goals')).toBeNull();
  });
});

describe('Goals and Focus across the calendar boundary', () => {
  it('attributes a cross-midnight session to both UTC days', async () => {
    // 23:00→01:00 wall GMT, 3600s active — attribution must split evenly.
    await openDB('learnquest-db', 2, {
      upgrade(d) { if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv'); },
    }).then(async (db) => {
      await db.clear('kv');
      const dayKey = '2026-06-15';
      await db.put('kv', { [P]: SNAP }, 'playlists');
      await db.put('kv', { [P]: { archived: false, addedAt: '2026-06-01T00:00:00.000Z' } }, 'meta');
      await db.put('kv', P, 'activeId');
      await db.put('kv', { timezone: TZ }, 'prefs');
      await db.put('kv', {}, 'progress');
      await db.put('kv', [{ id: 'split', clientId: 'split', playlistId: P,
        startedAt: '2026-06-14T23:00:00.000Z', finishedAt: '2026-06-15T01:00:00.000Z',
        activeSec: 3600, elapsedSec: 7200, dateKey: '2026-06-14', source: 'verified' as const }], 'sessions');
      await db.put('kv', { [dayKey]: { dateKey: dayKey, targetFocusSec: 1800, minViableSec: 600 } }, 'goals');
    });
    await renderAndSettle(
      <StoreProvider mode="local">
        <Goals />
        <Probe />
      </StoreProvider>,
    );
    // 1800s attributable to 2026-06-15 → 100% of the 1800s target shown.
    expect(screen.getByLabelText("Today's focus goal")).toHaveAttribute('aria-valuenow', '100');
  });

  it('attributes a cross-midnight session proportionally to the correct days', async () => {
    // 23:30→00:30 wall GMT, 1800s active — exactly half attributed today.
    await openDB('learnquest-db', 2, {
      upgrade(d) { if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv'); },
    }).then(async (db) => {
      await db.clear('kv');
      const dayKey = '2026-06-15';
      await db.put('kv', { [P]: SNAP }, 'playlists');
      await db.put('kv', { [P]: { archived: false, addedAt: '2026-06-01T00:00:00.000Z' } }, 'meta');
      await db.put('kv', P, 'activeId');
      await db.put('kv', { timezone: TZ }, 'prefs');
      await db.put('kv', {}, 'progress');
      await db.put('kv', [{ id: 'split2', clientId: 'split2', playlistId: P,
        startedAt: '2026-06-14T23:30:00.000Z', finishedAt: '2026-06-15T00:30:00.000Z',
        activeSec: 1800, elapsedSec: 3600, dateKey: '2026-06-14', source: 'verified' as const }], 'sessions');
      await db.put('kv', { [dayKey]: { dateKey: dayKey, targetFocusSec: 1800, minViableSec: 600 } }, 'goals');
    });
    await renderAndSettle(
      <StoreProvider mode="local">
        <Goals />
        <Probe />
      </StoreProvider>,
    );
    // 900s today → 50% of the 1800s target.
    expect(screen.getByLabelText("Today's focus goal")).toHaveAttribute('aria-valuenow', '50');
  });
});
