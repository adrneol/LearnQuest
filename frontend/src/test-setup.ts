import '@testing-library/jest-dom/vitest';
import 'fake-indexeddb/auto';
import { cleanup, configure } from '@testing-library/react';
import { afterEach } from 'vitest';

// The suite runs integration-style screens against fake IndexedDB. On a busy
// machine the default 1s findBy/waitFor window can expire before a store load
// and its follow-up effects settle, even though the test timeout is 10s.
configure({ asyncUtilTimeout: 5_000 });

afterEach(() => {
  cleanup();
});

// jsdom lacks ResizeObserver (used by Recharts ResponsiveContainer).
// Charts render empty in tests; all non-chart UI is fully exercised.
if (typeof (globalThis as any).ResizeObserver === 'undefined') {
  (globalThis as any).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

// jsdom logs "Not implemented: window.scrollTo" for app navigation. Scrolling
// is not asserted in the suite; tests that care install their own spy.
if (typeof window !== 'undefined') {
  Object.defineProperty(window, 'scrollTo', { value: () => undefined, writable: true });
}
