import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AuthScreens, OnboardingScreen } from '../src/features/auth/AuthScreens.js';
import { assessPasswordStrength } from '../src/features/auth/passwordStrength.js';
import type { AuthConfig, AuthUser } from '../src/services/api/authApi.js';

const CONFIG: AuthConfig = {
  nodeEnv: 'production',
  authEnabled: true,
  setupRequired: false,
  configured: {
    mongodb: true, google: true, brevo: true, session: true, emailLinks: true, youtube: false,
  },
  missing: [],
  cookieSecure: true,
  appOrigin: 'https://learn-quest-one.vercel.app',
};

const USER: AuthUser = {
  userId: 'user-onboarding',
  email: 'private.google.address@example.test',
  username: null,
  displayName: 'Google Name',
  onboardingComplete: false,
  timezone: 'UTC',
  sessionLenMin: 25,
  breakMin: 5,
  minViableMin: 10,
  createdAt: '2026-10-01T00:00:00.000Z',
  hasPassword: false,
  googleLinked: true,
};

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

function json(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
    json: async () => body,
  } as Response;
}

function renderOnboarding(onSubmit = vi.fn(async () => undefined)) {
  render(<OnboardingScreen user={USER} onSubmit={onSubmit} onSignOut={() => undefined} />);
  return {
    onSubmit,
    username: screen.getByLabelText('Username'),
    displayName: screen.getByLabelText('Display name'),
    password: screen.getByLabelText('Password'),
    confirm: screen.getByLabelText('Confirm password'),
    submit: screen.getByRole('button', { name: 'Complete setup' }),
  };
}

describe('onboarding form validation and feedback', () => {
  it('uses placeholders instead of sample values and explains why submit is disabled', () => {
    const { username, displayName, submit } = renderOnboarding();
    expect(username).toHaveValue('');
    expect(username).toHaveAttribute('placeholder');
    // The display name is intentionally prefilled only from the verified
    // Google profile, which is valid server-side account state.
    expect(displayName).toHaveValue('Google Name');
    expect(displayName).toHaveAttribute('placeholder');
    expect(submit).toBeDisabled();
    expect(screen.getByText('Choose a username to continue.')).toBeInTheDocument();
    expect(screen.getByText('Google account connected')).toBeInTheDocument();
    expect(document.body.textContent).not.toContain(USER.email);
  });

  it('enables submit only for a valid username, display name, password, and matching confirmation', () => {
    const { username, displayName, password, confirm, submit } = renderOnboarding();

    fireEvent.change(username, { target: { value: 'ab' } });
    expect(submit).toBeDisabled();
    expect(screen.getByText(/Username must be 3–32 characters/)).toBeInTheDocument();

    fireEvent.change(username, { target: { value: 'learner_1' } });
    fireEvent.change(displayName, { target: { value: '' } });
    expect(submit).toBeDisabled();
    expect(screen.getByText('Enter a display name to continue.')).toBeInTheDocument();

    fireEvent.change(displayName, { target: { value: 'Learner One' } });
    fireEvent.change(password, { target: { value: 'short' } });
    expect(submit).toBeDisabled();
    expect(screen.getByText(/currently 5/)).toBeInTheDocument();

    fireEvent.change(password, { target: { value: 'correct horse battery staple' } });
    expect(submit).toBeDisabled();
    expect(screen.getByText('Re-enter your password to confirm it.')).toBeInTheDocument();
    expect(screen.queryByText('Passwords match.')).toBeNull();

    fireEvent.change(confirm, { target: { value: 'correct horse battery staplX' } });
    expect(submit).toBeDisabled();
    expect(screen.getByText('Passwords do not match.')).toBeInTheDocument();

    fireEvent.change(confirm, { target: { value: 'correct horse battery staple' } });
    expect(screen.getByText('Passwords match.')).toBeInTheDocument();
    expect(submit).toBeEnabled();
  });

  it('enforces the maximum password length in the form before submission', () => {
    const { username, displayName, password, confirm, submit } = renderOnboarding();
    fireEvent.change(username, { target: { value: 'learner_1' } });
    fireEvent.change(displayName, { target: { value: 'Learner One' } });
    fireEvent.change(password, { target: { value: `A1!${'x'.repeat(126)}` } });
    expect(submit).toBeDisabled();
    expect(screen.getByText('Password must be at most 128 characters.')).toBeInTheDocument();

    const exactMaximum = `A1!${'x'.repeat(125)}`;
    expect(exactMaximum).toHaveLength(128);
    fireEvent.change(password, { target: { value: exactMaximum } });
    fireEvent.change(confirm, { target: { value: exactMaximum } });
    expect(screen.getByText('Passwords match.')).toBeInTheDocument();
    expect(submit).toBeEnabled();
  });

  it('shows a local-only strength indicator after typing and never sends the password to a service', () => {
    globalThis.fetch = vi.fn() as any;
    const { password } = renderOnboarding();
    expect(screen.queryByText(/Password strength:/)).toBeNull();

    fireEvent.change(password, { target: { value: 'aaaaaaaaaaaa' } });
    expect(screen.getByText(/Password strength:/)).toBeInTheDocument();
    expect(screen.getByText('Weak')).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Password strength' })).toHaveAttribute('aria-valuetext', 'Weak');

    fireEvent.change(password, { target: { value: 'correct horse battery staple' } });
    expect(screen.getByText('Fair')).toBeInTheDocument();

    fireEvent.change(password, { target: { value: 'Tr0ub4dor&3-LongerPass!' } });
    expect(screen.getByText('Strong')).toBeInTheDocument();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('submits once with the trimmed values and reports a server rejection without losing input', async () => {
    let resolve!: () => void;
    const pending = new Promise<void>((r) => { resolve = r; });
    const onSubmit = vi.fn(() => pending);
    const { username, displayName, password, confirm, submit } = renderOnboarding(onSubmit);

    fireEvent.change(username, { target: { value: '  learner_1  ' } });
    fireEvent.change(displayName, { target: { value: '  Learner One  ' } });
    fireEvent.change(password, { target: { value: 'correct horse battery staple' } });
    fireEvent.change(confirm, { target: { value: 'correct horse battery staple' } });
    fireEvent.click(submit);

    await waitFor(() => expect(submit).toBeDisabled());
    fireEvent.click(submit);
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      username: 'learner_1',
      displayName: 'Learner One',
      password: 'correct horse battery staple',
    }));
    resolve();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Complete setup' })).toBeEnabled());
  });

  it('keeps the inputs and shows the server error when onboarding is rejected', async () => {
    const onSubmit = vi.fn(async () => {
      throw new Error('That username is already taken. Choose another.');
    });
    const { username, displayName, password, confirm, submit } = renderOnboarding(onSubmit);
    fireEvent.change(username, { target: { value: 'learner_1' } });
    fireEvent.change(displayName, { target: { value: 'Learner One' } });
    fireEvent.change(password, { target: { value: 'correct horse battery staple' } });
    fireEvent.change(confirm, { target: { value: 'correct horse battery staple' } });
    fireEvent.click(submit);

    expect(await screen.findByRole('alert')).toHaveTextContent('That username is already taken.');
    expect(username).toHaveValue('learner_1');
    expect(displayName).toHaveValue('Learner One');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Complete setup' })).toBeEnabled());
  });
});

describe('password strength calculation', () => {
  it('is hidden for empty input and distinguishes weak, fair, and strong values', () => {
    expect(assessPasswordStrength('')).toBeNull();
    expect(assessPasswordStrength('aaaaaaaaaaaa')?.label).toBe('Weak');
    expect(assessPasswordStrength('correct horse battery staple')?.label).toBe('Fair');
    expect(assessPasswordStrength('Tr0ub4dor&3-LongerPass!')?.label).toBe('Strong');
  });

  it('does not call a third-party service', () => {
    globalThis.fetch = vi.fn() as any;
    assessPasswordStrength('Tr0ub4dor&3-LongerPass!');
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});

describe('public authentication copy and recovery behavior', () => {
  it('keeps the sign-in essentials without technical implementation claims', () => {
    const { container } = render(
      <AuthScreens setup={CONFIG} authError={null} onPasswordLogin={vi.fn(async () => undefined)} onGoogle={vi.fn(async () => undefined)} />,
    );
    expect(screen.getByRole('button', { name: 'Sign in with Google' })).toBeInTheDocument();
    expect(screen.getByLabelText('Username or email')).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Forgot password?' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create an account' })).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/brevo|argon2|immutable|server-side|numeric code|verification code|session token/i);
  });

  it('accepts an arbitrary address and shows only the generic recovery response', async () => {
    const calls: any[] = [];
    globalThis.fetch = (async (url: any, init: any) => {
      calls.push({ url: String(url), body: JSON.parse(init.body) });
      return json({ ok: true, message: "If an eligible account matches that username or email, you'll receive a password-reset link." }, 202);
    }) as any;
    render(
      <AuthScreens setup={CONFIG} authError={null} onPasswordLogin={vi.fn(async () => undefined)} onGoogle={vi.fn(async () => undefined)} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Forgot password?' }));
    fireEvent.change(screen.getByLabelText('Username or email'), { target: { value: 'nobody@example.test' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send password reset link' }));

    expect(await screen.findByRole('heading', { name: 'Check your email' })).toBeInTheDocument();
    expect(screen.getByText(/If an eligible account matches/)).toBeInTheDocument();
    expect(screen.queryByText(/no account|does not exist|not found/i)).toBeNull();
    expect(screen.queryByText(/token=/)).toBeNull();
    expect(calls).toHaveLength(1);
    expect(calls[0].body).toEqual({ identifier: 'nobody@example.test' });
  });

  it('does not mention the email provider when recovery is unavailable', () => {
    const config: AuthConfig = {
      ...CONFIG,
      configured: { ...CONFIG.configured, brevo: false, emailLinks: true },
    };
    render(
      <AuthScreens setup={config} authError={null} onPasswordLogin={vi.fn(async () => undefined)} onGoogle={vi.fn(async () => undefined)} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Forgot password?' }));
    expect(screen.getByText('Password recovery is temporarily unavailable.')).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/brevo/i);
  });
});
