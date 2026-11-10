import { createRef } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { Btn } from '../src/components/ui/ui.js';

it('A11Y-1: a shared icon button exposes its name, native attributes, and ref', () => {
  const ref = createRef<HTMLButtonElement>();
  const onClick = vi.fn();
  render(<Btn ref={ref} aria-label="Previous lesson" aria-controls="lesson" name="previous" onClick={onClick}>
    <svg aria-hidden="true" />
  </Btn>);
  const button = screen.getByRole('button', { name: 'Previous lesson' });
  expect(button).toHaveAttribute('aria-controls', 'lesson');
  expect(button).toHaveAttribute('name', 'previous');
  expect(button).toHaveAttribute('type', 'button');
  expect(ref.current).toBe(button);
  fireEvent.click(button);
  expect(onClick).toHaveBeenCalledTimes(1);
});
