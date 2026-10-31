import { describe, expect, it } from 'vitest';
import { mergeAccountState, mergeCollection } from '../src/services/persistence/cloudMerge.js';

const goal = (id: string, target: number) => ({ id, dateKey: '2026-10-30', targetFocusSec: target });

describe('cloud three-way merge', () => {
  it('keeps a local-only change when the server is unchanged', () => {
    const base = { g1: goal('g1', 100) };
    const local = { g1: goal('g1', 200) };
    const result = mergeCollection('goals', base, local, base);
    expect(result.conflicts).toEqual([]);
    expect(result.value).toEqual(local);
  });

  it('accepts a remote-only change when the local side is unchanged', () => {
    const base = { g1: goal('g1', 100) };
    const remote = { g1: goal('g1', 300) };
    expect(mergeCollection('goals', base, base, remote).value).toEqual(remote);
  });

  it('merges edits to different records without a conflict', () => {
    const base = { g1: goal('g1', 100), g2: goal('g2', 100) };
    const local = { g1: goal('g1', 200), g2: goal('g2', 100) };
    const remote = { g1: goal('g1', 100), g2: goal('g2', 300) };
    const result = mergeCollection('goals', base, local, remote);
    expect(result.conflicts).toEqual([]);
    expect(result.value).toEqual({ g1: goal('g1', 200), g2: goal('g2', 300) });
  });

  it('reports a conflict when the same record changed differently', () => {
    const base = { g1: goal('g1', 100) };
    const local = { g1: goal('g1', 200) };
    const remote = { g1: goal('g1', 300) };
    const result = mergeCollection('goals', base, local, remote);
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0]).toMatchObject({ collection: 'goals', key: 'g1' });
    // Local intent is preserved until the user decides.
    expect(result.value).toEqual(local);
  });

  it('preserves a deletion and never resurrects a deleted record', () => {
    const base = [goal('a', 1), goal('b', 2)];
    const local = [goal('a', 1)]; // local deleted b
    const remote = [goal('a', 1), { ...goal('b', 2), targetFocusSec: 99 }];
    const result = mergeCollection('checkpoints', base, local, remote);
    expect(result.value).toEqual([goal('a', 1)]);
  });

  it('merges event-like arrays by stable identity, not index', () => {
    const base = [{ id: 's1', clientId: 'c1', activeSec: 60 }];
    const local = [...base, { id: 's2', clientId: 'c2', activeSec: 120 }];
    const remote = [{ id: 's1', clientId: 'c1', activeSec: 60 }, { id: 's3', clientId: 'c3', activeSec: 180 }];
    const result = mergeCollection('sessions', base, local, remote);
    expect(result.conflicts).toEqual([]);
    expect(result.value).toEqual([
      { id: 's1', clientId: 'c1', activeSec: 60 },
      { id: 's2', clientId: 'c2', activeSec: 120 },
      { id: 's3', clientId: 'c3', activeSec: 180 },
    ]);
  });

  it('treats a differing singleton as an explicit conflict', () => {
    const result = mergeCollection('settings', { verifiedThreshold: 0.9 }, { verifiedThreshold: 0.8 }, { verifiedThreshold: 0.7 });
    expect(result.conflicts).toHaveLength(1);
    expect(result.value).toEqual({ verifiedThreshold: 0.8 });
  });

  it('merges a full account state and reports only genuine record conflicts', () => {
    const base = { goals: { g1: goal('g1', 1) }, sessions: [], prefs: { timezone: 'UTC' } };
    const local = { goals: { g1: goal('g1', 2) }, sessions: [{ id: 's1' }], prefs: { timezone: 'UTC' } };
    const remote = { goals: { g1: goal('g1', 1) }, sessions: [], prefs: { timezone: 'Europe/London' } };
    const result = mergeAccountState(['goals', 'sessions', 'prefs'], base, local, remote);
    expect(result.conflicts).toEqual([]);
    expect(result.state.goals).toEqual({ g1: goal('g1', 2) });
    expect(result.state.sessions).toEqual([{ id: 's1' }]);
    expect(result.state.prefs).toEqual({ timezone: 'Europe/London' });
  });
});
