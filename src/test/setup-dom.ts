// Setup for the `dom` vitest project (jsdom + @testing-library/react).
// - Extends expect() with jest-dom matchers (toBeInTheDocument, toBeDisabled, …).
// - Unmounts rendered trees after each test so DOM/listeners don't leak across
//   tests sharing the same jsdom document.
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach } from 'vitest';

import { i18n } from '@/i18n';

// jsdom lacks ResizeObserver, which several components (CollapsibleContent,
// MessageList, editors) construct in effects. Provide a no-op stub so rendering
// them under jsdom doesn't throw. Tests that assert on observed sizes mock it
// per-test; this default just keeps construction from crashing.
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class {
    observe(): void { /* no-op */ }
    unobserve(): void { /* no-op */ }
    disconnect(): void { /* no-op */ }
  } as unknown as typeof ResizeObserver;
}

beforeEach(async () => {
  await i18n.changeLanguage('zh-CN');
});

afterEach(() => {
  cleanup();
});
