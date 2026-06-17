export const KEEPALIVE_INTERVAL_MS = 20_000;

export function startKeepAlive(
  ping: () => void = defaultPing,
  intervalMs: number = KEEPALIVE_INTERVAL_MS,
): () => void {
  const id = setInterval(ping, intervalMs);
  return () => clearInterval(id);
}

function defaultPing(): void {
  try {
    void chrome.runtime.getPlatformInfo?.();
  } catch {
  }
}
