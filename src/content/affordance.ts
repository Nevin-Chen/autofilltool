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
  ai?: number;
  aiPending?: number;
  adapterId: AdapterId;
  adapterName: string;
  resume: TriggerResume;
  autoLogging: boolean;
};

export type ReviewGroup = 'filled' | 'skipped' | 'suggest' | 'ai';

export type ReviewableField = {
  group: ReviewGroup;
  label: string;
  el: HTMLElement;
  note?: string;
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
  note?: string;
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
  aiQueueOriginal: number;
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
  s.aiQueueOriginal = 0;
  render();
}

export function setRemoteReviewState(state_: RemoteReviewState): void {
  if (!state) return;
  state.remoteReview = state_;
  render();
  focusReviewPane();
}

export function setAiFallbackProgress(
  filled: number,
  pending: number,
  newAiItems: ReviewableField[] = [],
  opts: { decrementSkippedBy?: number; incrementSkippedBy?: number } = {},
): void {
  if (!state || state.phase !== 'done' || !state.stats) return;
  state.stats = { ...state.stats, ai: filled, aiPending: pending };
  state.aiQueueOriginal = Math.max(state.aiQueueOriginal, filled + pending);

  if (newAiItems.length > 0) {
    const existingAiEls = new WeakSet<HTMLElement>(
      state.items.filter((i) => i.group === 'ai').map((i) => i.el),
    );
    const existingSkippedEls = new WeakSet<HTMLElement>(
      state.items
        .filter(
          (i): i is ReviewableField & { el: HTMLElement } =>
            i.group === 'skipped' && i.el instanceof HTMLElement,
        )
        .map((i) => i.el),
    );
    const pushedFilledEls: HTMLElement[] = [];
    let addedSkipped = 0;
    for (const item of newAiItems) {
      if (item.el instanceof HTMLElement && !existingAiEls.has(item.el)) {
        state.items.push(item);
        existingAiEls.add(item.el);
        if (!item.note) {
          pushedFilledEls.push(item.el);
        } else if (!existingSkippedEls.has(item.el)) {
          state.items.push({
            group: 'skipped',
            label: item.label,
            el: item.el,
            ...(item.note ? { note: item.note } : {}),
          });
          existingSkippedEls.add(item.el);
          addedSkipped++;
        }
      }
    }
    if (pushedFilledEls.length > 0) {
      const filledEls = new WeakSet<HTMLElement>(pushedFilledEls);
      let removed = 0;
      state.items = state.items.filter((i) => {
        if (
          i.group === 'skipped' &&
          i.el instanceof HTMLElement &&
          filledEls.has(i.el)
        ) {
          removed++;
          return false;
        }
        return true;
      });
      if (removed > 0) {
        state.stats = {
          ...state.stats,
          skipped: Math.max(0, state.stats.skipped - removed),
        };
      }
    }
    if (addedSkipped > 0) {
      state.stats = {
        ...state.stats,
        skipped: state.stats.skipped + addedSkipped,
      };
    }
  }

  const explicitDecrement = opts.decrementSkippedBy;
  if (typeof explicitDecrement === 'number' && explicitDecrement > 0) {
    state.stats = {
      ...state.stats,
      skipped: Math.max(0, state.stats.skipped - explicitDecrement),
    };
  }

  const explicitIncrement = opts.incrementSkippedBy;
  if (typeof explicitIncrement === 'number' && explicitIncrement > 0) {
    state.stats = {
      ...state.stats,
      skipped: state.stats.skipped + explicitIncrement,
    };
  }

  render();
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

export function __getTabLabelForTests(): string | null {
  const el = state?.shadow.querySelector('.tab-main .tab-label') as HTMLElement | null;
  return el ? (el.textContent ?? '').trim() : null;
}

export function __clickTabMainForTests(): boolean {
  const btn = state?.shadow.querySelector<HTMLButtonElement>('button.tab.tab-main');
  if (!btn) return false;
  btn.click();
  return true;
}

export function __clickTabCloseForTests(): boolean {
  const btn = state?.shadow.querySelector<HTMLButtonElement>('button.tab.tab-close');
  if (!btn) return false;
  btn.click();
  return true;
}

export function __getDoneActionTextsForTests(): string[] {
  const buttons = state?.shadow.querySelectorAll<HTMLButtonElement>('.card button.ghost');
  if (!buttons) return [];
  return Array.from(buttons).map((b) => (b.textContent ?? '').trim());
}

export function __collapseCardForTests(): boolean {
  const btn = state?.shadow.querySelector<HTMLButtonElement>('button.icon');
  if (!btn) return false;
  btn.click();
  return true;
}

export function __getShadowCssForTests(): string {
  return state?.shadow.querySelector('style')?.textContent ?? '';
}

export function __getTabCloseTooltipForTests(): string | null {
  const tip = state?.shadow.querySelector('.tab-close .tab-tip') as HTMLElement | null;
  return tip ? (tip.textContent ?? '').trim() : null;
}

export function __getReviewPaneTextForTests(): string | null {
  const counter = state?.shadow.querySelector('.review .sub') as HTMLElement | null;
  return counter ? (counter.textContent ?? '').trim() : null;
}

export function __getAiAnswerTextForTests(): string | null {
  const box = state?.shadow.querySelector('.review .ai-a') as HTMLElement | null;
  return box ? (box.textContent ?? '').trim() : null;
}

export function __getChipTextForTests(
  kind: 'ok' | 'skip' | 'fail' | 'ai',
): string | null {
  const el = state?.shadow.querySelector(`.chip.${kind}`) as HTMLElement | null;
  return el ? (el.textContent ?? '').trim() : null;
}

export function __getReviewPaneAllTextForTests(): string | null {
  const pane = state?.shadow.querySelector('.review') as HTMLElement | null;
  return pane ? (pane.textContent ?? '').trim() : null;
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
    aiQueueOriginal: 0,
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

function reopenResults(): void {
  if (!state || !state.stats) return;
  state.phase = 'done';
  render();
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
    case 'ai':
      return 'Reviewing AI fills';
  }
}

function renderIdlePill(): HTMLElement {
  const s = state!;
  const hasFilled = s.stats !== null;

  const row = document.createElement('div');
  row.className = 'tab-row reveal';

  const main = document.createElement('button');
  main.type = 'button';
  main.className = 'tab tab-main';
  main.title = hasFilled
    ? 'View AutoFillTool results for this page'
    : 'Fill this page with AutoFillTool';
  main.append(
    brandMark(18),
    h('span', { class: 'tab-label' }, [hasFilled ? 'View results' : 'Fill this page']),
  );
  main.addEventListener('click', () => {
    if (hasFilled) reopenResults();
    else s.onFill();
  });

  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'tab tab-close';
  close.setAttribute('aria-label', 'Hide for this page');
  close.append(closeGlyph(), h('span', { class: 'tab-tip' }, ['Hide for this page']));
  close.addEventListener('click', (ev) => {
    ev.stopPropagation();
    dismiss();
  });

  row.append(main, close);
  return row;
}

function closeGlyph(): SVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('width', '11');
  svg.setAttribute('height', '11');
  svg.setAttribute('viewBox', '0 0 12 12');
  svg.setAttribute('aria-hidden', 'true');
  svg.style.flex = '0 0 auto';
  svg.style.display = 'block';
  svg.innerHTML =
    '<path d="M2 2 L10 10 M10 2 L2 10" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>';
  return svg;
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

  const aiInFlight = (st.aiPending ?? 0) > 0;
  const remoteForCounts = s.remoteCallbacks ?? null;
  const skippedDisplayCount = remoteForCounts
    ? st.skipped
    : reviewItemsFor('skipped').filter((i) => i.el.isConnected).length;
  const showSkippedChip = !aiInFlight && skippedDisplayCount > 0;

  const chips = h('div', { class: 'row gap chips' }, [
    reviewChip('ok', 'filled', `✓ ${st.filled} filled`),
    ...(showSkippedChip
      ? [reviewChip('skip', 'skipped', `${skippedDisplayCount} skipped`)]
      : []),
    ...(st.failed > 0 ? [chip('fail', `${st.failed} failed`)] : []),
  ]);
  const aiChipEl = renderAiReviewChip();
  const aiRow = aiChipEl
    ? h('div', { class: 'row gap chips ai-row' }, [aiChipEl])
    : null;

  const resume = resumeLine(st.resume);
  const note = autoLogNote(st.autoLogging);

  return frag([
    chips,
    ...(aiRow ? [aiRow] : []),
    ...(resume ? [resume] : []),
    note,
  ]);
}

function renderAiReviewChip(): HTMLElement | null {
  const s = state!;
  const st = s.stats;
  if (!st) return null;
  const aiFilled = st.ai ?? 0;
  const aiPending = st.aiPending ?? 0;
  const suggestPending = st.suggest ?? 0;
  const aiTotal = Math.max(s.aiQueueOriginal, aiFilled + aiPending);
  if (aiTotal === 0) return null;
  const total = aiTotal + suggestPending;
  if (total === 0) return null;

  const remote = s.remoteCallbacks ?? null;
  const reviewable = remote
    ? aiFilled + suggestPending
    : reviewItemsFor('ai').filter((i) => i.el.isConnected).length;
  const inFlight = aiPending > 0;
  const inReview = s.review?.group === 'ai';
  const reviewIndex = inReview ? s.review!.index : null;
  const tone = inFlight ? 'amber' : 'ai';

  const b = document.createElement('button');
  b.type = 'button';
  b.className = `chip ai ai-chip clickable tone-${tone}${inReview ? ' active' : ''}${inFlight ? ' pending' : ''}`;
  b.setAttribute('data-group', 'ai');
  b.title = inFlight ? 'AI is drafting answers…' : 'Step through AI fields';

  const label = h('span', { class: 'ai-chip-label' }, []);
  if (inFlight) label.append(buildThinkingDots('amber'));
  else label.append(document.createTextNode('🤖'));
  const countText = `${aiFilled}/${total} AI${inFlight ? '…' : ''}`;
  label.append(h('span', { class: 'ai-chip-count' }, [countText]));
  b.append(label);

  const dots = renderAiQueueDots(reviewIndex);
  if (dots) b.append(dots);

  b.addEventListener('click', () => {
    if (reviewable === 0) return;
    if (remote) enterRemoteReview('ai', remote);
    else enterReview('ai');
  });
  return b;
}

function renderAiQueueDots(currentIndex: number | null): HTMLElement | null {
  const s = state!;
  const filled = s.stats?.ai ?? 0;
  const pending = s.stats?.aiPending ?? 0;
  const suggestPending = s.stats?.suggest ?? 0;
  const aiTotal = Math.max(s.aiQueueOriginal, filled + pending);
  const processed = Math.max(0, aiTotal - pending);
  const total = aiTotal + suggestPending;
  if (total === 0) return null;

  const live = aiItems();
  const wrap = h('div', { class: 'queue-dots' }, []);
  for (let i = 0; i < total; i++) {
    const isAiSlot = i < aiTotal;
    const isCurrent = currentIndex !== null && i === currentIndex;

    let kind: 'answered' | 'failed' | 'thinking' | 'pending' | 'suggest';
    let item: ReviewableField | null = null;
    if (isAiSlot) {
      if (i < filled) {
        kind = 'answered';
        item = live[i] ?? null;
      } else if (i < processed) {
        kind = 'failed';
      } else if (i === processed && pending > 0) {
        kind = 'thinking';
      } else {
        kind = 'pending';
      }
    } else {
      kind = 'suggest';
      const sIdx = filled + (i - aiTotal);
      item = live[sIdx] ?? null;
    }

    const dotClass = `dot ${kind}${isCurrent ? ' current' : ''}`;
    if (item) {
      const dot = document.createElement('button');
      dot.type = 'button';
      dot.className = dotClass;
      dot.title = item.label;
      dot.setAttribute('data-i', String(i));
      dot.addEventListener('click', (ev) => {
        ev.stopPropagation();
        if (!state) return;
        if (state.review?.group !== 'ai') enterReview('ai');
        if (state.review) state.review.index = i;
        render();
        focusReviewPane();
        spotlight(item.el);
      });
      wrap.append(dot);
    } else {
      const d = document.createElement('span');
      d.className = dotClass;
      wrap.append(d);
    }
  }
  return wrap;
}

function buildThinkingDots(tone: 'amber' | 'sky' = 'sky'): HTMLElement {
  const wrap = h('span', { class: `aft-dots tone-${tone}` }, []);
  for (let i = 0; i < 3; i++) wrap.append(h('span', {}, []));
  return wrap;
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
  const has = remote
    ? remoteCountFor(group) > 0
    : reviewItemsFor(group).some((i) => i.el.isConnected);
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
    case 'ai':
      return stats.ai ?? 0;
  }
}

function enterReview(group: ReviewGroup): void {
  if (!state) return;
  const items = reviewItemsFor(group);
  const first = nextConnected(items, -1, 1);
  if (first === -1) return;
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
  const items = reviewItemsFor(state.review.group);
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

function reviewItemsFor(group: ReviewGroup): ReviewableField[] {
  const all = state?.items ?? [];
  if (group === 'ai') {
    const union = all.filter((i) => i.group === 'ai' || i.group === 'suggest');
    const aiEls = new WeakSet<HTMLElement>(
      union.filter((i) => i.group === 'ai').map((i) => i.el),
    );
    return union.filter((i) => i.group === 'ai' || !aiEls.has(i.el));
  }
  if (group === 'skipped') {
    const aiFilledEls = new WeakSet<HTMLElement>(
      all
        .filter(
          (i): i is ReviewableField & { el: HTMLElement } =>
            i.group === 'ai' && !i.note && i.el instanceof HTMLElement,
        )
        .map((i) => i.el),
    );
    return all.filter(
      (i) =>
        i.group === 'skipped' &&
        (!(i.el instanceof HTMLElement) || !aiFilledEls.has(i.el)),
    );
  }
  return all.filter((i) => i.group === group);
}

function aiItems(): ReviewableField[] {
  return reviewItemsFor('ai').filter((i) => i.el.isConnected);
}

function readFieldValue(el: HTMLElement): string {
  if (el instanceof HTMLSelectElement) {
    const opt = el.options[el.selectedIndex];
    return (opt?.text ?? el.value ?? '').trim();
  }
  // For combobox-style fields (react-select, etc.) the input is cleared after
  // a selection commits; the displayed value lives in a sibling `single-value`
  // element. Prefer that over the empty input value so the AI review pane
  // shows what was selected instead of "(field is empty)".
  if (isComboboxTrigger(el)) {
    const v = extractComboboxValue(el);
    if (v) return v;
  }
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    return (el.value ?? '').trim();
  }
  const aria = el.getAttribute('aria-label-value');
  if (aria) return aria.trim();
  return (el.textContent ?? '').trim();
}

function isComboboxTrigger(el: HTMLElement): boolean {
  return (
    el.getAttribute('role') === 'combobox' ||
    el.getAttribute('aria-haspopup') === 'listbox'
  );
}

function extractComboboxValue(trigger: HTMLElement): string {
  let cursor: HTMLElement | null = trigger;
  for (let depth = 0; cursor && depth < 4; depth++, cursor = cursor.parentElement) {
    const dataValue = cursor.getAttribute('data-value');
    if (dataValue && dataValue.trim()) return dataValue.trim();
    const singleValue = cursor.querySelector<HTMLElement>('[class*="single-value" i]');
    if (singleValue) {
      const text = (singleValue.textContent ?? '').trim();
      if (text) return text;
    }
  }
  return '';
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
  const group: ReviewGroup = remote
    ? remote.group
    : s.review!.group;
  const stepFn = remote ? stepRemoteReview : stepReview;
  const exitFn = remote ? exitRemoteReview : exitReview;

  const installKeyboard = (pane: HTMLElement): void => {
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
  };

  if (group === 'ai' && !remote) {
    return renderAiReviewPane(stepFn, exitFn, installKeyboard);
  }

  const display = remote
    ? { index: remote.index, total: remote.total, label: remote.label, note: remote.note }
    : (() => {
        const { group: g, index } = s.review!;
        const items = reviewItemsFor(g);
        const current = items[index]!;
        return { index, total: items.length, label: current.label, note: current.note };
      })();

  const counter = h('div', { class: 'sub' }, [
    `${display.index + 1} of ${display.total} · ${truncate(display.label, 60)}`,
  ]);
  const noteEl = display.note
    ? h('div', { class: 'sub light' }, [display.note])
    : null;
  const help = h('div', { class: 'sub light' }, ['← / → to step · Esc to exit']);
  const actions = h('div', { class: 'row gap top' }, [
    btn({ class: 'ghost', text: '← Prev', onClick: () => stepFn(-1) }),
    btn({ class: 'ghost', text: 'Next →', onClick: () => stepFn(1) }),
    btn({ class: 'ghost', text: 'Done', onClick: exitFn }),
  ]);

  const children: HTMLElement[] = [counter];
  if (noteEl) children.push(noteEl);
  children.push(help, actions);
  const pane = h('div', { class: 'review', tabindex: '0' }, children);
  installKeyboard(pane);
  return pane;
}

function renderAiReviewPane(
  stepFn: (dir: 1 | -1) => void,
  exitFn: () => void,
  installKeyboard: (pane: HTMLElement) => void,
): HTMLElement {
  const s = state!;
  const { index } = s.review!;
  const items = reviewItemsFor('ai');
  const current = items[index]!;
  const isSuggestKind = current.group === 'suggest';

  const counter = h('div', { class: 'sub uppercase eyebrow' }, [
    `Question ${index + 1} of ${items.length}`,
  ]);

  const label = h('div', { class: 'ai-q' }, [current.label]);

  const valueBox = h('div', { class: 'ai-a' }, []);
  const v = readFieldValue(current.el);
  if (current.note) {
    valueBox.append(h('span', { class: 'placeholder' }, [current.note]));
  } else if (v) {
    valueBox.textContent = v;
  } else if (isSuggestKind) {
    valueBox.append(
      h('span', { class: 'placeholder' }, [
        'Awaiting Autofill: open the field and click the Autofill chip to draft.',
      ]),
    );
  } else {
    valueBox.append(h('span', { class: 'placeholder' }, ['(field is empty)']));
  }

  const help = h('div', { class: 'sub light' }, ['← / → step · Esc exit']);

  const editLabel = isSuggestKind ? 'Open field' : 'Edit field';
  const actions = h('div', { class: 'row gap top wrap' }, [
    btn({ class: 'ghost xs', text: '←', title: 'Previous', onClick: () => stepFn(-1) }),
    btn({ class: 'ghost xs', text: '→', title: 'Next', onClick: () => stepFn(1) }),
    btn({ class: 'primary sm', text: editLabel, onClick: () => editReviewCurrent() }),
    btn({ class: 'ghost', text: 'Done', onClick: exitFn }),
  ]);

  const pane = h('div', { class: 'review ai-review', tabindex: '0' }, [
    counter,
    label,
    valueBox,
    help,
    actions,
  ]);
  installKeyboard(pane);
  return pane;
}

function editReviewCurrent(): void {
  if (!state?.review) return;
  const items = reviewItemsFor(state.review.group);
  const current = items[state.review.index];
  if (!current) return;
  spotlight(current.el);
  try {
    (current.el as HTMLElement).focus({ preventScroll: false });
  } catch {
  }
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
    const target = visibleAnchor(el);
    target.scrollIntoView({ block: 'center', behavior: 'smooth' });
    const style = target.style;
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

const MIN_ANCHOR_WIDTH = 32;
const MIN_ANCHOR_HEIGHT = 16;
function visibleAnchor(el: HTMLElement): HTMLElement {
  let cursor: HTMLElement = el;
  for (let depth = 0; depth < 5; depth++) {
    const rect = cursor.getBoundingClientRect();
    if (rect.width >= MIN_ANCHOR_WIDTH && rect.height >= MIN_ANCHOR_HEIGHT) return cursor;
    if (!cursor.parentElement) break;
    cursor = cursor.parentElement;
  }
  return cursor;
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
    .chips { display: flex; flex-wrap: wrap; row-gap: 4px; }
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
    button.chip.clickable.active {
      border-color: #7dd3fc;
      background: rgba(125,211,252,0.14);
    }
    button.chip.ai-chip {
      display: inline-flex; align-items: center; gap: 8px;
      padding: 4px 10px 4px 8px;
      background: rgba(125,211,252,0.10);
      border-color: rgba(125,211,252,0.25);
      color: #7dd3fc;
    }
    button.chip.ai-chip:hover { background: rgba(125,211,252,0.18); }
    button.chip.ai-chip.tone-amber {
      color: #fbbf24;
      background: rgba(251,191,36,0.10);
      border-color: rgba(251,191,36,0.25);
    }
    button.chip.ai-chip.tone-amber:hover { background: rgba(251,191,36,0.18); }
    button.chip.ai-chip.active {
      border-color: #7dd3fc;
      background: rgba(125,211,252,0.18);
    }
    button.chip.ai-chip .ai-chip-label {
      display: inline-flex; align-items: center; gap: 6px;
      white-space: nowrap; font-weight: 600;
    }
    button.chip.ai-chip .ai-chip-count { font-variant-numeric: tabular-nums; }
    .sub.uppercase.eyebrow {
      text-transform: uppercase; letter-spacing: 0.08em;
      font-size: 10.5px; color: #94a3b8;
      margin-top: 2px;
    }
    .ai-q {
      font-size: 13px; color: #f8fafc; font-weight: 600;
      line-height: 1.35; margin-top: 4px;
    }
    .ai-a {
      font-size: 12.5px; color: #e2e8f0; line-height: 1.5;
      padding: 9px 11px; min-height: 36px;
      background: rgba(125,211,252,0.06);
      border: 1px solid rgba(125,211,252,0.15);
      border-radius: 8px;
      white-space: pre-wrap;
      max-height: 130px; overflow-y: auto;
    }
    .ai-a .placeholder { color: #64748b; font-style: italic; }
    .ai-a .thinking-label { color: #fbbf24; font-weight: 600; margin-left: 7px; }
    .queue-dots {
      display: flex; flex-wrap: wrap; gap: 4px; align-items: center;
      padding-top: 2px;
    }
    .queue-dots .dot {
      width: 8px; height: 8px; border-radius: 999px; padding: 0; border: none;
      background: rgba(255,255,255,0.18);
      cursor: default;
      transition: width .2s ease, background .2s ease;
    }
    button.dot { cursor: pointer; }
    button.dot:hover { background: #bae6fd; }
    .queue-dots .dot.answered { background: #7dd3fc; }
    .queue-dots .dot.failed   { background: #94a3b8; }
    .queue-dots .dot.suggest  { background: #7dd3fc; opacity: 0.65; }
    .queue-dots .dot.thinking {
      width: 14px; background: #fbbf24;
      animation: aftDotThink 1.4s ease-in-out infinite;
    }
    .queue-dots .dot.current {
      box-shadow: 0 0 0 2px #38bdf8;
      outline: 1px solid rgba(15,23,42,0.85); outline-offset: -3px;
    }
    @keyframes aftDotThink {
      0%, 100% { box-shadow: 0 0 0 0 rgba(251,191,36,0.30); }
      50%      { box-shadow: 0 0 0 3px rgba(251,191,36,0.30); }
    }
    .aft-dots { display: inline-flex; gap: 3px; align-items: center; }
    .aft-dots > span {
      display: inline-block; width: 4px; height: 4px;
      background: #fbbf24; border-radius: 50%;
      animation: aftDot 1.2s ease-in-out infinite;
    }
    .aft-dots.tone-sky > span { background: #7dd3fc; }
    .aft-dots > span:nth-child(2) { animation-delay: .15s; }
    .aft-dots > span:nth-child(3) { animation-delay: .30s; }
    @keyframes aftDot {
      0%, 80%, 100% { opacity: 0.25; transform: translateY(0); }
      40%           { opacity: 1;    transform: translateY(-2px); }
    }
    .row.wrap { flex-wrap: wrap; }
    .review.ai-review > * + * { margin-top: 6px; }
    .review.ai-review .ai-q { margin-top: 2px; }
    .review.ai-review .row.gap.top { margin-top: 10px; }
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
    button.primary.sm {
      padding: 6px 11px; font-size: 12.5px; font-weight: 700;
    }
    button.ghost {
      padding: 7px 12px; font-size: 12.5px; font-weight: 600;
      background: transparent; color: #cbd5e1; border: 1px solid rgba(255,255,255,0.12);
    }
    button.ghost:hover { background: rgba(255,255,255,0.04); }
    button.ghost.xs {
      padding: 4px 9px; font-size: 11.5px; font-weight: 600;
      min-width: 28px;
    }
    button.icon {
      background: transparent; color: #94a3b8; border: none;
      font-size: 16px; line-height: 1; padding: 2px 6px; border-radius: 6px;
    }
    button.icon:hover { color: #f8fafc; }
    .tab-row {
      position: fixed; right: 0; bottom: 16vh;
      display: inline-flex; align-items: stretch;
      background: #0f172a; color: #f8fafc;
      border: 1px solid rgba(255,255,255,0.06);
      border-right: none;
      border-radius: 14px 0 0 14px;
      box-shadow:
        0 18px 46px rgba(2,132,199,0.20),
        0 8px 22px rgba(0,0,0,0.32);
      overflow: visible;
      transition: box-shadow .2s ease;
    }
    .tab-row:hover {
      box-shadow:
        0 22px 56px rgba(2,132,199,0.30),
        0 10px 28px rgba(0,0,0,0.38);
    }
    button.tab {
      display: inline-flex; align-items: center;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      background: transparent; color: #f8fafc; border: none;
      cursor: pointer;
    }
    button.tab.tab-main {
      gap: 9px;
      padding: 11px 16px 11px 14px;
      font-size: 13px;
      font-weight: 600;
      line-height: 1;
      border-radius: 14px 0 0 14px;
    }
    button.tab.tab-main:hover { background: rgba(255,255,255,0.04); }
    button.tab.tab-main:hover .tab-label { color: #f8fafc; }
    .tab-row.reveal button.tab.tab-close {
      width: 0; opacity: 0; pointer-events: none; overflow: hidden;
      padding: 0;
    }
    .tab-row.reveal:hover button.tab.tab-close,
    .tab-row.reveal:focus-within button.tab.tab-close {
      width: 38px; opacity: 1; pointer-events: auto;
    }
    button.tab.tab-close {
      align-self: stretch;
      width: 38px; padding: 0;
      display: inline-flex; align-items: center; justify-content: center;
      color: #94a3b8;
      transition: background .15s ease, color .15s ease, width .2s ease, opacity .2s ease;
      position: relative;
    }
    button.tab.tab-close::before {
      content: ''; position: absolute; left: 0; top: 8px; bottom: 8px;
      width: 1px; background: rgba(255,255,255,0.08);
    }
    button.tab.tab-close:hover { color: #f8fafc; background: rgba(255,255,255,0.06); }
    .tab-row .tab-tip {
      position: absolute; bottom: calc(100% + 8px); left: 50%; transform: translateX(-50%);
      background: #0f172a; color: #e2e8f0;
      font: 600 11.5px/1.2 inherit;
      padding: 6px 9px; border-radius: 6px;
      border: 1px solid rgba(255,255,255,0.08);
      white-space: nowrap; opacity: 0; pointer-events: none;
      transition: opacity .15s ease .25s, transform .15s ease .25s;
      box-shadow: 0 6px 16px rgba(0,0,0,0.3);
    }
    .tab-row .tab-tip::after {
      content: ''; position: absolute; top: 100%; left: 50%; transform: translateX(-50%);
      border: 4px solid transparent; border-top-color: #0f172a;
    }
    button.tab.tab-close:hover .tab-tip,
    button.tab.tab-close:focus-visible .tab-tip {
      opacity: 1; transform: translateX(-50%) translateY(-2px);
    }
    @media (hover: none) {
      .tab-row.reveal button.tab.tab-close {
        width: 38px; opacity: 1; pointer-events: auto;
      }
    }
  `;
  return s;
}
