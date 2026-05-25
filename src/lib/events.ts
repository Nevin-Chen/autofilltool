/**
 * Synthetic event helpers. React's synthetic event system listens via a
 * delegated handler on the document and only registers a change if the value
 * was set via the native property setter — assigning directly to `.value`
 * bypasses React's tracker. These helpers do the right thing.
 */

/**
 * Set an input/textarea/select value via the native property setter so React
 * (and other frameworks that monkey-patch the value setter) actually notice.
 */
export function setNativeValue(
  el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
  value: string,
): void {
  const proto = Object.getPrototypeOf(el);
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  if (setter) {
    setter.call(el, value);
  } else {
    // Fallback — almost never hit on real browsers, but safe in jsdom.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (el as any).value = value;
  }
}

/**
 * Dispatch the events that frameworks listen for, in the order a real user
 * action would trigger them.
 */
export function dispatchInputEvents(el: HTMLElement): void {
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  el.dispatchEvent(new Event('blur', { bubbles: true }));
}
