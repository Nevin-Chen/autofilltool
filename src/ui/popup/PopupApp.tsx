import { useEffect, useState } from 'react';
import { sendToBackground } from '@/lib/messaging';
import type { SubmissionRecord } from '@/profile/schema';

type TabInfo = {
  id: number;
  url: string;
  host: string;
  title: string;
};

type FillSummary = {
  adapterId: string;
  filled: number;
  skipped: number;
  failed: number;
  total: number;
  fieldsDetected: number;
};

export function PopupApp() {
  const [tab, setTab] = useState<TabInfo | null>(null);
  const [pong, setPong] = useState<string | null>(null);
  const [pingErr, setPingErr] = useState<string | null>(null);
  const [filling, setFilling] = useState(false);
  const [summary, setSummary] = useState<FillSummary | null>(null);
  const [fillErr, setFillErr] = useState<string | null>(null);
  const [history, setHistory] = useState<SubmissionRecord[]>([]);

  useEffect(() => {
    (async () => {
      try {
        const [active] = await chrome.tabs.query({
          active: true,
          currentWindow: true,
        });
        if (active?.id != null && active.url) {
          const u = new URL(active.url);
          setTab({
            id: active.id,
            url: active.url,
            host: u.host,
            title: active.title ?? '',
          });
        }
        const r = await sendToBackground({ type: 'PING' });
        if (r.ok) setPong(r.value.at);
        else setPingErr(r.error);
        const h = await sendToBackground({ type: 'GET_HISTORY', limit: 5 });
        if (h.ok) setHistory(h.value);
      } catch (err) {
        setPingErr(err instanceof Error ? err.message : String(err));
      }
    })();
  }, []);

  const onOpenOptions = () => {
    chrome.runtime.openOptionsPage();
  };

  const isFillablePage = !!tab && /^https?:$/.test(new URL(tab.url).protocol);

  const onFill = async () => {
    if (!tab?.id) return;
    setFilling(true);
    setFillErr(null);
    setSummary(null);
    try {
      const r = await sendToBackground({ type: 'FILL_PAGE', tabId: tab.id });
      if (r.ok) {
        setSummary({
          adapterId: r.value.adapterId,
          filled: r.value.filled,
          skipped: r.value.skipped,
          failed: r.value.failed,
          total: r.value.total,
          fieldsDetected: r.value.fieldsDetected,
        });
      } else {
        setFillErr(r.error);
      }
    } catch (err) {
      setFillErr(err instanceof Error ? err.message : String(err));
    } finally {
      setFilling(false);
    }
  };

  return (
    <div className="p-4 text-sm">
      <header className="mb-3">
        <div className="text-base font-semibold">AutoFillTool</div>
        <div className="truncate text-xs text-slate-500 dark:text-slate-400">
          {tab ? tab.host : 'no active tab'}
        </div>
      </header>

      <button
        type="button"
        onClick={onFill}
        disabled={!isFillablePage || filling}
        className="w-full rounded-md bg-sky-600 px-3 py-2 text-sm font-medium text-white hover:bg-sky-500 disabled:opacity-50"
        title={
          isFillablePage
            ? 'Fill recognised fields on this page'
            : 'AutoFillTool only runs on http(s) pages'
        }
      >
        {filling ? 'Filling…' : 'Fill this page'}
      </button>

      {summary && summary.fieldsDetected === 0 && (
        <div className="mt-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
          No application form detected on this page. Nothing was changed.
        </div>
      )}

      {summary && summary.fieldsDetected > 0 && (
        <div className="mt-3 rounded-md border border-slate-200 bg-white p-3 text-xs dark:border-slate-700 dark:bg-slate-800">
          <div className="mb-1 font-medium text-slate-700 dark:text-slate-200">
            via <span className="font-mono">{summary.adapterId}</span>
          </div>
          <div className="flex flex-wrap gap-x-3 gap-y-1">
            <span className="text-emerald-600 dark:text-emerald-400">
              {summary.filled} filled
            </span>
            <span className="text-slate-500 dark:text-slate-400">
              {summary.skipped} skipped
            </span>
            {summary.failed > 0 && (
              <span className="text-rose-600 dark:text-rose-400">
                {summary.failed} failed
              </span>
            )}
            <span className="text-slate-400">of {summary.fieldsDetected} detected</span>
          </div>
        </div>
      )}

      {fillErr && (
        <div className="mt-3 rounded-md border border-rose-300 bg-rose-50 p-3 text-xs text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300">
          {fillErr}
        </div>
      )}

      {history.length > 0 && (
        <div className="mt-4">
          <div className="mb-1 text-xs font-medium text-slate-600 dark:text-slate-300">
            Recent submissions
          </div>
          <ul className="space-y-1">
            {history.map((h) => (
              <li
                key={h.id}
                className="rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-800"
                title={h.jobUrl}
              >
                <div className="truncate">
                  <span className="font-medium text-slate-800 dark:text-slate-100">
                    {h.role || '(unknown role)'}
                  </span>{' '}
                  <span className="text-slate-500 dark:text-slate-400">
                    @ {h.company || '(unknown company)'}
                  </span>
                </div>
                <div className="text-[10px] text-slate-400 dark:text-slate-500">
                  {relativeTime(h.timestamp)} · {h.source} · {h.status}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-3 space-y-1 text-xs text-slate-500 dark:text-slate-400">
        <div>
          Background:{' '}
          {pong ? (
            <span className="text-emerald-600 dark:text-emerald-400">
              alive ({new Date(pong).toLocaleTimeString()})
            </span>
          ) : pingErr ? (
            <span className="text-rose-600 dark:text-rose-400">{pingErr}</span>
          ) : (
            '…'
          )}
        </div>
      </div>

      <button
        type="button"
        onClick={onOpenOptions}
        className="mt-4 w-full rounded-md border border-slate-300 px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
      >
        Open settings
      </button>
    </div>
  );
}

function relativeTime(iso: string): string {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return iso;
  const diff = Date.now() - t;
  const s = Math.round(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return `${d}d ago`;
}
