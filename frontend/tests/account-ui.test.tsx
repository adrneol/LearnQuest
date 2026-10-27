import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AccountMenu, type AccountSection } from '../src/features/account/AccountMenu.js';
import { Account } from '../src/features/account/Account.js';

const { storeRef } = vi.hoisted(() => ({ storeRef: { current: null as any } }));
vi.mock('../src/app/store.js', () => ({ useStore: () => storeRef.current }));

const USER = {
  userId: 'user_123',
  email: 'learner@example.test',
  username: 'learner',
  displayName: 'Learner One',
  createdAt: '2026-10-01T00:00:00.000Z',
  googleLinked: true,
  hasPassword: true,
};

function makeStore() {
  return {
    authUser: { ...USER },
    syncStatus: 'saved',
    prefs: { timezone: 'UTC', sessionLenMin: 25, breakMin: 5, minViableMin: 10 },
    updateProfile: vi.fn(async (input: any) => ({ ...USER, ...input })),
    updateAccountPreferences: vi.fn(async () => ({ ...USER })),
    exportAccountData: vi.fn(async () => undefined),
    deleteAccount: vi.fn(async () => undefined),
    listAccountSessions: vi.fn(async () => [
      {
        sessionId: 's-current', current: true, userAgent: 'Test Browser',
        lastSeenAt: '2026-10-27T10:00:00.000Z', expiresAt: '2026-11-26T10:00:00.000Z',
      },
      {
        sessionId: 's-other', current: false, userAgent: 'Other Browser',
        lastSeenAt: '2026-10-26T10:00:00.000Z', expiresAt: '2026-11-25T10:00:00.000Z',
      },
    ]),
    revokeAccountSession: vi.fn(async () => undefined),
    changeAccountPassword: vi.fn(async () => undefined),
    requestEmailChange: vi.fn(async (email: string) => ({
      ok: true, email, expiresInMin: 30, message: `A verification link was sent to ${email}.`,
    })),
    signOut: vi.fn(async () => undefined),
  };
}

beforeEach(() => {
  storeRef.current = makeStore();
});

describe('account menu in the main header', () => {
  it('opens a labelled menu and navigates to profile, settings, and security', () => {
    const onNavigate = vi.fn<(section: AccountSection) => void>();
    render(<AccountMenu onNavigate={onNavigate} />);
    const trigger = screen.getByRole('button', { name: /Account menu for Learner One/ });
    expect(trigger).toHaveAttribute('aria-haspopup', 'menu');
    fireEvent.click(trigger);
    expect(screen.getByRole('menu', { name: 'Account' })).toBeInTheDocument();
    expect(screen.getByText('learner@example.test')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('menuitem', { name: /Profile/ }));
    expect(onNavigate).toHaveBeenCalledWith('profile');

    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('menuitem', { name: /Security and active sessions/ }));
    expect(onNavigate).toHaveBeenCalledWith('security');

    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('menuitem', { name: /Account settings/ }));
    expect(onNavigate).toHaveBeenCalledWith('settings');
  });

  it('closes on Escape, restores focus, and exposes export/sign-out actions', async () => {
    render(<AccountMenu onNavigate={() => undefined} />);
    const trigger = screen.getByRole('button', { name: /Account menu/ });
    fireEvent.click(trigger);
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();

    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('menuitem', { name: /Export account data/ }));
    await waitFor(() => expect(storeRef.current.exportAccountData).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();

    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('menuitem', { name: /^Sign out$/ }));
    await waitFor(() => expect(storeRef.current.signOut).toHaveBeenCalledTimes(1));
  });
});

describe('account screen', () => {
  it('saves the editable profile without making the verified email editable', async () => {
    render(<Account section="profile" onSection={() => undefined} />);
    const email = screen.getByDisplayValue('learner@example.test');
    expect(email).toHaveAttribute('readonly');
    fireEvent.change(screen.getByDisplayValue('Learner One'), { target: { value: 'New Name' } });
    fireEvent.change(screen.getByDisplayValue('learner'), { target: { value: 'new_learner' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save profile' }));
    await waitFor(() => expect(storeRef.current.updateProfile).toHaveBeenCalledWith({
      username: 'new_learner', displayName: 'New Name',
    }));
    expect(await screen.findByRole('status')).toHaveTextContent('Profile saved');
  });

  it('uses valid ARIA tab targets and supports arrow-key section navigation', () => {
    const onSection = vi.fn();
    render(<Account section="profile" onSection={onSection} />);

    const profile = screen.getByRole('tab', { name: /Profile/ });
    const settings = screen.getByRole('tab', { name: /Account settings/ });
    expect(profile).toHaveAttribute('aria-selected', 'true');
    expect(profile).toHaveAttribute('aria-controls', 'account-panel-profile');
    expect(profile).toHaveAttribute('tabindex', '0');
    expect(settings).toHaveAttribute('aria-selected', 'false');
    expect(settings).not.toHaveAttribute('aria-controls');
    expect(settings).toHaveAttribute('tabindex', '-1');
    expect(screen.getByRole('tabpanel')).toHaveAttribute('id', 'account-panel-profile');

    fireEvent.keyDown(profile, { key: 'ArrowRight' });
    expect(onSection).toHaveBeenCalledWith('settings');
  });

  it('switches sections and saves account-scoped learning preferences', async () => {
    const onSection = vi.fn();
    render(<Account section="settings" onSection={onSection} />);
    fireEvent.click(screen.getByRole('tab', { name: /Security & sessions/ }));
    expect(onSection).toHaveBeenCalledWith('security');

    fireEvent.click(screen.getByRole('button', { name: 'Save preferences' }));
    await waitFor(() => expect(storeRef.current.updateAccountPreferences).toHaveBeenCalled());
    expect(storeRef.current.updateAccountPreferences.mock.calls[0][0]).toMatchObject({ timezone: 'UTC' });
  });

  it('lists sessions and only offers sign-out for other devices', async () => {
    render(<Account section="security" onSection={() => undefined} />);
    expect(await screen.findByText('This device')).toBeInTheDocument();
    expect(screen.getByText('Other Browser')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Sign out all devices/ })).toBeInTheDocument();
    const signOutButtons = screen.getAllByRole('button', { name: 'Sign out' });
    expect(signOutButtons).toHaveLength(1);
    fireEvent.click(signOutButtons[0]);
    await waitFor(() => expect(storeRef.current.revokeAccountSession).toHaveBeenCalledWith('s-other'));
  });

  it('portals the account-deletion dialog to a viewport-centered overlay', () => {
    const { container } = render(<Account section="settings" onSection={() => undefined} />);
    fireEvent.click(screen.getByRole('button', { name: /^Delete my account$/ }));
    const dialog = screen.getByRole('alertdialog', { name: /Permanently delete this account/ });

    expect(container.contains(dialog)).toBe(false);
    expect(document.body.contains(dialog)).toBe(true);
    const overlay = dialog.parentElement!;
    expect(overlay.className).toContain('fixed');
    expect(overlay.className).toContain('inset-0');
    expect(overlay.className).toContain('place-items-center');
    expect(dialog.className).toContain('max-h-[calc(100dvh-1.5rem)]');
  });

  it('opens a deliberate dialog and requires both the current password and the exact phrase', async () => {
    render(<Account section="settings" onSection={() => undefined} />);
    const openButton = screen.getByRole('button', { name: /^Delete my account$/ });
    expect(openButton).toBeInTheDocument();
    expect(storeRef.current.deleteAccount).not.toHaveBeenCalled();

    fireEvent.click(openButton);
    const dialog = screen.getByRole('alertdialog', { name: /Permanently delete this account/ });
    expect(dialog).toHaveTextContent(/cannot be undone/i);
    expect(dialog).toHaveTextContent(/playlists, progress, notes/i);
    const permanent = screen.getByRole('button', { name: /Delete permanently/ });
    expect(permanent).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Current password'), { target: { value: 'correct horse battery staple' } });
    fireEvent.change(screen.getByLabelText(/Type DELETE MY ACCOUNT to confirm/), { target: { value: 'delete my account' } });
    expect(permanent).toBeDisabled();
    expect(screen.getByText(/The phrase is not exact/)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/Type DELETE MY ACCOUNT to confirm/), { target: { value: '  DELETE MY ACCOUNT  ' } });
    expect(permanent).toBeEnabled();
    fireEvent.click(permanent);
    await waitFor(() => expect(storeRef.current.deleteAccount).toHaveBeenCalledWith(
      'DELETE MY ACCOUNT',
      'correct horse battery staple',
    ));
  });

  it('submits the deletion request only once while the first request is pending', async () => {
    let resolveDelete!: () => void;
    storeRef.current.deleteAccount = vi.fn(() => new Promise<void>((resolve) => {
      resolveDelete = resolve;
    }));
    render(<Account section="settings" onSection={() => undefined} />);
    fireEvent.click(screen.getByRole('button', { name: /^Delete my account$/ }));
    fireEvent.change(screen.getByLabelText('Current password'), { target: { value: 'correct horse battery staple' } });
    fireEvent.change(screen.getByLabelText(/Type DELETE MY ACCOUNT to confirm/), { target: { value: 'DELETE MY ACCOUNT' } });
    fireEvent.click(screen.getByRole('button', { name: /Delete permanently/ }));

    const pending = await screen.findByRole('button', { name: /Deleting/ });
    expect(pending).toBeDisabled();
    const form = pending.closest('form');
    expect(form).not.toBeNull();
    fireEvent.submit(form!);
    fireEvent.submit(form!);
    fireEvent.click(pending);

    expect(storeRef.current.deleteAccount).toHaveBeenCalledTimes(1);
    resolveDelete();
    await Promise.resolve();
  });

  it('cancels without deleting and requires fresh Google authentication when no password exists', () => {
    storeRef.current.authUser.hasPassword = false;
    render(<Account section="settings" onSection={() => undefined} />);
    fireEvent.click(screen.getByRole('button', { name: /^Delete my account$/ }));
    expect(screen.getByRole('button', { name: /Reauthenticate with Google/ })).toBeInTheDocument();
    expect(screen.queryByLabelText('Current password')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(storeRef.current.deleteAccount).not.toHaveBeenCalled();
  });
});
