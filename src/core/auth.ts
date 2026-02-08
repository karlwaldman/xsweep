/**
 * Authentication utilities for X/Twitter internal API.
 * Extracts bearer token, CSRF token, and user ID from the page context.
 */

let cachedBearerToken: string | null = null;

export function getCSRFToken(): string {
  const match = document.cookie.match(/ct0=([^;]+)/);
  if (!match) {
    throw new Error("CSRF token not found. Are you logged into x.com?");
  }
  return match[1];
}

export function getMyUserId(): string {
  const match = document.cookie.match(/twid=u%3D(\d+)/);
  if (!match) {
    throw new Error("User ID not found. Are you logged into x.com?");
  }
  return match[1];
}

export async function extractBearerToken(): Promise<string> {
  if (cachedBearerToken) return cachedBearerToken;

  console.log("[XSweep] Extracting bearer token...");

  // Try script tags on current page
  const scripts = Array.from(document.querySelectorAll("script[src]"));
  const mainScripts = scripts
    .map((s) => s.getAttribute("src")!)
    .filter(
      (src) => src && (src.includes("/client-web/") || src.includes("main.")),
    );

  console.log(`[XSweep] Found ${mainScripts.length} candidate scripts`);

  // Only try first 5 scripts to avoid downloading dozens of large bundles
  for (const url of mainScripts.slice(0, 5)) {
    try {
      console.log(`[XSweep] Checking bundle: ${url.split("/").pop()}`);
      const resp = await fetch(url);
      const text = await resp.text();
      const match = text.match(/"(AAAA[A-Za-z0-9%]{30,})"/);
      if (match) {
        cachedBearerToken = match[1];
        console.log("[XSweep] Bearer token found!");
        return cachedBearerToken;
      }
    } catch (e) {
      console.log(`[XSweep] Bundle fetch failed: ${e}`);
    }
  }

  // Fallback: page source for bundle URLs
  console.log("[XSweep] Trying fallback: page source bundle URLs...");
  try {
    const resp = await fetch(location.href);
    const html = await resp.text();
    const bundleMatches = html.matchAll(
      /src="(https:\/\/abs\.twimg\.com\/responsive-web\/client-web[^"]+\.js)"/g,
    );
    let fallbackCount = 0;
    for (const bm of bundleMatches) {
      if (fallbackCount >= 5) break; // limit fallback attempts too
      fallbackCount++;
      try {
        console.log(`[XSweep] Fallback bundle: ${bm[1].split("/").pop()}`);
        const resp2 = await fetch(bm[1]);
        const text = await resp2.text();
        const match = text.match(/"(AAAA[A-Za-z0-9%]{30,})"/);
        if (match) {
          cachedBearerToken = match[1];
          console.log("[XSweep] Bearer token found via fallback!");
          return cachedBearerToken;
        }
      } catch {
        // try next bundle
      }
    }
  } catch {
    // fallback failed
  }

  throw new Error(
    "Could not extract bearer token. Refresh x.com and try again.",
  );
}

export function getHeaders(): Record<string, string> {
  const csrfToken = getCSRFToken();
  if (!cachedBearerToken) {
    throw new Error(
      "Bearer token not extracted yet. Call extractBearerToken() first.",
    );
  }
  return {
    authorization: `Bearer ${cachedBearerToken}`,
    "x-csrf-token": csrfToken,
    "x-twitter-auth-type": "OAuth2Session",
    "x-twitter-active-user": "yes",
  };
}

export function isAuthenticated(): boolean {
  try {
    getCSRFToken();
    getMyUserId();
    return cachedBearerToken !== null;
  } catch {
    return false;
  }
}

export function clearCachedToken(): void {
  cachedBearerToken = null;
}
