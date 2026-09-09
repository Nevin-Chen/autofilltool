import { describe, expect, it } from 'vitest';
import { isRequestMessage, type RouteChangedMsg } from '@/types/messages';

describe('ROUTE_CHANGED message', () => {
  const msg: RouteChangedMsg = {
    type: 'ROUTE_CHANGED',
    url: 'https://jobs.ashbyhq.com/metaview/4af6dfc4/application',
  };

  it('passes the runtime guard so the content listener sees it', () => {
    expect(isRequestMessage(msg)).toBe(true);
  });

  it('rejects a bare type string with no url', () => {
    expect(isRequestMessage({ type: 'ROUTE_CHANGE' })).toBe(false);
  });
});
