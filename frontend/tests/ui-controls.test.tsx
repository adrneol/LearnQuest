import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { openDB } from 'idb';
import App from '../src/app/App';
import { StoreProvider } from '../src/app/store';
import { Library } from '../src/features/playlists/Library';
import { TimezonePicker } from '../src/components/ui/TimezonePicker';

const SNAP: any = {
  playlistId: 'PLuitest1234567890',
  title: 'UI Test Course',
  reportedCount: 3,
  entries: [
    { position: 1, videoId: 'v1', title: 'Intro', durationSec: 60 },
    { position: 2, videoId: 'v2', title: 'Middle', durationSec: 120 },
    { position: 3, videoId: 'v3', title: 'Finale', durationSec: 180 },
  ],
  source: 'api',
  fetchedAt: new Date().toISOString(),
  snapshotVersion: 1,
};

async function seedPlaylist() {
  const db = await openDB('learnquest-db', 2, {
    upgrade(d) {
      if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv');
    },
  });
  await db.put('kv', { [SNAP.playlistId]: SNAP }, 'playlists');
  await db.put('kv', { [SNAP.playlistId]: { archived: false, addedAt: new Date().toISOString() } }, 'meta');
  await db.put('kv', SNAP.playlistId, 'activeId');
  await db.put('kv', {}, 'progress');
}

beforeEach(async () => {
  window.location.hash = '';
  const db = await openDB('learnquest-db', 2, {
    upgrade(d) {
      if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv');
    },
  });
  await db.clear('kv');
});

async function openPages() {
  fireEvent.click(await screen.findByRole('button', { name: 'Open navigation' }));
  fireEvent.click(screen.getByRole('button', { name: 'All pages' }));
  return screen.getByRole('region', { name: 'All pages' });
}

describe('workspace navigation', () => {
  it('renders all 15 grouped destinations with active state on demand', async () => {
    render(
      <StoreProvider>
        <App />
      </StoreProvider>,
    );
    const nav = await openPages();
    const labels = ['Dashboard', 'Library', 'Player', 'Goals', 'Checkpoints', 'Focus', 'Analytics', 'Efficiency', 'History', 'Revision', 'Modules', 'Arena', 'Reports', 'Settings', 'Account'];
    for (const l of labels) {
      expect(within(nav).getByRole('link', { name: l })).toBeTruthy();
    }
    for (const group of ['Learn', 'Insights', 'Manage']) expect(within(nav).getByRole('heading', { name: group })).toBeTruthy();
    // no horizontal-scroll nav container remains
    expect(document.querySelector('nav.overflow-x-auto')).toBeNull();
    // Dashboard is the active page
    expect(within(nav).getByRole('link', { name: 'Dashboard' }).getAttribute('aria-current')).toBe('page');
  });

  it('clicking Player updates the hash; back-navigation restores Dashboard', async () => {
    render(
      <StoreProvider>
        <App />
      </StoreProvider>,
    );
    const nav = await openPages();
    fireEvent.click(within(nav).getByRole('link', { name: 'Player' }));
    await waitFor(() => expect(window.location.hash).toBe('#/player'));
    expect(await screen.findByText(/No active playlist|Now playing/)).toBeTruthy();
    window.location.hash = '#/dash';
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Dashboard' })).toBeInTheDocument());
    const reopened = await openPages();
    expect(within(reopened).getByRole('link', { name: 'Dashboard' })).toHaveAttribute('aria-current', 'page');
  });

  it('shows section destinations immediately and Escape backs out of search before restoring focus', async () => {
    render(
      <StoreProvider>
        <App />
      </StoreProvider>,
    );
    const dock = await screen.findByRole('button', { name: 'Open navigation' });
    fireEvent.click(dock);
    const panel = screen.getByRole('navigation', { name: 'Workspace navigation' });
    expect(dock).toHaveAttribute('aria-expanded', 'true');
    expect(panel).not.toHaveAttribute('aria-modal');
    expect(document.body.style.overflow).not.toBe('hidden');
    fireEvent.click(within(panel).getByRole('button', { name: 'Insights', exact: true }));
    expect(within(panel).getByRole('link', { name: 'Analytics' })).toBeTruthy();
    fireEvent.click(within(panel).getByRole('button', { name: 'All pages' }));
    fireEvent.keyDown(panel, { key: 'Escape' });
    expect(within(panel).getByRole('button', { name: 'Insights', exact: true })).toHaveFocus();
    fireEvent.keyDown(panel, { key: 'Escape' });
    expect(screen.queryByRole('navigation', { name: 'Workspace navigation' })).toBeNull();
    expect(dock).toHaveFocus();
  });
});

describe('timezone picker', () => {
  it('searches, shows live computed offsets, and selects via keyboard', async () => {
    let picked = '';
    render(<TimezonePicker value="UTC" onChange={(tz) => (picked = tz)} />);
    // Stable accessible name (independent of the currently selected zone).
    const trigger = screen.getByRole('button', { name: 'Display timezone' });
    expect(trigger.textContent).toMatch(/UTC/i);
    fireEvent.click(trigger);
    const search = await screen.findByLabelText('Search timezones');
    fireEvent.change(search, { target: { value: 'kolkata' } });
    const option = await screen.findByRole('option', { name: /Kolkata/ });
    // live-computed offset shown, e.g. UTC+05:30 — proves Intl math, not hardcode
    expect(option.textContent).toMatch(/UTC\+05:30/);
    fireEvent.click(option);
    expect(picked).toBe('Asia/Kolkata');
  });

  it('Escape closes without selecting', async () => {
    let picked = 'UNCHANGED';
    render(<TimezonePicker value="UTC" onChange={(tz) => (picked = tz)} />);
    fireEvent.click(screen.getByRole('button', { name: 'Display timezone' }));
    await screen.findByLabelText('Search timezones');
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByLabelText('Search timezones')).toBeNull());
    expect(picked).toBe('UNCHANGED');
  });
});

describe('library range controls (seeded playlist N=3)', () => {
  it('totals the default range, recalculates on input, and rejects out-of-range ends', async () => {
    await seedPlaylist();
    render(
      <StoreProvider>
        <Library />
      </StoreProvider>,
    );
    // default 1–3 = 360s
    expect(await screen.findByText('0:06:00')).toBeTruthy();
    const start = screen.getByLabelText(/Start \(1–3\)/);
    fireEvent.change(start, { target: { value: '2' } });
    // 2–3 = 300s
    expect(await screen.findByText('0:05:00')).toBeTruthy();
    const end = screen.getByLabelText(/End \(2–3\)/);
    fireEvent.change(end, { target: { value: '99' } });
    expect(await screen.findByText(/exceeds playlist length/)).toBeTruthy();
  });

  it('longest-first actually reorders rows by descending duration', async () => {
    await seedPlaylist();
    render(
      <StoreProvider>
        <Library />
      </StoreProvider>,
    );
    await screen.findByText('0:06:00');
    // default playlist order: Intro first
    const rows = () => screen.getAllByRole('row').slice(1); // skip header
    expect(rows()[0].textContent).toMatch(/Intro/);
    // open the Sort dropdown and pick Longest first
    fireEvent.click(screen.getByRole('button', { name: 'Sort' }));
    fireEvent.click(await screen.findByRole('option', { name: 'Longest first' }));
    await waitFor(() => expect(rows()[0].textContent).toMatch(/Finale/));
    expect(rows()[1].textContent).toMatch(/Middle/);
    expect(rows()[2].textContent).toMatch(/Intro/);
    // shortest-first reverses it
    fireEvent.click(screen.getByRole('button', { name: 'Sort' }));
    fireEvent.click(await screen.findByRole('option', { name: 'Shortest first' }));
    await waitFor(() => expect(rows()[0].textContent).toMatch(/Intro/));
  });
});
