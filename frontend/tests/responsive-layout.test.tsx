import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { openDB } from 'idb';
import { StoreProvider } from '../src/app/store.js';
import { Library } from '../src/features/playlists/Library.js';
import { Player } from '../src/features/player/Player.js';

const P = 'PLresponsive000000001';
const LONG_TITLE = `${'Extremely long lesson title '.repeat(12)}finale`;

const SNAP: any = {
  playlistId: P,
  title: 'Responsive Course',
  reportedCount: 2,
  entries: [
    { position: 1, entryId: 'r1', videoId: 'v1', title: LONG_TITLE, durationSec: 3600 },
    { position: 2, entryId: 'r2', videoId: 'v2', title: 'Short lesson', durationSec: 60 },
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
  await db.put('kv', { [P]: SNAP }, 'playlists');
  await db.put('kv', { [P]: { archived: false, addedAt: new Date().toISOString() } }, 'meta');
  await db.put('kv', P, 'activeId');
  await db.put('kv', {}, 'progress');
});

afterEach(() => {
  delete (window as any).YT;
});

describe('responsive Library and Player text containment', () => {
  it('Library renders a phone card list with full titles and no 640px-only row path', async () => {
    render(<StoreProvider><Library /></StoreProvider>);
    const list = await screen.findByRole('list', { name: 'Videos' });
    const title = within(list).getByText(LONG_TITLE);
    expect(title).toBeInTheDocument();
    expect(title.className).toContain('break-words');
    expect(title.className).not.toContain('truncate');
    const card = title.closest('li');
    expect(card).not.toBeNull();
    // Touch actions are at least 44px high in the phone layout.
    for (const button of within(card as HTMLElement).getAllByRole('button')) {
      expect(button.className).toContain('min-h-11');
    }
    const table = document.querySelector('table');
    expect(table).not.toBeNull();
    expect((table as HTMLElement).parentElement?.className).toContain('hidden');
    expect((table as HTMLElement).parentElement?.className).toContain('md:block');
  });

  it('Player wraps the full title and telemetry instead of clipping it', async () => {
    (window as any).YT = {
      Player: class {
        constructor(_el: unknown, opts: any) {
          opts.events?.onReady?.({ target: { getPlaybackRate: () => 1 } });
        }
        destroy() {}
        getCurrentTime() { return 0; }
        getPlaybackRate() { return 1; }
      },
      PlayerState: { PLAYING: 1, PAUSED: 2, BUFFERING: 3, ENDED: 0 },
    };
    render(<StoreProvider><Player /></StoreProvider>);
    const title = await screen.findByText(LONG_TITLE);
    expect(title.className).toContain('break-words');
    expect(title.className).not.toContain('truncate');
    const telemetry = screen.getByText(/unique 0:00:00/);
    expect(telemetry.className).toContain('break-words');
    expect(telemetry.className).toContain('w-full');
    expect(telemetry.className).toContain('sm:w-auto');
  });
});
