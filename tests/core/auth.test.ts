import { describe, it, expect, vi, afterEach } from "vitest";
import {
  getCSRFToken,
  getMyUserId,
  extractBearerToken,
  getHeaders,
  isAuthenticated,
  clearCachedToken,
} from "@/core/auth";

function setCookies(cookies: string) {
  Object.defineProperty(document, "cookie", {
    get: () => cookies,
    configurable: true,
  });
}

afterEach(() => {
  clearCachedToken();
  setCookies("");
  vi.restoreAllMocks();
});

describe("getCSRFToken", () => {
  it("extracts ct0 value from cookie string", () => {
    setCookies("guest_id=v1%3A123; ct0=abc123def; _twitter_sess=xyz");
    expect(getCSRFToken()).toBe("abc123def");
  });

  it("throws when ct0 cookie is missing", () => {
    setCookies("guest_id=v1%3A123; _twitter_sess=xyz");
    expect(() => getCSRFToken()).toThrow("CSRF token not found");
  });
});

describe("getMyUserId", () => {
  it("extracts user ID from twid cookie", () => {
    setCookies("twid=u%3D123456789; ct0=abc");
    expect(getMyUserId()).toBe("123456789");
  });

  it("throws when twid cookie is missing", () => {
    setCookies("ct0=abc; guest_id=123");
    expect(() => getMyUserId()).toThrow("User ID not found");
  });
});

describe("extractBearerToken", () => {
  function setupScripts(urls: string[]) {
    const mockScripts = urls.map((url) => ({
      getAttribute: (attr: string) => (attr === "src" ? url : null),
    }));
    vi.spyOn(document, "querySelectorAll").mockReturnValue(
      mockScripts as unknown as NodeListOf<Element>,
    );
  }

  it("finds token matching AAAA... regex in script bundle", async () => {
    setupScripts(["https://abs.twimg.com/client-web/main.abc.js"]);
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () =>
        Promise.resolve(
          'var config={"bearer":"AAAAxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"}',
        ),
    });

    const token = await extractBearerToken();
    expect(token).toBe("AAAAxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx");
  });

  it("caches token after first extraction", async () => {
    setupScripts(["https://abs.twimg.com/client-web/main.abc.js"]);
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve('a="AAAAyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy"'),
    });
    globalThis.fetch = mockFetch;

    const token1 = await extractBearerToken();
    const token2 = await extractBearerToken();

    expect(token1).toBe(token2);
    // Only fetched once because second call uses cache
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("throws when no scripts contain bearer token", async () => {
    setupScripts(["https://abs.twimg.com/client-web/main.abc.js"]);
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve("no token here at all"),
    });

    await expect(extractBearerToken()).rejects.toThrow(
      "Could not extract bearer token",
    );
  });

  it("limits to first 5 scripts", async () => {
    const urls = Array.from(
      { length: 10 },
      (_, i) => `https://abs.twimg.com/client-web/chunk${i}.js`,
    );
    setupScripts(urls);

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve("no token"),
    });
    globalThis.fetch = mockFetch;

    await expect(extractBearerToken()).rejects.toThrow();

    // First 5 calls should be the first 5 scripts
    const fetchedUrls = mockFetch.mock.calls.map((call: any[]) => call[0]);
    for (let i = 0; i < 5; i++) {
      expect(fetchedUrls[i]).toContain(`chunk${i}.js`);
    }
    // Should NOT have fetched chunk5-9 as direct scripts
    expect(
      fetchedUrls.filter((u: string) => u.includes("chunk5.js")),
    ).toHaveLength(0);
  });
});

describe("getHeaders", () => {
  it("returns correct auth headers after token is cached", async () => {
    setCookies("ct0=mycsrf; twid=u%3D999");

    vi.spyOn(document, "querySelectorAll").mockReturnValue([
      {
        getAttribute: () => "https://abs.twimg.com/client-web/main.abc.js",
      },
    ] as unknown as NodeListOf<Element>);
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () =>
        Promise.resolve('token="AAAAtokenvalue123456789012345678901"'),
    });

    await extractBearerToken();
    const headers = getHeaders();

    expect(headers.authorization).toBe(
      "Bearer AAAAtokenvalue123456789012345678901",
    );
    expect(headers["x-csrf-token"]).toBe("mycsrf");
    expect(headers["x-twitter-auth-type"]).toBe("OAuth2Session");
    expect(headers["x-twitter-active-user"]).toBe("yes");
  });

  it("throws when bearer token not yet extracted", () => {
    setCookies("ct0=mycsrf");
    expect(() => getHeaders()).toThrow("Bearer token not extracted yet");
  });
});

describe("isAuthenticated", () => {
  it("returns true when all auth available", async () => {
    setCookies("ct0=abc; twid=u%3D123");

    vi.spyOn(document, "querySelectorAll").mockReturnValue([
      {
        getAttribute: () => "https://abs.twimg.com/client-web/main.abc.js",
      },
    ] as unknown as NodeListOf<Element>);
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve('b="AAAAbearer12345678901234567890123456"'),
    });

    await extractBearerToken();
    expect(isAuthenticated()).toBe(true);
  });

  it("returns false when cookies missing", () => {
    setCookies("");
    expect(isAuthenticated()).toBe(false);
  });

  it("returns false when bearer token not cached", () => {
    setCookies("ct0=abc; twid=u%3D123");
    expect(isAuthenticated()).toBe(false);
  });
});

describe("clearCachedToken", () => {
  it("resets cached bearer token", async () => {
    setCookies("ct0=abc; twid=u%3D123");

    vi.spyOn(document, "querySelectorAll").mockReturnValue([
      {
        getAttribute: () => "https://abs.twimg.com/client-web/main.abc.js",
      },
    ] as unknown as NodeListOf<Element>);
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve('c="AAAAclear12345678901234567890123456789"'),
    });

    await extractBearerToken();
    expect(isAuthenticated()).toBe(true);

    clearCachedToken();
    expect(isAuthenticated()).toBe(false);
  });
});
