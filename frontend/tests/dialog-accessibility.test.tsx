import { useState, useRef } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Modal } from '../src/components/ui/dialog.js';

function Harness({ busy = false }: { busy?: boolean }) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const firstActionRef = useRef<HTMLButtonElement>(null);
  const onClose = vi.fn(() => setOpen(false));
  return (
    <div>
      <button ref={triggerRef} type="button" onClick={() => setOpen(true)}>Open destructive dialog</button>
      {open && (
        <Modal
          title="Delete this item?"
          description="This action cannot be undone. Other items are not changed."
          onClose={onClose}
          busy={busy}
          initialFocusRef={firstActionRef}
          footer={(
            <>
              <button ref={firstActionRef} type="button" onClick={() => setOpen(false)}>Keep item</button>
              <button type="button" onClick={() => setOpen(false)}>Delete item</button>
            </>
          )}
        >
          <p>Dialog body content.</p>
        </Modal>
      )}
    </div>
  );
}

describe('shared portal dialog', () => {
  it('renders in document.body, locks scroll, traps focus, closes on Escape, and restores focus', async () => {
    const { container } = render(<Harness />);
    const trigger = screen.getByRole('button', { name: 'Open destructive dialog' });
    trigger.focus();
    fireEvent.click(trigger);

    const dialog = screen.getByRole('dialog', { name: 'Delete this item?' });
    expect(dialog).toHaveAccessibleDescription('This action cannot be undone. Other items are not changed.');
    expect(container.contains(dialog)).toBe(false);
    expect(document.body.contains(dialog)).toBe(true);
    expect(document.body.style.overflow).toBe('hidden');

    const keep = screen.getByRole('button', { name: 'Keep item' });
    const remove = screen.getByRole('button', { name: 'Delete item' });
    const close = screen.getByRole('button', { name: 'Close dialog' });
    await waitFor(() => expect(keep).toHaveFocus());

    remove.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(close).toHaveFocus();
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(remove).toHaveFocus();

    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(document.body.style.overflow).toBe('');
    expect(trigger).toHaveFocus();
  });

  it('closes on a backdrop click', async () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Open destructive dialog' }));
    const dialog = screen.getByRole('dialog', { name: 'Delete this item?' });
    fireEvent.mouseDown(dialog.parentElement!);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('does not close on Escape or backdrop while busy and disables the close button', () => {
    render(<Harness busy />);
    fireEvent.click(screen.getByRole('button', { name: 'Open destructive dialog' }));
    const dialog = screen.getByRole('dialog', { name: 'Delete this item?' });
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.mouseDown(dialog.parentElement!);
    expect(screen.getByRole('dialog', { name: 'Delete this item?' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Close dialog' })).toBeDisabled();
  });

  it('uses one accessible name even when the target title appears in the description', () => {
    render(
      <Modal
        title="Remove or delete this playlist?"
        description={<><b>Renamed P</b><span>PLmanagerP0000000000</span></>}
        onClose={() => undefined}
      >
        <p>Body</p>
      </Modal>,
    );
    const dialog = screen.getByRole('dialog', { name: 'Remove or delete this playlist?' });
    expect(dialog).toHaveTextContent('Renamed P');
    expect(screen.queryByRole('dialog', { name: /Renamed P/ })).toBeNull();
  });
});
