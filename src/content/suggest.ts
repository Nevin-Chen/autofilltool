import type { DetectedField } from '@/adapters/types';
import type { JobContext } from './job-context';
import type { Settings } from '@/profile/schema';
import { getSettings } from '@/profile/store';
import { setNativeValue, dispatchInputEvents } from '@/lib/events';
import { fieldDescription } from '@/adapters/_shared';
import { AI_PORT_NAME, type AiBgToClient } from '@/types/ai-port';

const HOST_DATA_ATTR = 'data-autofilltool-suggest-host';

export function aiConfigured(settings: Settings): boolean {
  return settings.ai.provider !== 'none';
}

export type InstallSuggestOptions = {
  aiConfigured: boolean;
};

export function installSuggestButtons(
  fields: DetectedField[],
  ctx: JobContext,
  opts: InstallSuggestOptions,
): void {
  if (!opts.aiConfigured) return;
  for (const field of fields) {
    if (field.kind !== 'openEnded' && field.kind !== 'coverLetter') continue;
    if (!(field.el instanceof HTMLTextAreaElement)) continue;
    if (field.el.dataset[CAMEL_FLAG]) continue;
    field.el.dataset[CAMEL_FLAG] = '1';
    attachButtonFor(field.el, field.label, fieldDescription(field.el), ctx);
  }
}

export async function guardedConnect(deps: {
  loadSettings: () => Promise<Settings>;
  connect: () => chrome.runtime.Port;
  onNoProvider: () => void;
  onReady?: (settings: Settings) => void;
}): Promise<chrome.runtime.Port | null> {
  let settings: Settings;
  try {
    settings = await deps.loadSettings();
  } catch {
    deps.onNoProvider();
    return null;
  }
  if (!aiConfigured(settings)) {
    deps.onNoProvider();
    return null;
  }
  deps.onReady?.(settings);
  return deps.connect();
}

const CAMEL_FLAG = 'autofilltoolSuggestBound';

export type SuggestMode = 'append' | 'replace';

export function seedForMode(current: string, mode: SuggestMode): string {
  if (mode === 'replace') return '';
  if (current.trim().length === 0) return '';
  return current.replace(/\s+$/, '') + '\n\n';
}

type PillHandlers = {
  onActivate: () => void;
  onAppend: () => void;
  onReplace: () => void;
};

type PillState =
  | { kind: 'idle'; hasText: boolean }
  | { kind: 'working'; label: string }
  | { kind: 'failure'; message?: string }
  | { kind: 'no-provider' };

function renderState(
  mount: HTMLElement,
  state: PillState,
  handlers: PillHandlers,
): void {
  mount.replaceChildren();

  if (state.kind === 'failure') {
    const group = document.createElement('div');
    group.className = 'pill-failure';
    group.setAttribute('role', 'group');
    group.setAttribute('aria-label', state.message ?? 'AI request failed');

    const failed = document.createElement('span');
    failed.className = 'seg failed';
    failed.title = state.message ?? '';
    failed.textContent = '⚠ Failed';

    const retry = document.createElement('button');
    retry.type = 'button';
    retry.className = 'seg retry';
    retry.textContent = '↻ Retry';
    retry.addEventListener('click', handlers.onActivate);

    group.append(failed, retry);
    mount.append(group);
    return;
  }

  if (state.kind === 'idle') {
    mount.append(buildIdlePill(state.hasText, handlers));
    return;
  }

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'pill';
  btn.addEventListener('click', handlers.onActivate);

  if (state.kind === 'working') {
    btn.classList.add('working');
    const stop = document.createElement('span');
    stop.className = 'stop-x';
    stop.textContent = '×';
    const dots = document.createElement('span');
    dots.className = 'dots';
    dots.setAttribute('aria-hidden', 'true');
    dots.append(
      document.createElement('i'),
      document.createElement('i'),
      document.createElement('i'),
    );
    const label = document.createElement('span');
    label.textContent = state.label;
    btn.append(stop, dots, label);
    btn.title = 'Stop drafting';
    btn.setAttribute('aria-label', 'Stop drafting');
  } else if (state.kind === 'no-provider') {
    btn.classList.add('no-provider');
    btn.textContent = 'Configure AI in Settings';
    btn.disabled = true;
  }

  mount.append(btn);
}

const SVG_NS = 'http://www.w3.org/2000/svg';

function buildAutofillIcon(): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('width', '13');
  svg.setAttribute('height', '13');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.7');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  for (const d of ['M3 4 L7.5 8 L3 12', 'M8.5 4 L13 8 L8.5 12']) {
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', d);
    svg.appendChild(path);
  }
  return svg;
}

function buildIdlePill(hasText: boolean, handlers: PillHandlers): HTMLElement {
  if (!hasText) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'pill';
    btn.title = 'Draft an answer with AI';
    const icon = document.createElement('span');
    icon.className = 'icon';
    icon.appendChild(buildAutofillIcon());
    btn.append(icon, document.createTextNode('Autofill'));
    btn.addEventListener('click', handlers.onReplace);
    return btn;
  }

  const group = document.createElement('div');
  group.className = 'pill-menu';

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'pill';
  btn.title = 'Choose how to autofill';
  btn.setAttribute('aria-haspopup', 'menu');
  btn.setAttribute('aria-expanded', 'false');
  const icon = document.createElement('span');
  icon.className = 'icon';
  icon.appendChild(buildAutofillIcon());
  const caret = document.createElement('span');
  caret.className = 'caret-glyph';
  caret.setAttribute('aria-hidden', 'true');
  caret.textContent = '▾';
  btn.append(icon, document.createTextNode('Autofill'), caret);

  const menu = document.createElement('div');
  menu.className = 'menu';
  menu.setAttribute('role', 'menu');
  menu.hidden = true;

  let outside: ((e: Event) => void) | null = null;
  const closeMenu = () => {
    menu.hidden = true;
    btn.setAttribute('aria-expanded', 'false');
    if (outside) {
      window.removeEventListener('pointerdown', outside, true);
      outside = null;
    }
  };
  const openMenu = () => {
    menu.hidden = false;
    btn.setAttribute('aria-expanded', 'true');

    outside = (e: Event) => {
      const root = menu.getRootNode();
      const host = root instanceof ShadowRoot ? root.host : null;
      const path = typeof e.composedPath === 'function' ? e.composedPath() : [];
      if (host && !path.includes(host)) closeMenu();
    };
    window.addEventListener('pointerdown', outside, true);
  };

  const item = (text: string, run: () => void): HTMLButtonElement => {
    const it = document.createElement('button');
    it.type = 'button';
    it.className = 'menu-item';
    it.setAttribute('role', 'menuitem');
    it.textContent = text;
    it.addEventListener('click', () => {
      closeMenu();
      run();
    });
    return it;
  };
  menu.append(
    item('Add to answer', handlers.onAppend),
    item('Start over', handlers.onReplace),
  );

  btn.addEventListener('click', () => {
    if (menu.hidden) openMenu();
    else closeMenu();
  });

  group.append(btn, menu);
  return group;
}

function attachButtonFor(
  textarea: HTMLTextAreaElement,
  label: string,
  description: string,
  ctx: JobContext,
): void {
  const host = document.createElement('div');
  host.setAttribute(HOST_DATA_ATTR, '');
  Object.assign(host.style, {
    position: 'absolute',
    zIndex: '2147483646',
    pointerEvents: 'none',
  } as CSSStyleDeclaration);

  const shadow = host.attachShadow({ mode: 'closed' });
  shadow.appendChild(buildStyle());
  const wrap = document.createElement('div');
  wrap.className = 'wrap';
  shadow.appendChild(wrap);

  const reposition = () => {
    const r = textarea.getBoundingClientRect();
    const pillWidth = wrap.getBoundingClientRect().width || 96;
    host.style.left = `${window.scrollX + r.right - pillWidth - 8}px`;
    host.style.top = `${window.scrollY + r.bottom - 28}px`;
  };

  let currentPort: chrome.runtime.Port | null = null;
  let streaming = false;
  let autoResetTimer: ReturnType<typeof setTimeout> | null = null;

  const clearAutoReset = () => {
    if (autoResetTimer !== null) {
      clearTimeout(autoResetTimer);
      autoResetTimer = null;
    }
  };

  const handlers: PillHandlers = {
    onActivate: () => void onActivate(),
    onAppend: () => void onActivate('append'),
    onReplace: () => void onActivate('replace'),
  };

  const setIdle = () => {
    clearAutoReset();
    renderState(
      wrap,
      { kind: 'idle', hasText: textarea.value.trim().length > 0 },
      handlers,
    );
    reposition();
  };
  const setWorking = (label: string) => {
    clearAutoReset();
    renderState(wrap, { kind: 'working', label }, handlers);
    reposition();
  };
  const setFailure = (message?: string) => {
    clearAutoReset();
    renderState(
      wrap,
      message !== undefined ? { kind: 'failure', message } : { kind: 'failure' },
      handlers,
    );
    autoResetTimer = setTimeout(setIdle, 8000);
    reposition();
  };
  const setNoProvider = () => {
    clearAutoReset();
    renderState(wrap, { kind: 'no-provider' }, handlers);
    autoResetTimer = setTimeout(setIdle, 4000);
    reposition();
  };

  document.body.appendChild(host);
  setIdle();
  reposition();
  window.addEventListener('scroll', reposition, { passive: true });
  window.addEventListener('resize', reposition);

  const resetStream = () => {
    streaming = false;
    currentPort = null;
  };

  async function onActivate(mode: SuggestMode = 'replace'): Promise<void> {
    if (streaming && currentPort) {
      try {
        currentPort.postMessage({ kind: 'cancel' });
        currentPort.disconnect();
      } catch {
      }
      resetStream();
      setIdle();
      return;
    }

    const ready = { provider: 'none' as Settings['ai']['provider'] };
    const port = await guardedConnect({
      loadSettings: getSettings,
      connect: () => chrome.runtime.connect({ name: AI_PORT_NAME }),
      onNoProvider: setNoProvider,
      onReady: (s) => {
        ready.provider = s.ai.provider;
      },
    });
    if (!port) return;
    currentPort = port;

    setNativeValue(textarea, seedForMode(textarea.value, mode));
    dispatchInputEvents(textarea);

    streaming = true;

    setWorking(ready.provider === 'ollama' ? 'Loading model' : 'Thinking');
    let firstDelta = true;

    port.onMessage.addListener((raw: AiBgToClient) => {
      if (raw.kind === 'delta') {
        if (firstDelta) {
          firstDelta = false;
          setWorking('Writing');
        }
        setNativeValue(textarea, textarea.value + raw.text);
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
      } else if (raw.kind === 'done') {
        dispatchInputEvents(textarea);
        resetStream();
        try {
          port.disconnect();
        } catch {
        }
        setIdle();
      } else if (raw.kind === 'error') {
        resetStream();
        try {
          port.disconnect();
        } catch {
        }
        setFailure(truncate(raw.message, 80));
      }
    });
    port.onDisconnect.addListener(() => {
      if (streaming) {
        resetStream();
        setFailure('Disconnected');
      }
    });

    const maxChars =
      textarea.maxLength > 0 && textarea.maxLength < 100000 ? textarea.maxLength : undefined;
    port.postMessage({
      kind: 'start',
      req: {
        question: label || textarea.name || 'Open-ended question',
        label,
        ...(description ? { description } : {}),
        ...(ctx.company || ctx.role
          ? { job: { company: ctx.company, role: ctx.role, jobUrl: ctx.jobUrl } }
          : {}),
        ...(ctx.jobDescription ? { jobDescription: ctx.jobDescription } : {}),
        ...(maxChars ? { maxChars } : {}),
      },
    });
  }
}

function buildStyle(): HTMLStyleElement {
  const s = document.createElement('style');
  s.textContent = `
    :host { all: initial; }
    .wrap {
      pointer-events: auto;
      display: inline-flex; align-items: center;
      font: 12px/1.2 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    }

    .pill {
      pointer-events: auto;
      display: inline-flex; align-items: center; gap: 5px;
      background: #0f172a; color: #f8fafc;
      border: 1px solid rgba(255,255,255,0.10);
      padding: 5px 11px; border-radius: 999px;
      cursor: pointer; font: inherit; font-weight: 700;
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
      transition: background .15s ease;
    }
    .pill:hover { background: #1e293b; }
    .pill:disabled { opacity: 0.6; cursor: default; }
    .pill .icon { color: #7dd3fc; line-height: 0; display: inline-flex; align-items: center; }

    .pill.working { padding: 5px 11px 5px 9px; }
    .pill.working .stop-x { color: #f8fafc; font-weight: 700; font-size: 14px; line-height: 1; padding: 0 1px; }
    .pill.working .dots { display: inline-flex; gap: 3px; align-items: center; color: #7dd3fc; }
    .pill.working .dots i {
      width: 4px; height: 4px; border-radius: 50%; background: currentColor;
      opacity: 0.6;
    }
    @media (prefers-reduced-motion: no-preference) {
      .pill.working .dots i {
        animation: aft-dot 1.2s ease-in-out infinite;
      }
      .pill.working .dots i:nth-child(2) { animation-delay: .15s; }
      .pill.working .dots i:nth-child(3) { animation-delay: .30s; }
    }
    @keyframes aft-dot {
      0%,80%,100% { opacity: .3; transform: scale(.85); }
      40% { opacity: 1; transform: scale(1); }
    }

    .pill-failure {
      pointer-events: auto;
      display: inline-flex; align-items: stretch;
      background: #0f172a; border-radius: 999px;
      border: 1px solid rgba(255,255,255,0.10);
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
      overflow: hidden;
      font: 700 12px/1.2 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    }
    .pill-failure .seg {
      display: inline-flex; align-items: center; gap: 5px;
      background: transparent; border: none; color: inherit;
      padding: 5px 11px; font: inherit; cursor: default;
    }
    .pill-failure .seg.failed { color: #fca5a5; }
    .pill-failure .seg.retry {
      color: #f8fafc; cursor: pointer;
      border-left: 1px solid rgba(255,255,255,0.10);
    }
    .pill-failure .seg.retry:hover { background: rgba(255,255,255,0.06); }

    .pill.no-provider { background: #1e293b; }

    .pill-menu {
      pointer-events: auto;
      position: relative;
      display: inline-flex;
    }
    .pill-menu .caret-glyph { font-size: 11px; opacity: 0.85; margin-left: -2px; }

    .menu {
      position: absolute; top: calc(100% + 6px); right: 0;
      min-width: 150px;
      display: flex; flex-direction: column;
      background: #0f172a; color: #f8fafc;
      border: 1px solid rgba(255,255,255,0.12);
      border-radius: 10px;
      box-shadow: 0 8px 24px rgba(0,0,0,0.30);
      padding: 4px;
    }
    .menu[hidden] { display: none; }
    .menu-item {
      text-align: left; background: transparent; border: none; color: inherit;
      font: inherit; font-weight: 600; cursor: pointer;
      padding: 7px 9px; border-radius: 7px; white-space: nowrap;
    }
    .menu-item:hover { background: #1e293b; }
  `;
  return s;
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}
