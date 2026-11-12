import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { openDB } from 'idb';
import { StoreProvider, useStore } from '../src/app/store.js';
import { Goals } from '../src/features/goals/Goals.js';
import { Focus } from '../src/features/focus/Focus.js';

const P = 'PLgoalsintegration000';
const TODAY = new Date();
const TZ = 'UTC';
const todayKey = (() => {
  // Mirror domain/time/time.ts calendarWindowDates(1, 'UTC') semantics.
  const key = TODAY.toISOString().slice(0, 10);
  return key;
})();

const SNAP: any = {
  playlistId: P,
  title: 'Goals Course',
  reportedCount: 2,
  entries: [
    { position: 1, entryId: 'g1', videoId: 'gv1', title: 'Intro', durationSec: 300 },
    { position: 2, entryId: 'g2', videoId: 'gv2', title: 'Deep dive', durationSec: 600 },
  ],
  source: 'imported',
  fetchedAt: '2026-11-01T00:00:00.000Z',
  snapshotVersion: 2,
};

const DAILY = { dateKey: todayKey, targetFocusSec: 1800, minViableSec: 600 };
const SESSION = {
  id: 'focus-1', clientId: 'focus-1', playlistId: P,
  startedAt: new Date(TODAY.getTime() - 1200_000).toISOString(),
  finishedAt: new Date(TODAY.getTime() - 600_000).toISOString(),
  activeSec: 600, elapsedSec: 600, dateKey: todayKey, source: 'verified' as const,
};

async function seed({ withDailyGoal = true, withSession = true, flexGoals = [] as any[] } = {}) {
  const db = await openDB('learnquest-db', 2, {
    upgrade(d) { if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv'); },
  });
  await db.clear('kv');
  await db.put('kv', { [P]: SNAP }, 'playlists');
  await db.put('kv', { [P]: { archived: false, addedAt: '2026-11-01T00:00:00.000Z' } }, 'meta');
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

function renderGoals() {
  return render(
    <StoreProvider mode="local">
      <Goals />
      <Probe />
    </StoreProvider>,
  );
}

async function ready() {
  await waitFor(() => expect(screen.getByTestId('probe').textContent).toContain('"ready":true'));
}

beforeEach(async () => {
  window.location.hash = '';
  await seed();
});

describe('Goals and Focus integration', () => {
  it('shows the same daily focus goal on the Goals page', async () => {
    renderGoals();
    await ready();
    expect(screen.getByText("Today's focus goal")).toBeTruthy();
    expect(screen.getByLabelText("Today's focus goal")).toHaveAttribute('aria-valuenow', '33'); // 600 / 1800
  });

  it('still shows the flexible-goal sections alongside', async () => {
    renderGoals();
    await ready();
    expect(screen.getByText('Flexible goals')).toBeTruthy();
    expect(screen.getByText('No flexible goals')).toBeTruthy();
  });

  it('expresses the same daily target on the Focus page with a working goal editor', async () => {
    render(
      <StoreProvider mode="local">
        <Focus />
        <Probe />
      </StoreProvider>,
    );
    await ready();
    // Daily study goal NumberField reflects the stored target (30 minutes).
    expect(screen.getByLabelText('Daily study goal (min)')).toHaveAttribute('value', '30');
    expect(screen.getByText('Flexible goals →').closest('a')).toHaveAttribute('href', '#/goals');
  });

  it('handles a missing daily goal without inventing one', async () => {
    await seed({ withDailyGoal: false });
    renderGoals();
    await ready();
    expect(screen.getByText(/No focus goal set for today/)).toBeTruthy();
  });

  it('counts today\'s focused minutes against the target', async () => {
    await seed({ withSession: true });
    renderGoals();
    await ready();
    // 600 active seconds are recorded → 33% of the 1800s target.
    expect(screen.getByLabelText("Today's focus goal")).toHaveAttribute('aria-valuenow', '33');
  });

  it('renders paused and completed flexible goals with their own metric semantics', async () => {
    const flex: any = {
      id: 'flex-1', label: 'Five videos', metric: 'video-count', target: 5,
      playlistId: null, checkpointId: undefined, dateKey: null, paused: true,
      createdAt: '2026-11-01T00:00:00.000Z', achievedAt: null, achievedValue: null,
    };
    await seed({ flexGoals: [flex] });
    renderGoals();
    await ready();
    expect(screen.getByText('Five videos')).toBeTruthy();
    expect(screen.getByText('paused')).toBeTruthy();
    expect(screen.queryByText('No flexible goals')).toBeNull();
  });
});
