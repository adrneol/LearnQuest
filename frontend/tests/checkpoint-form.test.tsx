import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { openDB } from 'idb';
import { StoreProvider, useStore } from '../src/app/store.js';
import { DialogHost } from '../src/components/ui/dialog.js';
import { Checkpoints } from '../src/features/checkpoints/Checkpoints.js';

const P = 'PLcheckpointform00000';
const SNAP: any = {
  playlistId: P,
  title: 'Checkpoint Course',
  reportedCount: 5,
  entries: Array.from({ length: 5 }, (_, i) => ({
    position: i + 1,
    entryId: `c${i + 1}`,
    videoId: `cv${i + 1}`,
    title: `Video ${i + 1}`,
    durationSec: 600,
  })),
  source: 'api',
  fetchedAt: '2026-10-01T00:00:00.000Z',
  snapshotVersion: 2,
};

async function seed() {
  const db = await openDB('learnquest-db', 2, {
    upgrade(d) { if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv'); },
  });
  await db.clear('kv');
  await db.put('kv', { [P]: SNAP }, 'playlists');
  await db.put('kv', { [P]: { archived: false, addedAt: '2026-10-01T00:00:00.000Z' } }, 'meta');
  await db.put('kv', P, 'activeId');
  await db.put('kv', {}, 'progress');
  await db.put('kv', [], 'checkpoints');
  await db.put('kv', [], 'ranges');
}

function Probe() {
  const s = useStore();
  return (
    <div data-testid="probe">
      {JSON.stringify({
        ready: s.ready,
        checkpoints: s.checkpoints
          .map((c) => ({ label: c.label, start: c.start, end: c.end }))
          .sort((a, b) => a.start - b.start),
      })}
    </div>
  );
}

function renderCheckpoints() {
  render(
    <StoreProvider mode="local">
      <Checkpoints />
      <Probe />
      <DialogHost />
    </StoreProvider>,
  );
}

async function probe() {
  await waitFor(() => expect(screen.getByTestId('probe').textContent).toContain('"ready":true'));
  return JSON.parse(screen.getByTestId('probe').textContent ?? '{}');
}

beforeEach(async () => {
  await seed();
});

describe('checkpoint form: one range, generated label, optional name', () => {
  it('rejects an out-of-bounds range without clamping and keeps the add action disabled', async () => {
    renderCheckpoints();
    await probe();
    const input = screen.getByLabelText('Video range');
    fireEvent.change(input, { target: { value: '1–8' } });
    expect(screen.getByText(/outside this playlist \(1–5\).*Nothing was clamped/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Add checkpoint/ })).toBeDisabled();
    expect((await probe()).checkpoints).toEqual([]);
  });

  it('creates a range checkpoint with a generated label, then one position with a custom name', async () => {
    renderCheckpoints();
    await probe();

    fireEvent.change(screen.getByLabelText('Video range'), { target: { value: '1–4' } });
    expect(screen.getByText(/This will create/)).toHaveTextContent('Videos 1–4');
    fireEvent.click(screen.getByRole('button', { name: /Add checkpoint/ }));
    await waitFor(async () => {
      expect((await probe()).checkpoints).toEqual([{ label: 'Videos 1–4', start: 1, end: 4 }]);
    });
    expect(screen.getByLabelText('Video range')).toHaveValue('');

    fireEvent.change(screen.getByLabelText('Video range'), { target: { value: '3' } });
    fireEvent.change(screen.getByLabelText('Custom checkpoint name (optional)'), { target: { value: '  Variables  ' } });
    expect(screen.getByText(/This will create/)).toHaveTextContent('Variables');
    fireEvent.click(screen.getByRole('button', { name: /Add checkpoint/ }));
    await waitFor(async () => {
      expect((await probe()).checkpoints).toEqual([
        { label: 'Videos 1–4', start: 1, end: 4 },
        { label: 'Variables', start: 3, end: 3 },
      ]);
    });
  });

  it('edits a range while preserving a custom name and regenerating an auto label', async () => {
    renderCheckpoints();
    await probe();
    for (const [range, name] of [['1-4', ''], ['3', 'Variables']] as const) {
      fireEvent.change(screen.getByLabelText('Video range'), { target: { value: range } });
      if (name) fireEvent.change(screen.getByLabelText('Custom checkpoint name (optional)'), { target: { value: name } });
      fireEvent.click(screen.getByRole('button', { name: /Add checkpoint/ }));
    }
    await waitFor(async () => expect((await probe()).checkpoints).toHaveLength(2));

    // Custom-named checkpoint (position 3): label stays "Variables".
    fireEvent.click(screen.getAllByTitle('Edit checkpoint range')[1]);
    const customInput = screen.getByRole('textbox', { name: 'Edit checkpoint range' });
    fireEvent.change(customInput, { target: { value: '2-3' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(async () => {
      const list = (await probe()).checkpoints;
      expect(list).toContainEqual({ label: 'Variables', start: 2, end: 3 });
    });

    // Auto-labelled checkpoint: the generated name follows the new range.
    fireEvent.click(screen.getAllByTitle('Edit checkpoint range')[0]);
    const autoInput = screen.getByRole('textbox', { name: 'Edit checkpoint range' });
    fireEvent.change(autoInput, { target: { value: '2-4' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(async () => {
      const list = (await probe()).checkpoints;
      expect(list).toContainEqual({ label: 'Videos 2–4', start: 2, end: 4 });
    });
  });
});
