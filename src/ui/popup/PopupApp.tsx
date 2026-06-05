import { useEffect, useState } from 'react';
import { sendToBackground } from '@/lib/messaging';
import { getSettings, setSettings } from '@/profile/store';
import type { SubmissionRecord, Settings } from '@/profile/schema';
import { toCsv, csvFilename } from '@/lib/history-export';

type TabInfo = {
  id: number;
  url: string;
  host: string;
  title: string;
};

export function PopupApp() {
  const [tab, setTab] = useState<TabInfo | null>(null);
  const [pong, setPong] = useState<string | null>(null);
  const [pingErr, setPingErr] = useState<string | null>(null);
  const [history, setHistory] = useState<SubmissionRecord[]>([]);
  const [cursor, setCursor] = useState(0);
  const [confirmingClear, setConfirmingClear] = useState(false);
  const [settings, setSettingsState] = useState<Settings | null>(null);

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
        const h = await sendToBackground({ type: 'GET_HISTORY' });
        if (h.ok) setHistory(h.value);
        const s = await getSettings();
        setSettingsState(s);
      } catch (err) {
        setPingErr(err instanceof Error ? err.message : String(err));
      }
    })();
  }, []);

  const onOpenOptions = () => {
    chrome.runtime.openOptionsPage();
  };

  const onClear = async () => {
    const r = await sendToBackground({ type: 'CLEAR_HISTORY' });
    if (r.ok) {
      setHistory([]);
      setCursor(0);
    }
    setConfirmingClear(false);
  };

  const onExport = () => {
    if (history.length === 0) return;
    const blob = new Blob([toCsv(history)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = csvFilename();
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const updateSettings = async (updates: Partial<Settings>) => {
    if (!settings) return;
    const next = { ...settings, ...updates };
    setSettingsState(next);
    try {
      await setSettings(next);
    } catch (err) {
      console.error('Failed to save settings:', err);
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

      {settings && (
        <div className="space-y-2 rounded-md border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-800">
          <label className="flex items-start gap-2 text-xs">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={settings.forceOverwrite}
              onChange={(e) =>
                updateSettings({
                  ...settings,
                  forceOverwrite: e.target.checked,
                })
              }
            />
            <span>
              <span className="font-medium text-slate-800 dark:text-slate-100">
                Force overwrite
              </span>
              <span className="block text-slate-500 dark:text-slate-400">
                Fill fields with existing values
              </span>
            </span>
          </label>

          <label className="flex items-start gap-2 text-xs">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={!settings.ui.animateFill}
              onChange={(e) =>
                updateSettings({
                  ...settings,
                  ui: { ...settings.ui, animateFill: !e.target.checked },
                })
              }
            />
            <span>
              <span className="font-medium text-slate-800 dark:text-slate-100">
                Disable auto-filling animation
              </span>
            </span>
          </label>
        </div>
      )}

      {history.length > 0 && (() => {
        const clampedCursor = Math.min(cursor, history.length - 1);
        const current = history[clampedCursor]!;
        const atStart = clampedCursor === 0;
        const atEnd = clampedCursor >= history.length - 1;
        const commitJump = (raw: string): void => {
          const n = Number.parseInt(raw, 10);
          if (!Number.isFinite(n)) return;
          const clamped = Math.max(1, Math.min(history.length, n));
          setCursor(clamped - 1);
        };
        return (
          <div className="mt-4">
            <div className="mb-1 flex items-center justify-between text-xs font-medium text-slate-600 dark:text-slate-300">
              <span className="flex items-center gap-1">
                Recent submissions
                <span
                  aria-label="Submissions are auto-logged when you submit an application"
                  title="auto-logged on submit"
                  className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full border border-slate-300 text-[9px] text-slate-500 dark:border-slate-600 dark:text-slate-400"
                >
                  i
                </span>
              </span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setCursor((c) => Math.max(0, c - 1))}
                  disabled={atStart}
                  aria-label="Previous submission"
                  className="rounded px-1.5 py-0.5 text-slate-500 enabled:hover:bg-slate-100 disabled:opacity-30 dark:text-slate-400 dark:enabled:hover:bg-slate-800"
                >
                  ◄
                </button>
                <span className="tabular-nums text-slate-500 dark:text-slate-400">
                  <input
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={clampedCursor + 1}
                    onChange={(e) => {
                      const digits = e.target.value.replace(/\D/g, '');
                      if (digits === '') return;
                      commitJump(digits);
                    }}
                    onFocus={(e) => e.currentTarget.select()}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur();
                    }}
                    aria-label="Jump to submission number"
                    className="w-8 rounded border border-slate-200 bg-white px-1 py-0 text-center tabular-nums text-slate-700 focus:border-slate-400 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                  />
                  {' '}of {history.length}
                </span>
                <button
                  type="button"
                  onClick={() => setCursor((c) => Math.min(history.length - 1, c + 1))}
                  disabled={atEnd}
                  aria-label="Next submission"
                  className="rounded px-1.5 py-0.5 text-slate-500 enabled:hover:bg-slate-100 disabled:opacity-30 dark:text-slate-400 dark:enabled:hover:bg-slate-800"
                >
                  ►
                </button>
              </div>
            </div>
            <div
              className="rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-800"
              title={current.jobUrl}
            >
              <div className="truncate">
                <span className="font-medium text-slate-800 dark:text-slate-100">
                  {current.role || '(unknown role)'}
                </span>{' '}
                <span className="text-slate-500 dark:text-slate-400">
                  @ {current.company || '(unknown company)'}
                </span>
              </div>
              <div className="text-[10px] text-slate-400 dark:text-slate-500">
                {relativeTime(current.timestamp)} · {current.source} · {current.status}
              </div>
            </div>
            <div className="mt-2 flex justify-end gap-2 text-[11px]">
              <button
                type="button"
                onClick={onExport}
                className="rounded px-2 py-0.5 text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                Export CSV
              </button>
              {confirmingClear ? (
                <>
                  <button
                    type="button"
                    onClick={onClear}
                    className="rounded bg-rose-50 px-2 py-0.5 text-rose-700 hover:bg-rose-100 dark:bg-rose-900/30 dark:text-rose-300 dark:hover:bg-rose-900/50"
                  >
                    Confirm clear
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmingClear(false)}
                    className="rounded px-2 py-0.5 text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
                  >
                    Cancel
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmingClear(true)}
                  className="rounded px-2 py-0.5 text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
                >
                  Clear
                </button>
              )}
            </div>
          </div>
        );
      })()}

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
