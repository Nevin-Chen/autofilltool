/**
 * Thin helpers around chrome.permissions. Used by the tracking webhook flow
 * to ask the user for cross-origin POST permission only when needed.
 *
 * MV3 background workers can only `fetch` an origin if the extension has
 * host permission for it. For Apps Script webhooks we surface a "Grant
 * permission" button in Options so the user explicitly consents.
 *
 * `chrome.permissions.request` MUST be called from a user gesture context
 * (a click handler in the options page or popup). The background worker
 * cannot prompt; it can only call `contains()` to check.
 */

/**
 * Turn a single URL into the origin pattern Chrome expects: `${origin}/*`.
 * Returns null for non-http(s) URLs or anything unparseable.
 */
export function originPatternFor(rawUrl: string): string | null {
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  return `${u.origin}/*`;
}

/** Has the user already granted host permission for this URL's origin? */
export async function hasOriginPermission(rawUrl: string): Promise<boolean> {
  const pattern = originPatternFor(rawUrl);
  if (!pattern) return false;
  return chrome.permissions.contains({ origins: [pattern] });
}

/**
 * Prompt the user to grant host permission for this URL's origin. Must be
 * called from a user gesture (e.g., a button click handler). Returns true
 * if the user accepted, false if they declined or it was already granted
 * to a broader pattern.
 */
export async function requestOriginPermission(rawUrl: string): Promise<boolean> {
  const pattern = originPatternFor(rawUrl);
  if (!pattern) return false;
  return chrome.permissions.request({ origins: [pattern] });
}

/** Revoke host permission for this URL's origin, if granted at this granularity. */
export async function revokeOriginPermission(rawUrl: string): Promise<boolean> {
  const pattern = originPatternFor(rawUrl);
  if (!pattern) return false;
  return chrome.permissions.remove({ origins: [pattern] });
}
