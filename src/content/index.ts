/**
 * Content-script entry point. Loaded into pages matched by manifest's
 * content_scripts. In step 1 this is a no-op listener so the round-trip from
 * popup → background → content can be smoke-tested even before adapters land.
 */

import { log } from '@/lib/logger';
import { isRequestMessage } from '@/types/messages';

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!isRequestMessage(msg)) return false;
  if (msg.type === 'FILL_PAGE') {
    sendResponse({
      ok: false,
      error: 'Adapters and filler land in step 2.',
    });
    return true;
  }
  return false;
});

log.debug('content script loaded on', location.href);
