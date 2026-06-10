import {
  showFillTrigger,
  setFillTriggerFilling,
  setFillTriggerProgress,
  showFillTriggerDone,
  setAiFallbackProgress,
  setRemoteReviewState,
  clearRemoteReviewState,
  type TriggerStats,
  type TriggerResume,
  type ReviewGroup,
  type RemoteReviewCallbacks,
} from './affordance';
import { AdapterIdSchema, type AdapterId } from '@/profile/schema';

const STUB_GUARD = '__autofilltool_parent_stub_loaded__';

declare global {
  interface Window {
    [STUB_GUARD]?: boolean;
  }
}

if (!window[STUB_GUARD]) {
  window[STUB_GUARD] = true;
  install();
}

const ATS_HOST_RE = /(^|\.)(greenhouse\.io|lever\.co|ashbyhq\.com|myworkdayjobs\.com)$/i;

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
        e.source?.postMessage(
          { type: 'autofilltool:ack' },
          { targetOrigin: e.origin },
        );
        showFillTrigger({
          detected: data.detected,
          onFill: () => {
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
        const callbacks: RemoteReviewCallbacks = {
          onEnter: (group) => sendToIframe({ type: 'autofilltool:review-enter', group }),
          onStep: (dir) => sendToIframe({ type: 'autofilltool:review-step', dir }),
          onExit: () => sendToIframe({ type: 'autofilltool:review-exit' }),
        };
        showFillTriggerDone(stats, [], { remote: callbacks });
        return;
      }

      case 'autofilltool:ai-fallback-progress': {
        if (e.source !== activeSource) return;
        if (typeof data.filled !== 'number' || typeof data.pending !== 'number') return;
        const decrementSkippedBy =
          typeof data.skippedRemoved === 'number' ? data.skippedRemoved : undefined;
        setAiFallbackProgress(
          data.filled,
          data.pending,
          [],
          decrementSkippedBy !== undefined ? { decrementSkippedBy } : {},
        );
        return;
      }

      case 'autofilltool:review-state': {
        if (e.source !== activeSource) return;
        const remote = coerceReviewState(data);
        if (!remote) return;
        setRemoteReviewState(remote);
        return;
      }

      case 'autofilltool:review-empty': {
        if (e.source !== activeSource) return;
        clearRemoteReviewState();
        return;
      }
    }
  });

  function sendToIframe(msg: Record<string, unknown>): void {
    activeSource?.postMessage(msg, { targetOrigin: activeOrigin ?? '*' });
  }
}

const REVIEW_GROUPS = new Set<ReviewGroup>(['filled', 'skipped', 'suggest', 'ai']);

function coerceReviewState(
  data: Record<string, unknown>,
):
  | { group: ReviewGroup; index: number; total: number; label: string; note?: string }
  | null {
  if (typeof data.group !== 'string' || !REVIEW_GROUPS.has(data.group as ReviewGroup)) return null;
  if (typeof data.index !== 'number' || typeof data.total !== 'number') return null;
  if (typeof data.label !== 'string') return null;
  return {
    group: data.group as ReviewGroup,
    index: data.index,
    total: data.total,
    label: data.label,
    ...(typeof data.note === 'string' ? { note: data.note } : {}),
  };
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
    autoLogging: data.autoLogging === true,
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

