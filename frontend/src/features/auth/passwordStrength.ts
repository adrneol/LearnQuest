export type PasswordStrengthLabel = 'Weak' | 'Fair' | 'Strong';

export interface PasswordStrength {
  label: PasswordStrengthLabel;
  percent: number;
  hint: string;
}

const COMMON_PATTERNS = [
  'password', 'passw0rd', 'qwerty', 'letmein', 'welcome', 'admin', 'login',
  'learnquest', 'abc123', '123456', 'iloveyou', 'monkey', 'dragon',
];

/**
 * Local-only password guidance. The password never leaves this module and is
 * never sent to a third-party strength service. This is advisory only: the
 * server's 12-128 character requirement remains the authority.
 */
export function assessPasswordStrength(password: string): PasswordStrength | null {
  if (!password) return null;

  let points = 0;
  if (password.length >= 12) points += 1;
  if (password.length >= 16) points += 1;

  const classes = [
    /[a-z]/.test(password),
    /[A-Z]/.test(password),
    /[0-9]/.test(password),
    /[^A-Za-z0-9]/.test(password),
  ].filter(Boolean).length;
  if (classes >= 2) points += 1;
  if (classes >= 3) points += 1;
  if (new Set(password).size >= 6) points += 1;

  const compact = password.toLowerCase().replace(/[^a-z0-9]/g, '');
  const common = COMMON_PATTERNS.some((pattern) => compact.includes(pattern));
  if (common) points -= 2;
  if (/(.)\1{2,}/.test(password)) points -= 1;
  if (/^[a-z]+$/.test(password) || /^[A-Z]+$/.test(password) || /^[0-9]+$/.test(password)) points -= 1;

  if (points <= 2) {
    return {
      label: 'Weak',
      percent: 25,
      hint: common
        ? 'Avoid common words or sequences. Use a longer, unique passphrase.'
        : 'Use at least 12 characters and mix letters, numbers, and a symbol.',
    };
  }
  if (points <= 4) {
    return {
      label: 'Fair',
      percent: 60,
      hint: 'A longer passphrase with more variety would be stronger.',
    };
  }
  return {
    label: 'Strong',
    percent: 100,
    hint: 'Strong password. Keep it unique to LearnQuest.',
  };
}
