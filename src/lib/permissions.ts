/**
 * Thin helpers around chrome.permissions for the webhook/AI flows. Workers can
 * only `fetch` an origin with host permission; `request` needs a user gesture
 * (Options/popup click), so the worker only ever calls `contains()`.
 */

/** URL → Chrome origin pattern `${origin}/*`; null for non-http(s)/unparseable. */
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

/** Prompt for host permission (user-gesture only). True if accepted. */
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
