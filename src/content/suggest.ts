/**
 * Inline "✨ Suggest" button injected next to every detected open-ended
 * textarea. On click, opens a long-lived port to the background and streams
 * the AI response straight into the textarea via the safe filler (so React
 * notices each delta).
 *
 * Gated on AI configuration (FR-013/FR-016), layered:
 *   - Primary: the button is only injected when a provider is configured
 *     (`installSuggestButtons(..., { aiConfigured })`).
 *   - Defensive: a click re-reads settings and, if no provider is configured
 *     (e.g. cleared after injection), shows a "Configure an AI provider"
 *     prompt and opens NO port / makes NO request — a hard privacy guarantee
 *     enforced in `guardedConnect`, not best-effort.
 *
 * Buttons live in a closed Shadow DOM so the host page can't restyle them.
 * One injector instance per page; calls to `installSuggestButtons` are
 * idempotent — buttons already on the page don't get duplicated.
 */

import type { DetectedField } from '@/adapters/types';
import type { JobContext } from './job-context';
import type { Settings } from '@/profile/schema';
import { getSettings } from '@/profile/store';
import { setNativeValue, dispatchInputEvents } from '@/lib/events';
import { AI_PORT_NAME, type AiBgToClient } from '@/types/ai-port';

const HOST_DATA_ATTR = 'data-autofilltool-suggest-host';

/** True when an AI provider is selected (the visibility + click-guard gate). */
export function aiConfigured(settings: Settings): boolean {
  return settings.ai.provider !== 'none';
}

export type InstallSuggestOptions = {
  /** Visibility gate (FR-013): skip injection entirely when no provider is set. */
  aiConfigured: boolean;
};

export function installSuggestButtons(
  fields: DetectedField[],
  ctx: JobContext,
  opts: InstallSuggestOptions,
): void {
  if (!opts.aiConfigured) return; // FR-013: no button without a provider
  for (const field of fields) {
    if (field.kind !== 'openEnded' && field.kind !== 'coverLetter') continue;
    if (!(field.el instanceof HTMLTextAreaElement)) continue;
    if (field.el.dataset[CAMEL_FLAG]) continue;
    field.el.dataset[CAMEL_FLAG] = '1';
    attachButtonFor(field.el, field.label, ctx);
  }
}

/**
 * The hard privacy gate (FR-016): read settings, and only open the port when a
 * provider is configured. Otherwise call `onNoProvider` (the prompt) and return
 * null WITHOUT connecting — so an unconfigured click provably opens no port and
 * issues no request. Settings come from chrome.storage.local (no network). Deps
 * are injected so this is unit-testable with spies.
 */
export async function guardedConnect(deps: {
  loadSettings: () => Promise<Settings>;
  connect: () => chrome.runtime.Port;
  onNoProvider: () => void;
}): Promise<chrome.runtime.Port | null> {
  let settings: Settings;
  try {
    settings = await deps.loadSettings();
  } catch {
    // Fail safe: if we can't confirm a provider, behave as unconfigured.
    deps.onNoProvider();
    return null;
  }
  if (!aiConfigured(settings)) {
    deps.onNoProvider();
    return null;
  }
  return deps.connect();
}

// dataset keys are camelCased forms of the data- attribute name.
const CAMEL_FLAG = 'autofilltoolSuggestBound';

function attachButtonFor(
  textarea: HTMLTextAreaElement,
  label: string,
  ctx: JobContext,
): void {
  const host = document.createElement('div');
  host.setAttribute(HOST_DATA_ATTR, '');
  Object.assign(host.style, {
    position: 'absolute',
    zIndex: '2147483646',
    pointerEvents: 'none', // children re-enable
  } as CSSStyleDeclaration);

  const shadow = host.attachShadow({ mode: 'closed' });
  shadow.appendChild(buildStyle());
  const wrap = document.createElement('div');
  wrap.className = 'wrap';
  shadow.appendChild(wrap);

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'suggest';
  btn.textContent = '✨ Suggest';
  btn.title = 'Draft an answer with AI';
  const status = document.createElement('span');
  status.className = 'status';
  wrap.append(btn, status);

  // Anchor to the textarea's bottom-right corner via CSS-pixel offsets.
  const reposition = () => {
    const r = textarea.getBoundingClientRect();
    host.style.left = `${window.scrollX + r.right - 96}px`;
    host.style.top = `${window.scrollY + r.bottom - 28}px`;
  };
  reposition();
  window.addEventListener('scroll', reposition, { passive: true });
  window.addEventListener('resize', reposition);

  let currentPort: chrome.runtime.Port | null = null;
  let streaming = false;

  const reset = () => {
    streaming = false;
    btn.disabled = false;
    btn.textContent = '✨ Suggest';
    currentPort = null;
  };

  btn.addEventListener('click', () => {
    void onActivate();
  });

  async function onActivate(): Promise<void> {
    if (streaming && currentPort) {
      // Click during stream = cancel.
      try {
        currentPort.postMessage({ kind: 'cancel' });
        currentPort.disconnect();
      } catch {
        /* ignore */
      }
      status.textContent = ' cancelled';
      reset();
      return;
    }

    // Defensive gate (FR-016): no provider → prompt, and provably no port/fetch.
    const port = await guardedConnect({
      loadSettings: getSettings,
      connect: () => chrome.runtime.connect({ name: AI_PORT_NAME }),
      onNoProvider: () => showNoProviderPrompt(status),
    });
    if (!port) return;
    currentPort = port;

    // Only now that we're proceeding do we touch the textarea: clear if empty,
    // else append a blank line so we don't clobber the user's draft.
    if (textarea.value.trim().length === 0) {
      setNativeValue(textarea, '');
    } else {
      setNativeValue(textarea, textarea.value + '\n\n');
    }
    dispatchInputEvents(textarea);

    streaming = true;
    btn.disabled = false;
    btn.textContent = '✕ Stop';
    status.textContent = ' connecting…';

    let first = true;

    port.onMessage.addListener((raw: AiBgToClient) => {
      if (raw.kind === 'delta') {
        if (first) {
          status.textContent = ' streaming…';
          first = false;
        }
        setNativeValue(textarea, textarea.value + raw.text);
        // Just `input` while streaming; full input/change/blur on done.
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
      } else if (raw.kind === 'done') {
        status.textContent = ' done';
        dispatchInputEvents(textarea);
        reset();
        port.disconnect();
        setTimeout(() => (status.textContent = ''), 1500);
      } else if (raw.kind === 'error') {
        status.textContent = ` ${truncate(raw.message, 60)}`;
        reset();
        port.disconnect();
      }
    });
    port.onDisconnect.addListener(() => {
      if (streaming) {
        status.textContent = ' disconnected';
        reset();
      }
    });

    const maxChars =
      textarea.maxLength > 0 && textarea.maxLength < 100000 ? textarea.maxLength : undefined;
    port.postMessage({
      kind: 'start',
      req: {
        question: label || textarea.name || 'Open-ended question',
        label,
        ...(ctx.company || ctx.role
          ? { job: { company: ctx.company, role: ctx.role, jobUrl: ctx.jobUrl } }
          : {}),
        ...(ctx.jobDescription ? { jobDescription: ctx.jobDescription } : {}),
        ...(maxChars ? { maxChars } : {}),
      },
    });
  }

  document.body.appendChild(host);
}

/**
 * Empty-state prompt (US4 scenario 3): tell the user to configure a provider.
 * Purely presentational — shown inside the button's own shadow status line, so
 * it can't be reached or restyled by the page, and triggers no navigation.
 */
function showNoProviderPrompt(status: HTMLElement): void {
  status.textContent = ' Configure an AI provider in Settings';
  status.setAttribute('data-aft-no-provider', '1');
  setTimeout(() => {
    if (status.getAttribute('data-aft-no-provider') === '1') {
      status.removeAttribute('data-aft-no-provider');
      status.textContent = '';
    }
  }, 4000);
}

function buildStyle(): HTMLStyleElement {
  const s = document.createElement('style');
  s.textContent = `
    :host { all: initial; }
    .wrap {
      pointer-events: auto;
      display: inline-flex; align-items: center; gap: 6px;
      font: 12px/1.2 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    }
    .suggest {
      pointer-events: auto;
      background: #0f172a;
      color: #f8fafc;
      border: 1px solid rgba(255,255,255,0.1);
      padding: 4px 10px;
      border-radius: 999px;
      cursor: pointer;
      font: inherit;
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    }
    .suggest:hover { background: #1e293b; }
    .suggest:disabled { opacity: 0.6; cursor: default; }
    .status { color: #64748b; }
  `;
  return s;
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}
