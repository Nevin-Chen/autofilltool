export const TAB_LOAD_TIMEOUT_MS = 30_000;

export type BrowsingSession = {
  open: (url: string, read: () => unknown) => Promise<unknown>;
  run: (func: (listingId: string) => unknown, listingId: string) => Promise<unknown>;
  close: () => Promise<void>;
};

export function backgroundTabSession(): BrowsingSession {
  let tabId: number | null = null;
  return {
    async open(url, read) {
      if (tabId == null) {
        const tab = await chrome.tabs.create({ url, active: false });
        if (tab.id == null) throw new Error('Chrome did not open a background tab.');
        tabId = tab.id;
        await waitForTabLoad(tabId, () => Promise.resolve(), true);
      } else {
        const id = tabId;
        await waitForTabLoad(id, async () => {
          await chrome.tabs.update(id, { url });
        });
      }
      const [frame] = await chrome.scripting.executeScript({ target: { tabId }, func: read });
      return frame?.result ?? null;
    },
    async run(func, listingId) {
      if (tabId == null) throw new Error('No page is open in the background tab.');
      const [frame] = await chrome.scripting.executeScript({ target: { tabId }, func, args: [listingId] });
      return frame?.result ?? null;
    },
    async close() {
      if (tabId != null) await chrome.tabs.remove(tabId).catch(() => {});
      tabId = null;
    },
  };
}

function waitForTabLoad(tabId: number, navigate: () => Promise<void>, alreadyStarted = false): Promise<void> {
  return new Promise((resolve, reject) => {
    let sawLoading = alreadyStarted;
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(onUpdated);
      reject(new Error(`The page took longer than ${TAB_LOAD_TIMEOUT_MS / 1000}s to load.`));
    }, TAB_LOAD_TIMEOUT_MS);
    const done = () => {
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      resolve();
    };
    const onUpdated = (updatedId: number, info: chrome.tabs.TabChangeInfo) => {
      if (updatedId !== tabId) return;
      if (info.status === 'loading') sawLoading = true;
      if (info.status === 'complete' && sawLoading) done();
    };
    chrome.tabs.onUpdated.addListener(onUpdated);
    navigate()
      .then(() => (alreadyStarted ? chrome.tabs.get(tabId) : null))
      .then((tab) => {
        if (tab?.status === 'complete') done();
      })
      .catch((err: unknown) => {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(onUpdated);
        reject(err instanceof Error ? err : new Error(String(err)));
      });
  });
}
