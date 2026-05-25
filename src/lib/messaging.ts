/**
 * Typed helpers around chrome.runtime.sendMessage / chrome.tabs.sendMessage.
 *
 * Use `sendToBackground(msg)` from popup/options/content scripts when talking
 * to the service worker. Use `sendToTab(tabId, msg)` from the popup/background
 * when calling into a content script.
 */

import type { RequestMessage, ResponseFor } from '@/types/messages';

export async function sendToBackground<M extends RequestMessage>(
  message: M,
): Promise<ResponseFor<M>> {
  return (await chrome.runtime.sendMessage(message)) as ResponseFor<M>;
}

export async function sendToTab<M extends RequestMessage>(
  tabId: number,
  message: M,
): Promise<ResponseFor<M>> {
  return (await chrome.tabs.sendMessage(tabId, message)) as ResponseFor<M>;
}

/**
 * Wraps an async handler so it can return its result from a
 * chrome.runtime.onMessage listener. Chrome requires the listener to return
 * `true` synchronously when it intends to call sendResponse asynchronously.
 */
export function respondAsync<TMsg, TRes>(
  handler: (msg: TMsg, sender: chrome.runtime.MessageSender) => Promise<TRes>,
): (
  msg: TMsg,
  sender: chrome.runtime.MessageSender,
  sendResponse: (res: TRes) => void,
) => true {
  return (msg, sender, sendResponse) => {
    handler(msg, sender).then(
      (value) => sendResponse(value),
      (err: unknown) => {
        const error = err instanceof Error ? err.message : String(err);
        sendResponse({ ok: false, error } as unknown as TRes);
      },
    );
    return true;
  };
}
