/**
 * Detects Chrome MV3 dev-mode context invalidation. When the extension is
 * reloaded mid-session, content scripts already injected into open pages keep
 * stale `chrome.runtime` references — the next `chrome.*` call throws
 * "Extension context invalidated." We probe the cheapest canary
 * (`chrome.runtime.id`) so callers can short-circuit with a clear user-facing
 * notice instead of a noisy unhandled rejection.
 *
 * This lives in `lib/` because both the content script entry and any future
 * long-lived caller (e.g. submit-watch) may want to gate work on it.
 */

export function isExtensionContextValid(): boolean {
  try {
    return typeof chrome !== 'undefined' && !!chrome.runtime?.id;
  } catch {
    return false;
  }
}
