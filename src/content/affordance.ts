/** Proactive in-page fill trigger (FAB) with idle/filling/done phases. */
// Reuses the pill's nav style (navy card, sky accents) + brand icon.
// Buttons in closed Shadow DOM; idempotent injection, dismissible per-page.

import type { AdapterId } from '@/profile/schema';

const HOST_ID = 'autofilltool-trigger-host';

export type TriggerResume =
  | 'attached'
  | 'notFound'
  | 'noResume'
  | 'noHook'
  | 'skipped';

export type TriggerStats = {
  filled: number;
  skipped: number;
  failed: number;
  suggest: number;
  adapterId: AdapterId;
  adapterName: string;
  resume: TriggerResume;
  autoLogging: boolean;
};

/**
 * Groups the user can step through after a fill. "filled" = double-check sweep,
 * "skipped" = manual TODOs, "suggest" = open-ended fields awaiting AI.
 */
export type ReviewGroup = 'filled' | 'skipped' | 'suggest';

export type ReviewableField = {
  group: ReviewGroup;
  label: string;
  /** Live ref on the page — checked with isConnected before scroll/highlight. */
  el: HTMLElement;
};

export type RemoteReviewCallbacks = {
  onEnter: (group: ReviewGroup) => void;
  onStep: (dir: 1 | -1) => void;
  onExit: () => void;
};

export type RemoteReviewState = {
  group: ReviewGroup;
  index: number;
  total: number;
  label: string;
};

type Phase = 'idle' | 'filling' | 'done';

type State = {
  host: HTMLElement;
  shadow: ShadowRoot;
  body: HTMLElement;
  phase: Phase;
  detected: number;
  onFill: () => void;
  stats: TriggerStats | null;
  progress: { done: number; total: number } | null;
  items: ReviewableField[];
  review: { group: ReviewGroup; index: number } | null;
  remoteCallbacks: RemoteReviewCallbacks | null;
  remoteReview: RemoteReviewState | null;
};

let state: State | null = null;
let dismissedThisPage = false;
const MAX_MOUNT_ATTEMPTS = 2;
const REMOUNT_MS = 1000;
let mountAttempts = 0;

export function showFillTrigger(opts: {
  detected: number;
  onFill: () => void;
}): void {
  if (dismissedThisPage) return;
  const s = ensureHost();
  s.detected = opts.detected;
  s.onFill = opts.onFill;
  if (s.phase !== 'filling' && s.phase !== 'done') s.phase = 'idle';
  render();
}

export function setFillTriggerFilling(): void {
  const s = ensureHost();
  s.phase = 'filling';
  s.progress = null;
  render();
}

export function setFillTriggerProgress(done: number, total: number): void {
  if (!state) return;
  state.progress = { done, total };
  const bar = state.shadow.querySelector('.track .fill') as HTMLElement | null;
  const count = state.shadow.querySelector('.count') as HTMLElement | null;
  if (bar && total > 0) bar.style.width = `${Math.max(8, Math.round((done / total) * 100))}%`;
  if (count) count.textContent = `${done} / ${total} fields`;
}

export function showFillTriggerDone(
  stats: TriggerStats,
  items: ReviewableField[] = [],
  opts: { remote?: RemoteReviewCallbacks } = {},
): void {
  const s = ensureHost();
  s.phase = 'done';
  s.stats = stats;
  s.items = items;
  s.review = null;
  s.remoteCallbacks = opts.remote ?? null;
  s.remoteReview = null;
  render();
}

export function setRemoteReviewState(state_: RemoteReviewState): void {
  if (!state) return;
  state.remoteReview = state_;
  render();
  focusReviewPane();
}

export function clearRemoteReviewState(): void {
  if (!state) return;
  state.remoteReview = null;
  render();
}

export function removeFillTrigger(): void {
  document.getElementById(HOST_ID)?.remove();
  state = null;
  mountAttempts = 0;
}

export function __resetAffordanceForTests(): void {
  document.getElementById(HOST_ID)?.remove();
  state = null;
  dismissedThisPage = false;
  mountAttempts = 0;
}

export function __getReviewStateForTests(): {
  group: ReviewGroup;
  index: number;
} | null {
  return state?.review ? { ...state.review } : null;
}

export function __enterReviewForTests(group: ReviewGroup): void {
  enterReview(group);
}

export function __stepReviewForTests(dir: 1 | -1): void {
  stepReview(dir);
}

export function __getDoneNoteForTests(): { text: string; href: string | null } | null {
  const noteEl = state?.shadow.querySelector('.note');
  if (!noteEl) return null;
  const link = noteEl.querySelector<HTMLAnchorElement>('a.note-link');
  return {
    text: (noteEl.textContent ?? '').trim(),
    href: link?.getAttribute('href') ?? null,
  };
}

export function __clickRemoteChipForTests(group: ReviewGroup): boolean {
  const btn = state?.shadow.querySelector<HTMLButtonElement>(
    `button.chip.clickable[data-group="${group}"]`,
  );
  if (!btn) return false;
  btn.click();
  return true;
}

export function __getReviewPaneTextForTests(): string | null {
  const counter = state?.shadow.querySelector('.review .sub') as HTMLElement | null;
  return counter ? (counter.textContent ?? '').trim() : null;
}

export function __pressReviewKeyForTests(key: 'ArrowLeft' | 'ArrowRight' | 'Escape'): boolean {
  const pane = state?.shadow.querySelector('.review') as HTMLElement | null;
  if (!pane) return false;
  pane.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  return true;
}

function ensureHost(): State {
  if (state && document.getElementById(HOST_ID)) return state;
  document.getElementById(HOST_ID)?.remove();

  const host = document.createElement('div');
  host.id = HOST_ID;
  Object.assign(host.style, {
    all: 'initial',
    position: 'fixed',
    right: '16px',
    bottom: '16px',
    zIndex: '2147483647',
  } as CSSStyleDeclaration);

  const shadow = host.attachShadow({ mode: 'closed' });
  shadow.appendChild(buildStyle());

  const body = document.createElement('div');
  shadow.appendChild(body);

  (document.body ?? document.documentElement).appendChild(host);
  mountAttempts++;

  state = {
    host,
    shadow,
    body,
    phase: 'idle',
    detected: 0,
    onFill: () => {},
    stats: null,
    progress: null,
    items: [],
    review: null,
    remoteCallbacks: null,
    remoteReview: null,
  };
  scheduleMountWatchdog(host);
  return state;
}

function scheduleMountWatchdog(host: HTMLElement): void {
  setTimeout(() => {
    if (dismissedThisPage) return;
    if (!state) return;
    if (host.isConnected) return;
    if (mountAttempts >= MAX_MOUNT_ATTEMPTS) return;
    const detected = state.detected;
    const onFill = state.onFill;
    state = null;
    showFillTrigger({ detected, onFill });
  }, REMOUNT_MS);
}

function collapse(): void {
  if (!state) return;
  state.phase = 'idle';
  render();
}

function dismiss(): void {
  dismissedThisPage = true;
  removeFillTrigger();
}

function render(): void {
  if (!state) return;
  state.body.innerHTML = '';
  const idle = state.phase === 'idle';
  state.body.className = idle ? '' : 'card';
  state.body.append(idle ? renderIdlePill() : renderCard());
}

function renderCard(): HTMLElement {
  const s = state!;
  const localReview = s.phase === 'done' && s.review !== null;
  const remoteReview = s.phase === 'done' && s.remoteReview !== null;
  const inReview = localReview || remoteReview;
  const activeGroup = localReview ? s.review!.group : s.remoteReview?.group;
  const title = inReview && activeGroup
    ? reviewTitle(activeGroup)
    : s.phase === 'done'
      ? 'Filled'
      : 'AutoFillTool';
  const header = h('div', { class: 'row between head' }, [
    h('div', { class: 'row gap-sm' }, [
      brandMark(20),
      h('span', { class: 'title' }, [title]),
    ]),
    iconBtn('×', 'Collapse', collapse),
  ]);

  const content =
    s.phase === 'filling' ? renderFilling() : inReview ? renderReview() : renderDone();
  return frag([header, content]);
}

function reviewTitle(g: ReviewGroup): string {
  switch (g) {
    case 'filled':
      return 'Reviewing filled';
    case 'skipped':
      return 'Reviewing skipped';
    case 'suggest':
      return 'Reviewing to Suggest';
  }
}

function renderIdlePill(): HTMLElement {
  const s = state!;
  const tab = document.createElement('button');
  tab.type = 'button';
  tab.className = 'tab';
  tab.title = 'Fill this page with AutoFillTool';
  tab.append(brandMark(18), h('span', { class: 'tab-label' }, ['Fill this page']));
  tab.addEventListener('click', () => s.onFill());
  return tab;
}

function renderFilling(): HTMLElement {
  const s = state!;
  const label = h('div', { class: 'sub light' }, ['Filling fields…']);
  const bar = h('div', { class: 'track' }, [h('div', { class: 'fill' }, [])]);
  const inner = bar.firstElementChild as HTMLElement;

  if (s.progress) {
    const { done, total } = s.progress;
    const pct = total > 0 ? Math.max(8, Math.round((done / total) * 100)) : 8;
    inner.style.width = `${pct}%`;
    const count = h('div', { class: 'sub count' }, [`${done} / ${total} fields`]);
    return frag([label, bar, count]);
  }

  inner.style.width = '8%';
  requestAnimationFrame(() => {
    inner.style.width = '92%';
  });
  return frag([label, bar]);
}

function renderDone(): HTMLElement {
  const s = state!;
  const st = s.stats ?? {
    filled: 0,
    skipped: 0,
    failed: 0,
    suggest: 0,
    adapterId: 'generic' as AdapterId,
    adapterName: 'generic',
    resume: 'noResume' as TriggerResume,
    autoLogging: false,
  };

  const chips = h('div', { class: 'row gap chips' }, [
    reviewChip('ok', 'filled', `✓ ${st.filled} filled`),
    ...(st.skipped > 0 ? [reviewChip('skip', 'skipped', `${st.skipped} skipped`)] : []),
    ...(st.failed > 0 ? [chip('fail', `${st.failed} failed`)] : []),
    ...(st.suggest > 0 ? [reviewChip('ai', 'suggest', `✨ ${st.suggest} to Suggest`)] : []),
  ]);

  const resume = resumeLine(st.resume);
  const note = autoLogNote(st.autoLogging);

  const actions = h('div', { class: 'row gap top' }, [
    btn({ class: 'ghost', text: 'Dismiss', onClick: dismiss }),
  ]);

  return frag([chips, ...(resume ? [resume] : []), note, actions]);
}

const SHEETS_DOCS_URL =
  'https://github.com/Nevin-Chen/autofilltool#google-sheets-logging';

function autoLogNote(autoLogging: boolean): HTMLElement {
  if (autoLogging) {
    return h('div', { class: 'row note' }, [
      clockGlyph(),
      h('span', {}, ['Auto-logging with Google Sheets.']),
    ]);
  }
  const link = document.createElement('a');
  link.href = SHEETS_DOCS_URL;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.className = 'note-link';
  link.textContent = 'Connect a Google Sheet';
  return h('div', { class: 'row note' }, [
    clockGlyph(),
    h('span', {}, [link, ' to auto-log applications.']),
  ]);
}

function resumeLine(state_: TriggerResume): HTMLElement | null {
  switch (state_) {
    case 'attached':
      return h('div', { class: 'sub' }, [chip('ok', 'Resume attached')]);
    case 'skipped':
      return h('div', { class: 'sub' }, [chip('ok', 'Resume already attached')]);
    case 'notFound':
      return h('div', { class: 'sub' }, [chip('skip', 'Resume: no slot on this page')]);
    default:
      return null;
  }
}

function h(
  tag: string,
  attrs: Record<string, string> = {},
  children: Array<Node | string> = [],
): HTMLElement {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  for (const c of children) el.append(typeof c === 'string' ? document.createTextNode(c) : c);
  return el;
}

/** Wrap children without an extra styled box (the card itself is the box). */
function frag(children: Array<Node>): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'stack';
  for (const c of children) wrap.append(c);
  return wrap;
}

function btn(opts: {
  text: string;
  onClick: () => void;
  class?: string;
  title?: string;
}): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = opts.text;
  if (opts.class) b.className = opts.class;
  if (opts.title) b.title = opts.title;
  b.addEventListener('click', opts.onClick);
  return b;
}

function iconBtn(text: string, title: string, onClick: () => void): HTMLButtonElement {
  return btn({ class: 'icon', text, title, onClick });
}

function chip(kind: 'ok' | 'skip' | 'fail' | 'ai', text: string): HTMLElement {
  return h('span', { class: `chip ${kind}` }, [text]);
}

function reviewChip(
  kind: 'ok' | 'skip' | 'ai',
  group: ReviewGroup,
  text: string,
): HTMLElement {
  const remote = state?.remoteCallbacks ?? null;
  const has = remote ? remoteCountFor(group) > 0 : itemsInGroup(group).some((i) => i.el.isConnected);
  if (!has) return chip(kind, text);
  const b = document.createElement('button');
  b.type = 'button';
  b.className = `chip ${kind} clickable`;
  b.setAttribute('data-group', group);
  b.textContent = text;
  b.title = 'Step through these fields';
  b.addEventListener('click', () => (remote ? enterRemoteReview(group, remote) : enterReview(group)));
  return b;
}

function remoteCountFor(group: ReviewGroup): number {
  const stats = state?.stats;
  if (!stats) return 0;
  switch (group) {
    case 'filled':
      return stats.filled;
    case 'skipped':
      return stats.skipped;
    case 'suggest':
      return stats.suggest;
  }
}

function itemsInGroup(group: ReviewGroup): ReviewableField[] {
  return (state?.items ?? []).filter((i) => i.group === group);
}

function enterReview(group: ReviewGroup): void {
  if (!state) return;
  const items = itemsInGroup(group);
  const first = nextConnected(items, -1, 1);
  if (first === -1) return; // nothing live to review
  state.review = { group, index: first };
  render();
  focusReviewPane();
  spotlight(items[first]!.el);
}

function exitReview(): void {
  if (!state) return;
  state.review = null;
  render();
}

function stepReview(dir: 1 | -1): void {
  if (!state || !state.review) return;
  const items = itemsInGroup(state.review.group);
  const next = nextConnected(items, state.review.index, dir);
  if (next === -1) {
    exitReview();
    return;
  }
  state.review.index = next;
  render();
  focusReviewPane();
  spotlight(items[next]!.el);
}

function enterRemoteReview(group: ReviewGroup, callbacks: RemoteReviewCallbacks): void {
  if (!state) return;
  state.remoteReview = { group, index: 0, total: remoteCountFor(group), label: 'Loading…' };
  render();
  focusReviewPane();
  callbacks.onEnter(group);
}

function stepRemoteReview(dir: 1 | -1): void {
  state?.remoteCallbacks?.onStep(dir);
}

function exitRemoteReview(): void {
  if (!state) return;
  state.remoteCallbacks?.onExit();
  state.remoteReview = null;
  render();
}

export function nextConnected(
  items: ReviewableField[],
  from: number,
  dir: 1 | -1,
): number {
  const n = items.length;
  if (n === 0) return -1;
  for (let step = 1; step <= n; step++) {
    const i = ((from + dir * step) % n + n) % n;
    if (items[i]!.el.isConnected) return i;
  }
  return -1;
}

function renderReview(): HTMLElement {
  const s = state!;
  const remote = s.remoteReview;
  const display = remote
    ? { index: remote.index, total: remote.total, label: remote.label }
    : (() => {
        const { group, index } = s.review!;
        const items = itemsInGroup(group);
        const current = items[index]!;
        return { index, total: items.length, label: current.label };
      })();

  const counter = h('div', { class: 'sub' }, [
    `${display.index + 1} of ${display.total} · ${truncate(display.label, 60)}`,
  ]);
  const help = h('div', { class: 'sub light' }, ['← / → to step · Esc to exit']);
  const stepFn = remote ? stepRemoteReview : stepReview;
  const exitFn = remote ? exitRemoteReview : exitReview;
  const actions = h('div', { class: 'row gap top' }, [
    btn({ class: 'ghost', text: '← Prev', onClick: () => stepFn(-1) }),
    btn({ class: 'ghost', text: 'Next →', onClick: () => stepFn(1) }),
    btn({ class: 'ghost', text: 'Done', onClick: exitFn }),
  ]);

  const pane = h('div', { class: 'review', tabindex: '0' }, [counter, help, actions]);
  pane.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      stepFn(1);
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      stepFn(-1);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      exitFn();
    }
  });
  return pane;
}

function focusReviewPane(): void {
  if (!state) return;
  const pane = state.shadow.querySelector('.review') as HTMLElement | null;
  pane?.focus();
}

const SPOTLIGHT_MS = 1400;
const SPOTLIGHT_SHADOW =
  '0 0 0 2px rgba(56,189,248,0.95), 0 0 10px 3px rgba(56,189,248,0.5)';
export function spotlight(el: HTMLElement): void {
  try {
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    const style = el.style;
    const prevShadow = style.boxShadow;
    const prevTransition = style.transition;
    style.transition = `box-shadow 400ms ease-out`;
    style.boxShadow = SPOTLIGHT_SHADOW;
    setTimeout(() => {
      try {
        style.boxShadow = prevShadow;
        setTimeout(() => {
          try {
            style.transition = prevTransition;
          } catch {
          }
        }, 400);
      } catch {
      }
    }, SPOTLIGHT_MS);
  } catch {
  }
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

function brandMark(size: number): SVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('viewBox', '0 0 128 128');
  svg.style.flex = '0 0 auto';
  svg.style.display = 'block';
  svg.innerHTML =
    '<rect width="128" height="128" rx="24" fill="#0f172a"/>' +
    '<rect x="22" y="30" width="84" height="16" rx="4" fill="#1e3a52"/>' +
    '<rect x="26" y="34" width="46" height="8" rx="2" fill="#38bdf8"/>' +
    '<rect x="22" y="56" width="84" height="16" rx="4" fill="#1e3a52"/>' +
    '<rect x="26" y="60" width="60" height="8" rx="2" fill="#38bdf8"/>' +
    '<rect x="22" y="82" width="84" height="16" rx="4" fill="#1e3a52"/>' +
    '<rect x="26" y="86" width="32" height="8" rx="2" fill="#38bdf8"/>' +
    '<rect x="60" y="84" width="3" height="12" fill="#38bdf8"/>';
  return svg;
}

function clockGlyph(): SVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('width', '13');
  svg.setAttribute('height', '13');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', '#94a3b8');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.style.flex = '0 0 auto';
  svg.style.marginTop = '1px';
  svg.innerHTML = '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>';
  return svg;
}

function buildStyle(): HTMLStyleElement {
  const s = document.createElement('style');
  s.textContent = `
    :host { all: initial; }
    .card {
      display: block;
      font: 13px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: #0f172a;
      color: #e2e8f0;
      border-radius: 12px;
      box-shadow: 0 12px 30px rgba(0,0,0,0.28);
      padding: 14px 16px;
      width: 340px;
      box-sizing: border-box;
      border: 1px solid rgba(255,255,255,0.06);
    }
    .stack > * + * { margin-top: 10px; }
    .row { display: flex; align-items: center; }
    .row.between { justify-content: space-between; }
    .row.gap > * + * { margin-left: 6px; }
    .row.gap-sm > * + * { margin-left: 9px; }
    .row.top { margin-top: 10px; }
    .head { margin-bottom: 2px; }
    .title { font-weight: 700; color: #f8fafc; font-size: 14px; }
    .sub { color: #94a3b8; font-size: 12.5px; }
    .sub.light { color: #cbd5e1; }
    .sub strong { color: #cbd5e1; }
    .chips { display: flex; justify-content: space-around; }
    .chip {
      font-size: 11.5px; padding: 2px 7px; border-radius: 999px;
      background: rgba(255,255,255,0.06); color: #cbd5e1; font-weight: 600;
      white-space: nowrap;
    }
    .chip.ok   { color: #34d399; }
    .chip.skip { color: #94a3b8; }
    .chip.fail { color: #fb7185; }
    .chip.ai   { color: #7dd3fc; }
    button.chip.clickable {
      border: 1px solid rgba(255,255,255,0.10);
      font: inherit; font-weight: 600;
    }
    button.chip.clickable:hover { background: rgba(255,255,255,0.10); }
    button.chip.clickable:focus-visible {
      outline: 2px solid #38bdf8; outline-offset: 2px;
    }
    .review { outline: none; }
    .review:focus-visible { outline: none; }
    .note {
      align-items: flex-start; gap: 7px;
      font-size: 11.5px; color: #94a3b8; line-height: 1.45;
    }
    .note strong { color: #cbd5e1; }
    .note-link {
      color: #7dd3fc; text-decoration: underline; cursor: pointer;
    }
    .note-link:hover { color: #bae6fd; }
    .track {
      height: 5px; border-radius: 999px; background: rgba(255,255,255,0.08);
      overflow: hidden;
    }
    .track .fill {
      height: 100%; width: 8%; border-radius: 999px;
      background: linear-gradient(90deg,#38bdf8,#0ea5e9);
      transition: width .55s ease;
    }
    button { font: inherit; border-radius: 10px; cursor: pointer; }
    button.primary {
      display: inline-flex; align-items: center; justify-content: center; gap: 7px;
      padding: 9px 14px; font-size: 13.5px; font-weight: 700;
      color: #fff; background: #0284c7; border: 1px solid #0369a1;
      white-space: nowrap; line-height: 1;
    }
    button.primary:hover { background: #0ea5e9; }
    button.primary.full { width: 100%; }
    button.ghost {
      padding: 7px 12px; font-size: 12.5px; font-weight: 600;
      background: transparent; color: #cbd5e1; border: 1px solid rgba(255,255,255,0.12);
    }
    button.ghost:hover { background: rgba(255,255,255,0.04); }
    button.icon {
      background: transparent; color: #94a3b8; border: none;
      font-size: 16px; line-height: 1; padding: 2px 6px; border-radius: 6px;
    }
    button.icon:hover { color: #f8fafc; }
    /* Idle pill — tucked flush into the right edge, a little above centre.
       Uses its own fixed anchor (not the host's bottom-right) so it reads as a
       slim hand-tab; clicking it fills and the card takes over bottom-right. */
    button.tab {
      position: fixed; right: 0; bottom: 16vh;
      display: inline-flex; align-items: center; gap: 8px;
      font: 13px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      font-weight: 600;
      background: #0f172a; color: #e2e8f0;
      border: 1px solid rgba(255,255,255,0.08); border-right: none;
      border-radius: 12px 0 0 12px;
      box-shadow: 0 10px 26px rgba(0,0,0,0.30);
      padding: 11px 16px 11px 14px;
    }
    button.tab:hover { color: #f8fafc; }
    button.tab:hover .tab-label { color: #f8fafc; }
  `;
  return s;
}
