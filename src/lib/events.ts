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

/**
 * Focus a field the way a click would, without scrolling the viewport. Falls
 * back to synthetic focus events when the element cannot take real focus
 * (detached nodes in jsdom, `display: none` wrappers).
 */
function enterField(el: HTMLElement): void {
  el.focus({ preventScroll: true });
  if (el.ownerDocument.activeElement === el) return;
  el.dispatchEvent(new FocusEvent('focus'));
  el.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
}

/**
 * Leave a field the way clicking elsewhere would. A real `blur()` gives the
 * page trusted `blur` + `focusout`; React 17+ maps `onBlur` onto `focusout`,
 * so the bubbling `blur` in `dispatchInputEvents` alone never reaches it.
 */
function leaveField(el: HTMLElement): void {
  const doc = el.ownerDocument;
  if (doc.activeElement === el) {
    el.blur();
    if (doc.activeElement !== el) return;
  }
  el.dispatchEvent(new FocusEvent('blur'));
  el.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
}

/**
 * Write a value and leave the field the way a person would: focus, set, fire
 * input + change, blur. Forms that only mark a field touched on `focusout`
 * (Ashby's name and email) otherwise keep treating it as empty, and the user
 * has to click into every field and out again before the submit goes through.
 *
 * Focus is left alone if the user is already in the field.
 */
export function commitFieldValue(
  el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
  value: string,
): void {
  const userIsHere = el.ownerDocument.activeElement === el;
  if (!userIsHere) enterField(el);
  setNativeValue(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  if (!userIsHere) leaveField(el);
}
