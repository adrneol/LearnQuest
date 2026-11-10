import { useState } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { expect, it } from 'vitest';
import { DateField } from '../src/components/ui/DateField.js';

const labelFor = (key: string) => new Intl.DateTimeFormat(undefined, {
  dateStyle: 'full', timeZone: 'UTC',
}).format(new Date(key + 'T00:00:00Z'));

function Fixture({ initial = '', min, max }: { initial?: string; min?: string; max?: string }) {
  const [date, setDate] = useState(initial);
  return <DateField label="Revision date" today="2028-02-15" value={date} onChange={setDate} min={min} max={max} />;
}

it('clamps month navigation to leap day and writes the selected date key verbatim', () => {
  render(<Fixture initial="2028-01-31" />);
  fireEvent.click(screen.getByRole('button', { name: 'Choose revision date' }));
  const calendar = screen.getByRole('dialog', { name: 'Revision date calendar' });
  const january = within(calendar).getByRole('button', { name: labelFor('2028-01-31') });
  expect(january).toHaveFocus();
  fireEvent.keyDown(january, { key: 'PageDown' });
  const leapDay = within(calendar).getByRole('button', { name: labelFor('2028-02-29') });
  expect(leapDay).toHaveFocus();
  fireEvent.keyDown(leapDay, { key: 'ArrowRight' });
  const march = within(calendar).getByRole('button', { name: labelFor('2028-03-01') });
  expect(march).toHaveFocus();
  fireEvent.click(march);
  expect(screen.getByRole('textbox', { name: 'Revision date' })).toHaveValue('2028-03-01');
  expect(screen.getByRole('button', { name: 'Choose revision date' })).toHaveFocus();
});

it('keeps an empty value on dismissal and clears a selection within its bounds', () => {
  render(<Fixture min="2028-02-15" max="2028-02-20" />);
  const trigger = screen.getByRole('button', { name: 'Choose revision date' });
  const input = screen.getByRole('textbox', { name: 'Revision date' });
  fireEvent.click(trigger);
  expect(screen.getByRole('button', { name: labelFor('2028-02-14') })).toBeDisabled();
  expect(screen.getByRole('button', { name: labelFor('2028-02-15') })).toHaveAttribute('aria-current', 'date');
  fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
  expect(input).toHaveValue('');
  expect(trigger).toHaveFocus();
  fireEvent.click(trigger);
  fireEvent.click(screen.getByRole('button', { name: labelFor('2028-02-20') }));
  expect(input).toHaveValue('2028-02-20');
  fireEvent.click(trigger);
  fireEvent.click(screen.getByRole('button', { name: 'Clear date' }));
  expect(input).toHaveValue('');
});
