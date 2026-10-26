import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useState } from 'react';
import { openDB } from 'idb';
import { NumberField } from '../src/components/ui/NumberField.js';
import { Library } from '../src/features/playlists/Library.js';
import { StoreProvider } from '../src/app/store.js';

function Harness({ initial = 19, live = true, integer = true, min, max }: {
  initial?: number | null;
  live?: boolean;
  integer?: boolean;
  min?: number;
  max?: number;
}) {
  const [value, setValue] = useState<number | null>(initial);
  return (
    <div>
      <NumberField
        label="Target"
        value={value}
        onCommit={setValue}
        live={live}
        integer={integer}
        min={min}
        max={max}
        allowEmpty={initial === null}
      />
      <output data-testid="value">{value === null ? 'null' : String(value)}</output>
    </div>
  );
}

function input(): HTMLInputElement {
  return screen.getByLabelText('Target') as HTMLInputElement;
}

describe('numeric field normalization', () => {
  it('normalizes leading zeros on blur and saves the canonical number', () => {
    render(<Harness />);
    fireEvent.change(input(), { target: { value: '019' } });
    expect(input().value).toBe('019'); // typing stays intact
    fireEvent.blur(input());
    expect(input().value).toBe('19');
    expect(screen.getByTestId('value').textContent).toBe('19');
  });

  it('keeps an empty field empty while editing and never coerces it to zero', () => {
    render(<Harness />);
    fireEvent.change(input(), { target: { value: '' } });
    expect(input().value).toBe('');
    expect(screen.getByTestId('value').textContent).toBe('19');
    fireEvent.blur(input());
    expect(input().value).toBe('');
    expect(screen.getByTestId('value').textContent).toBe('19');
    expect(screen.getByText('Enter a number.')).toBeTruthy();
  });

  it('normalizes 000 to 0 when zero is valid', () => {
    render(<Harness initial={1} min={0} />);
    fireEvent.change(input(), { target: { value: '000' } });
    fireEvent.blur(input());
    expect(input().value).toBe('0');
    expect(screen.getByTestId('value').textContent).toBe('0');
  });

  it('rejects negatives and out-of-range values without changing saved state', () => {
    render(<Harness min={1} max={10} />);
    fireEvent.change(input(), { target: { value: '-4' } });
    expect(screen.getByTestId('value').textContent).toBe('19');
    fireEvent.blur(input());
    expect(screen.getByText('Minimum is 1.')).toBeTruthy();
    expect(screen.getByTestId('value').textContent).toBe('19');

    fireEvent.change(input(), { target: { value: '99' } });
    fireEvent.blur(input());
    expect(screen.getByText('Maximum is 10.')).toBeTruthy();
    expect(screen.getByTestId('value').textContent).toBe('19');
  });

  it('rejects fractions for integer fields but accepts decimals where allowed', () => {
    const { unmount } = render(<Harness integer />);
    fireEvent.change(input(), { target: { value: '2.5' } });
    fireEvent.blur(input());
    expect(screen.getByText('Use a whole number.')).toBeTruthy();
    unmount();

    render(<Harness integer={false} initial={2.5} />);
    fireEvent.change(input(), { target: { value: '02.50' } });
    fireEvent.blur(input());
    expect(input().value).toBe('2.5');
    expect(screen.getByTestId('value').textContent).toBe('2.5');
  });

  it('supports navigation fields that commit only on blur/Enter', () => {
    render(<Harness live={false} />);
    fireEvent.change(input(), { target: { value: '12' } });
    expect(screen.getByTestId('value').textContent).toBe('19');
    fireEvent.blur(input());
    expect(screen.getByTestId('value').textContent).toBe('12');
    expect(input().value).toBe('12');
  });

  it('Escape restores the committed value and clears the inline error', () => {
    render(<Harness />);
    fireEvent.change(input(), { target: { value: 'abc' } });
    expect(screen.getByText('Enter a valid number.')).toBeTruthy();
    fireEvent.keyDown(input(), { key: 'Escape' });
    expect(input().value).toBe('19');
    expect(screen.queryByText('Enter a valid number.')).toBeNull();
  });
});

const SNAP: any = {
  playlistId: 'PLnumeric00000000000',
  title: 'Numeric Course',
  reportedCount: 3,
  entries: [
    { position: 1, entryId: 'n1', videoId: 'v1', title: 'Intro', durationSec: 60 },
    { position: 2, entryId: 'n2', videoId: 'v2', title: 'Middle', durationSec: 120 },
    { position: 3, entryId: 'n3', videoId: 'v3', title: 'Finale', durationSec: 180 },
  ],
  source: 'api',
  fetchedAt: new Date().toISOString(),
  snapshotVersion: 2,
};

beforeEach(async () => {
  const db = await openDB('learnquest-db', 2, {
    upgrade(d) { if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv'); },
  });
  await db.clear('kv');
  await db.put('kv', { [SNAP.playlistId]: SNAP }, 'playlists');
  await db.put('kv', { [SNAP.playlistId]: { archived: false, addedAt: new Date().toISOString() } }, 'meta');
  await db.put('kv', SNAP.playlistId, 'activeId');
  await db.put('kv', {}, 'progress');
});

describe('numeric normalization reaches real screens', () => {
  it('Library range start displays 2 (not 02) after commit and recalculates the total', async () => {
    render(<StoreProvider><Library /></StoreProvider>);
    expect(await screen.findByText('0:06:00')).toBeTruthy();
    const start = screen.getByLabelText('Start (1–3)') as HTMLInputElement;
    fireEvent.change(start, { target: { value: '02' } });
    fireEvent.blur(start);
    expect(start.value).toBe('2');
    expect(await screen.findByText('0:05:00')).toBeTruthy();
  });
});
