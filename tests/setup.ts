import "fake-indexeddb/auto";

// Chrome extension API mock
const chromeStorageData: Record<string, string> = {};

const chromeMock = {
  runtime: {
    sendMessage: vi.fn().mockResolvedValue(undefined),
    onMessage: {
      addListener: vi.fn(),
      removeListener: vi.fn(),
    },
  },
  storage: {
    local: {
      get: vi.fn((keys: string | string[]) => {
        const result: Record<string, string> = {};
        const keyArr = typeof keys === "string" ? [keys] : keys;
        for (const k of keyArr) {
          if (chromeStorageData[k] !== undefined) {
            result[k] = chromeStorageData[k];
          }
        }
        return Promise.resolve(result);
      }),
      set: vi.fn((items: Record<string, string>) => {
        Object.assign(chromeStorageData, items);
        return Promise.resolve();
      }),
    },
  },
  tabs: {
    query: vi.fn().mockResolvedValue([]),
    sendMessage: vi.fn().mockResolvedValue(undefined),
  },
  sidePanel: {
    open: vi.fn().mockResolvedValue(undefined),
  },
  action: {
    onClicked: {
      addListener: vi.fn(),
    },
  },
};

Object.defineProperty(globalThis, "chrome", {
  value: chromeMock,
  writable: true,
});

// Export for direct manipulation in tests
export { chromeStorageData };

// DOM mocks for export tests
if (typeof URL.createObjectURL === "undefined") {
  URL.createObjectURL = vi.fn(() => "blob:mock-url");
}
if (typeof URL.revokeObjectURL === "undefined") {
  URL.revokeObjectURL = vi.fn();
}
