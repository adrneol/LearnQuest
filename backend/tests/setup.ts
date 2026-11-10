import { vi } from 'vitest';

// Tests supply their own configuration. Importing the application in a
// worker must never read a developer's backend/.env file.
vi.mock('dotenv/config', () => ({}));
