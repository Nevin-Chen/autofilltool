/**
 * Parent-page stub injected by the background worker into the top frame of
 * any tab that contains an ATS iframe (detected via chrome.webNavigation).
 *
 * The iframe content script (src/content/index.ts) can't render a
 * viewport-fixed pill because position:fixed anchors to the iframe's own
 * viewport, not the user's. This stub lives in the parent page so the
 * pill can sit at the parent's bottom-right and scroll with the user.
 *
 * Trust boundary: every inbound postMessage is validated — the origin
 * MUST be one of the curated ATS hosts and the payload shape MUST match.
 * The stub never auto-detects fields, never imports adapter logic, and
 * never speaks to the network. It is a passive listener that mounts the
 * existing affordance pill and round-trips clicks back to the iframe.
 */

import {
  showFillTrigger,
  setFillTriggerFilling,
  setFillTriggerProgress,
  showFillTriggerDone,
  type TriggerStats,
  type TriggerResume,
} from './affordance';
import { AdapterIdSchema, type AdapterId } from '@/profile/schema';

const STUB_GUARD = '__autofilltool_parent_stub_loaded__';

declare global {
  interface Window {
    [STUB_GUARD]?: boolean;
  }
}

// Idempotent: a second executeScript on the same tab won't double-listen.
if (!window[STUB_GUARD]) {
  window[STUB_GUARD] = true;
  install();
}

/** Hostnames whose postMessages we'll act on. Mirrors the ATS adapter set. */
const ATS_HOST_RE = /(^|\.)(greenhouse\.io|lever\.co|ashbyhq\.com|myworkdayjobs\.com)$/i;

type IframePillNeededMsg = { type: 'autofilltool:iframe-pill-needed'; detected: number };
type FillStartedMsg = { type: 'autofilltool:fill-started' };
type FillProgressMsg = { type: 'autofilltool:fill-progress'; done: number; total: number };
type FillCompleteMsg = {
  type: 'autofilltool:fill-complete';
  filled: number;
  skipped: number;
  failed: number;
  suggest: number;
  adapterId: string;
  adapterName: string;
  resume: string;
};

function install(): void {
  let activeSource: MessageEventSource | null = null;
  let activeOrigin: string | null = null;

  window.addEventListener('message', (e: MessageEvent) => {
    if (!isObject(e.data)) return;
    const data = e.data as Record<string, unknown>;
    if (typeof data.type !== 'string') return;
    if (!isAtsOrigin(e.origin)) return;

    switch (data.type) {
      case 'autofilltool:iframe-pill-needed': {
        if (typeof data.detected !== 'number') return;
        activeSource = e.source;
        activeOrigin = e.origin;
        // Ack so iframe stops retrying.
        e.source?.postMessage(
          { type: 'autofilltool:ack' },
          { targetOrigin: e.origin },
        );
        showFillTrigger({
          detected: data.detected,
          onFill: () => {
            // Switch parent pill to filling state immediately so the user gets
            // feedback even before the iframe's own progress event arrives.
            setFillTriggerFilling();
            activeSource?.postMessage(
              { type: 'autofilltool:fill-request' },
              { targetOrigin: activeOrigin ?? '*' },
            );
          },
        });
        return;
      }

      case 'autofilltool:fill-started': {
        if (e.source !== activeSource) return;
        setFillTriggerFilling();
        return;
      }

      case 'autofilltool:fill-progress': {
        if (e.source !== activeSource) return;
        if (typeof data.done !== 'number' || typeof data.total !== 'number') return;
        setFillTriggerProgress(data.done, data.total);
        return;
      }

      case 'autofilltool:fill-complete': {
        if (e.source !== activeSource) return;
        const stats = coerceCompleteStats(data);
        if (!stats) return;
        showFillTriggerDone(stats);
        return;
      }
    }
  });
}

function coerceCompleteStats(data: Record<string, unknown>): TriggerStats | null {
  const idParse = AdapterIdSchema.safeParse(data.adapterId);
  if (!idParse.success) return null;
  const adapterId: AdapterId = idParse.data;
  const num = (k: string): number => (typeof data[k] === 'number' ? (data[k] as number) : 0);
  const resume = coerceResume(data.resume);
  return {
    filled: num('filled'),
    skipped: num('skipped'),
    failed: num('failed'),
    suggest: num('suggest'),
    adapterId,
    adapterName: typeof data.adapterName === 'string' ? data.adapterName : adapterId,
    resume,
  };
}

const RESUME_VALUES = new Set<TriggerResume>([
  'attached',
  'notFound',
  'noResume',
  'noHook',
  'skipped',
]);
function coerceResume(v: unknown): TriggerResume {
  return typeof v === 'string' && RESUME_VALUES.has(v as TriggerResume)
    ? (v as TriggerResume)
    : 'noResume';
}

function isAtsOrigin(origin: string): boolean {
  try {
    const u = new URL(origin);
    return ATS_HOST_RE.test(u.hostname);
  } catch {
    return false;
  }
}

function isObject(v: unknown): v is object {
  return typeof v === 'object' && v !== null;
}

