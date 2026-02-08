/**
 * Vitest global setup — stubs browser APIs not available in happy-dom.
 */
import { vi } from "vitest";

// In-memory storage for chrome.storage.local
const storage: Record<string, unknown> = {};

globalThis.chrome = {
  runtime: {
    onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
    sendMessage: vi.fn().mockResolvedValue(undefined),
  },
  storage: {
    local: {
      get: vi.fn(async (keys: string | string[]) => {
        const result: Record<string, unknown> = {};
        const keyList = Array.isArray(keys)
          ? keys
          : typeof keys === "string"
            ? [keys]
            : Object.keys(keys);
        for (const key of keyList) {
          if (key in storage) result[key] = storage[key];
        }
        return result;
      }),
      set: vi.fn(async (items: Record<string, unknown>) => {
        Object.assign(storage, items);
      }),
      remove: vi.fn(async (keys: string | string[]) => {
        const keyList = Array.isArray(keys) ? keys : [keys];
        for (const key of keyList) delete storage[key];
      }),
    },
  },
  tabs: {
    query: vi.fn().mockResolvedValue([]),
    sendMessage: vi.fn().mockResolvedValue(undefined),
  },
} as unknown as typeof chrome;
