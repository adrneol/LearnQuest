import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Dropdown } from '../src/components/ui/Dropdown';
import { DurationBars } from '../src/components/charts/DurationBars';
import { CumulativeLine } from '../src/components/charts/CumulativeLine';
import { CumulativeChart } from '../src/components/charts/CumulativeChart';
import { tickInterval, type RangePoint } from '../src/components/charts/theme';

const OPTS = [
  { value: '10', label: '10 min' },
  { value: '25', label: '25 min' },
  { value: '60', label: '60 min' },
];

describe('dropdown (custom listbox)', () => {
  it('opens, selects with mouse, and reports the value', () => {
    let v = '25';
    const { rerender } = render(<Dropdown label="Session length" value={v} options={OPTS} onChange={(x) => { v = x; }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Session length' }));
    fireEvent.click(screen.getByRole('option', { name: /60 min/ }));
    expect(v).toBe('60');
    rerender(<Dropdown label="Session length" value={v} options={OPTS} onChange={(x) => { v = x; }} />);
    expect(screen.getByRole('button', { name: 'Session length' }).textContent).toMatch(/60 min/);
  });

  it('keyboard: arrows move, Enter selects, Escape cancels', () => {
    let v = '10';
    render(<Dropdown label="Session length" value={v} options={OPTS} onChange={(x) => { v = x; }} />);
    const btn = screen.getByRole('button', { name: 'Session length' });
    fireEvent.keyDown(btn, { key: 'ArrowDown' });
    expect(screen.getByRole('listbox')).toBeTruthy();
    fireEvent.keyDown(screen.getByRole('option', { name: /10 min/ }), { key: 'ArrowDown' });
    fireEvent.keyDown(screen.getByRole('option', { name: /25 min/ }), { key: 'Enter' });
    expect(v).toBe('25');
  });

  it('Escape closes without changing the value', () => {
    let v = '10';
    render(<Dropdown label="Session length" value={v} options={OPTS} onChange={(x) => { v = x; }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Session length' }));
    expect(screen.getByRole('listbox')).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(v).toBe('10');
  });

  it('popup renders through a portal at body level (never clipped by cards)', () => {
    render(
      <div style={{ overflow: 'hidden', height: 10 }}>
        <Dropdown label="Session length" value="10" options={OPTS} onChange={() => {}} />
      </div>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Session length' }));
    const box = screen.getByRole('listbox');
    expect(box.parentElement?.parentElement?.tagName).toBe('BODY');
  });
});

describe('chart tick thinning (presentation only — data untouched)', () => {
  it('short ranges label every position; long ranges thin predictably', () => {
    expect(tickInterval(1)).toBe(0);
    expect(tickInterval(12)).toBe(0);
    expect(tickInterval(13)).toBe(1);
    expect(tickInterval(84)).toBe(6); // every 7th label
    expect(tickInterval(139)).toBe(11); // every 12th label
    expect(tickInterval(500)).toBe(41);
  });
});

function point(pos: number, sec: number | null): RangePoint {
  return {
    pos, title: `Video ${pos}`, min: sec === null ? 0 : sec / 60,
    cumMin: 0, durationSec: sec, cumSec: sec ?? 0,
    done: false, unresolved: sec === null,
  };
}

describe('chart empty states and captions', () => {
  it('bar-only and line-only views explain empty selections', () => {
    const { unmount } = render(<DurationBars data={[]} />);
    expect(screen.getByText(/Pick a valid range to see every entry plotted/)).toBeTruthy();
    unmount();
    render(<CumulativeLine data={[]} />);
    expect(screen.getByText(/Pick a valid range to see the cumulative curve/)).toBeTruthy();
  });

  it('bar view carries only its own units; line view only its own', () => {
    const { unmount } = render(<DurationBars data={[point(1, 60), point(2, null), point(3, 120)]} />);
    expect(screen.getByText(/Individual video durations/)).toBeTruthy();
    expect(screen.queryByText(/Running total/)).toBeNull();
    unmount();
    render(<CumulativeLine data={[point(1, 60), point(2, null), point(3, 120)]} />);
    expect(screen.getByText(/Running total/)).toBeTruthy();
    expect(screen.queryByText(/Individual video durations/)).toBeNull();
  });

  it('cumulative chart discloses incomplete metadata instead of hiding it', () => {
    render(<CumulativeChart data={[{ pos: 1, hrs: 0.5, cumSec: 1800 }]} complete={false} />);
    expect(screen.getByText(/incomplete metadata/)).toBeTruthy();
  });
});
