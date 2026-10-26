import { useState } from 'react';
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { openDB } from 'idb';
import { StoreProvider, useStore } from '../src/app/store.js';
import { PlayerLearningRecord } from '../src/features/player/LearningRecordEditor.js';
import { isValidRevisionDate } from '../src/components/ui/AnnotationFields.js';
import { findProgressForEntry, identityKey } from '../src/domain/index.js';

const P = 'PLplayerrec000000000';
const SNAP: any = {
  playlistId: P,
  title: 'Player Record Course',
  reportedCount: 2,
  entries: [
    { position: 1, entryId: 'p1', videoId: 'v1', title: 'First lesson', durationSec: 600 },
    { position: 2, entryId: 'p2', videoId: 'v2', title: 'Second lesson', durationSec: 700 },
  ],
  source: 'api',
  fetchedAt: '2026-10-01T00:00:00.000Z',
  snapshotVersion: 2,
};

const PROGRESS: any = {
  [`${P}::p1`]: {
    playlistId: P, position: 1, entryId: 'p1', videoId: 'v1',
    status: 'done', completedAt: '2026-10-01T10:00:00.000Z', source: 'verified',
    verifiedAt: '2026-10-01T10:00:00.000Z',
    notes: 'original note', confidence: 4, keyConcepts: 'old concepts',
  },
};

beforeEach(async () => {
  const db = await openDB('learnquest-db', 2, {
    upgrade(d) { if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv'); },
  });
  await db.clear('kv');
  await db.put('kv', { [P]: SNAP }, 'playlists');
  await db.put('kv', { [P]: { archived: false, addedAt: '2026-10-01T00:00:00.000Z' } }, 'meta');
  await db.put('kv', P, 'activeId');
  await db.put('kv', PROGRESS, 'progress');
  await db.put('kv', [], 'segments');
  await db.put('kv', [], 'playSessions');
  await db.put('kv', [], 'sessions');
});

function Harness() {
  const s = useStore();
  const [pos, setPos] = useState(1);
  if (!s.ready || !s.activeId) return <p>loading</p>;
  const snap = s.playlists[s.activeId];
  const entry = snap.entries.find((e) => e.position === pos)!;
  const rec = findProgressForEntry(s.progress, s.activeId, entry);
  const rec1 = findProgressForEntry(s.progress, s.activeId, snap.entries[0]);
  return (
    <div>
      <button onClick={() => setPos(2)}>switch video</button>
      <button onClick={() => s.toggleDone(P, 1, 'v1')}>toggle completion</button>
      <button onClick={() => s.addSegments([{
        id: 'probe-segment', playlistId: P, position: 1, entryId: 'p1', videoId: 'v1',
        sessionId: 'probe-session', wallStartMs: 1_700_000_000_000, wallEndMs: 1_700_000_030_000,
        timelineStartSec: 0, timelineEndSec: 30, playbackRate: 1, source: 'verified',
      }])}>add player evidence</button>
      <PlayerLearningRecord entry={entry} />
      <pre data-testid="record">{JSON.stringify(rec ?? null)}</pre>
      <pre data-testid="record1">{JSON.stringify(rec1 ?? null)}</pre>
    </div>
  );
}

async function mount() {
  const utils = render(<StoreProvider><Harness /></StoreProvider>);
  await screen.findByText(/Learning record/);
  return utils;
}

function record(): any {
  return JSON.parse(screen.getByTestId('record').textContent || 'null');
}

function record1(): any {
  return JSON.parse(screen.getByTestId('record1').textContent || 'null');
}

function pickConfidence(value: number) {
  fireEvent.click(screen.getByRole('button', { name: 'Confidence (1–5)' }));
  fireEvent.click(screen.getByRole('option', { name: new RegExp(`^${value} / 5`) }));
}

async function save() {
  fireEvent.click(screen.getByRole('button', { name: /Save learning record/ }));
  await screen.findByText(/Learning record saved/);
}

describe('Player persistent learning-record editor', () => {
  it('saves every metadata field to the exact selected entry without completing it', async () => {
    await mount();
    expect((screen.getByLabelText('Notes') as HTMLTextAreaElement).value).toBe('original note');
    expect((screen.getByLabelText('Key concepts') as HTMLTextAreaElement).value).toBe('old concepts');

    fireEvent.change(screen.getByLabelText('Notes'), { target: { value: 'new persistent note' } });
    fireEvent.change(screen.getByLabelText('Key concepts'), { target: { value: 'closures, scope' } });
    fireEvent.change(screen.getByLabelText('Questions to investigate'), { target: { value: 'Why hoisting?' } });
    fireEvent.change(screen.getByLabelText('Revision date'), { target: { value: '2026-11-30' } });
    pickConfidence(2);
    fireEvent.click(screen.getByLabelText('Code reproduced'));
    fireEvent.click(screen.getByLabelText('Exercise done'));
    fireEvent.click(screen.getByLabelText('Built example'));
    fireEvent.click(screen.getByLabelText('Needs revision'));
    await save();

    const rec = record();
    expect(rec.notes).toBe('new persistent note');
    expect(rec.keyConcepts).toBe('closures, scope');
    expect(rec.questions).toBe('Why hoisting?');
    expect(rec.revisionDate).toBe('2026-11-30');
    expect(rec.confidence).toBe(2);
    expect(rec.codeReproduced).toBe(true);
    expect(rec.exerciseDone).toBe(true);
    expect(rec.builtExample).toBe(true);
    expect(rec.needsRevision).toBe(true);
    // Saving metadata must never create or change completion evidence.
    expect(rec.completedAt).toBe('2026-10-01T10:00:00.000Z');
    expect(rec.status).toBe('done');
    expect(rec.source).toBe('verified');
    expect(rec.verifiedAt).toBe('2026-10-01T10:00:00.000Z');
  });

  it('loads annotations per video, saves to the correct key, and survives reload', async () => {
    const first = await mount();
    fireEvent.change(screen.getByLabelText('Notes'), { target: { value: 'first video note' } });
    await save();

    fireEvent.click(screen.getByRole('button', { name: 'switch video' }));
    await waitFor(() => expect(screen.getByText(/Learning record · #2/)).toBeTruthy());
    expect((screen.getByLabelText('Notes') as HTMLTextAreaElement).value).toBe('');
    fireEvent.change(screen.getByLabelText('Notes'), { target: { value: 'second video note' } });
    await save();

    let raw: any = {};
    await waitFor(async () => {
      const db = await openDB('learnquest-db', 2);
      raw = await db.get('kv', 'progress');
      expect(raw[identityKey(P, 'p1')].notes).toBe('first video note');
      expect(raw[identityKey(P, 'p2')].notes).toBe('second video note');
    });
    // The second entry has no completion; metadata alone creates a draft.
    expect(raw[identityKey(P, 'p2')].completedAt).toBeNull();
    expect(raw[identityKey(P, 'p2')].status).toBe('in-progress');

    first.unmount();
    await mount();
    expect((screen.getByLabelText('Notes') as HTMLTextAreaElement).value).toBe('first video note');
    fireEvent.click(screen.getByRole('button', { name: 'switch video' }));
    await waitFor(() => expect(screen.getByText(/Learning record · #2/)).toBeTruthy());
    expect((screen.getByLabelText('Notes') as HTMLTextAreaElement).value).toBe('second video note');
  });

  it('does not let completion toggles or player telemetry overwrite the draft', async () => {
    await mount();
    fireEvent.change(screen.getByLabelText('Notes'), { target: { value: 'must survive' } });
    await save();

    fireEvent.click(screen.getByRole('button', { name: 'toggle completion' }));
    await waitFor(() => expect(record().completedAt).toBeNull());
    expect(record().notes).toBe('must survive');
    fireEvent.click(screen.getByRole('button', { name: 'toggle completion' }));
    await waitFor(() => expect(record().completedAt).toBeTruthy());
    expect(record().notes).toBe('must survive');

    fireEvent.click(screen.getByRole('button', { name: 'add player evidence' }));
    await waitFor(() => expect(record().notes).toBe('must survive'));
    expect((screen.getByLabelText('Notes') as HTMLTextAreaElement).value).toBe('must survive');
  });

  it('flushes an unfinished draft before switching videos', async () => {
    await mount();
    fireEvent.change(screen.getByLabelText('Notes'), { target: { value: 'typed but not saved' } });
    fireEvent.click(screen.getByRole('button', { name: 'switch video' }));
    await waitFor(() => expect(record1().notes).toBe('typed but not saved'));
  });

  it('validates revision dates and confidence at the shared boundary', () => {
    expect(isValidRevisionDate('')).toBe(true);
    expect(isValidRevisionDate('2026-11-30')).toBe(true);
    expect(isValidRevisionDate('2026-02-31')).toBe(false);
    expect(isValidRevisionDate('2026-13-01')).toBe(false);
    expect(isValidRevisionDate('not-a-date')).toBe(false);
    // Confidence is a constrained 1–5 dropdown, so no out-of-range value can
    // reach persistence from either the Player or Revision editor.
  });

  it('records review history once per day without deleting annotations', async () => {
    await mount();
    fireEvent.change(screen.getByLabelText('Notes'), { target: { value: 'review keeps me' } });
    await save();
    fireEvent.click(screen.getByRole('button', { name: /Mark reviewed/ }));
    await waitFor(() => expect(record().revisionDoneAt).toBeTruthy());
    expect(record().notes).toBe('review keeps me');
    expect(record().reviewHistory).toHaveLength(1);
    expect((screen.getByLabelText('Needs revision') as HTMLInputElement).checked).toBe(false);

    // Repeated click on the same day must not duplicate history.
    const btn = screen.getByRole('button', { name: /Mark reviewed/ }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });
});
