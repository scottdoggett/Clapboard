/**
 * Auth Token Storage
 *
 * Convex Auth keeps its tokens wherever you tell it to. The default is
 * `localStorage`, which is per-page — and this extension has three pages that
 * need the same session: the popup where you sign in, the background worker
 * that syncs, and the content script that reads.
 *
 * So tokens go in `chrome.storage.local` instead, under a known prefix, and
 * the background worker reads the JWT from there rather than being handed it
 * over a message. That keeps the session in one place: sign out in the popup
 * and the worker's next call is unauthenticated, with nothing to invalidate.
 */

const PREFIX = "clapboard_auth:";

/**
 * The key Convex Auth stores the access token under.
 *
 * It namespaces by deployment URL — `__convexAuthJWT_https://…` — so the exact
 * key isn't known ahead of time and is matched by prefix.
 */
const JWT_MARKER = "__convexAuthJWT";

/**
 * A `TokenStorage` backed by `chrome.storage.local`.
 *
 * Convex Auth accepts async storage, which is what makes this possible —
 * `chrome.storage` has no synchronous API.
 */
export const chromeTokenStorage = {
  async getItem(key: string): Promise<string | null> {
    const stored = await chrome.storage.local.get(PREFIX + key);
    const value = stored[PREFIX + key];
    return typeof value === "string" ? value : null;
  },

  async setItem(key: string, value: string): Promise<void> {
    await chrome.storage.local.set({ [PREFIX + key]: value });
  },

  async removeItem(key: string): Promise<void> {
    await chrome.storage.local.remove(PREFIX + key);
  },
};

/**
 * The current access token, for callers that aren't running Convex Auth
 * themselves — the background worker uses this to authenticate its own client.
 *
 * @returns The JWT, or null when signed out
 */
export async function getStoredAuthToken(): Promise<string | null> {
  const all = await chrome.storage.local.get(null);

  for (const [key, value] of Object.entries(all)) {
    if (key.startsWith(PREFIX) && key.includes(JWT_MARKER) && typeof value === "string") {
      return value;
    }
  }

  return null;
}

/**
 * Drop every stored token.
 *
 * Used when the deployment URL changes: tokens are issued by one deployment
 * and meaningless to another, and a stale one produces confusing failures
 * rather than a clean signed-out state.
 */
export async function clearStoredAuth(): Promise<void> {
  const all = await chrome.storage.local.get(null);
  const keys = Object.keys(all).filter((key) => key.startsWith(PREFIX));

  if (keys.length > 0) await chrome.storage.local.remove(keys);
}
