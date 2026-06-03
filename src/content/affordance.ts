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
  /** Open-ended fields that still want a human/AI answer (✨ Suggest). */
  suggest: number;
  adapterId: AdapterId;
  adapterName: string;
  resume: TriggerResume;
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
};

let state: State | null = null;
/** Set when the user closes the trigger outright; blocks proactive re-show. */
let dismissedThisPage = false;

/* ------------------------------------------------------------- public API */

/**
 * Mount (or refresh) the proactive idle trigger for a detected form — a small
 * pill tucked into the right edge. No-op once the user has dismissed it on this
 * page. Idempotent: updates the field count without duplicating the host.
 */
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

/** Switch the trigger into its filling state (driven by the in-page button). */
export function setFillTriggerFilling(): void {
  const s = ensureHost();
  s.phase = 'filling';
  render();
}

/**
 * Show the post-fill results. Mounts the surface if it isn't already present
 * (e.g. a popup-triggered fill on a page where the idle trigger was dismissed),
 * so the outcome is always visible.
 */
export function showFillTriggerDone(stats: TriggerStats): void {
  const s = ensureHost();
  s.phase = 'done';
  s.stats = stats;
  render();
}

export function removeFillTrigger(): void {
  document.getElementById(HOST_ID)?.remove();
  state = null;
}

/* ------------------------------------------------------------- internals */

function ensureHost(): State {
  if (state && document.getElementById(HOST_ID)) return state;
  document.getElementById(HOST_ID)?.remove();

  const host = document.createElement('div');
  host.id = HOST_ID;
  // `all: initial` must come first — it resets every property, so the
  // positioning declarations have to follow it to survive (otherwise the host
  // falls back to static flow and lands bottom-left instead of bottom-right).
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

  state = {
    host,
    shadow,
    body,
    phase: 'idle',
    detected: 0,
    onFill: () => {},
    stats: null,
  };
  return state;
}

/** Return to the small idle pill (e.g. the × on the results card). */
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
  // Idle is a small pill tucked into the right edge; filling/done is the full
  // card anchored bottom-right (the host's fixed anchor).
  const idle = state.phase === 'idle';
  state.body.className = idle ? '' : 'card';
  state.body.append(idle ? renderIdlePill() : renderCard());
}

function renderCard(): HTMLElement {
  const s = state!;
  const header = h('div', { class: 'row between head' }, [
    h('div', { class: 'row gap-sm' }, [
      brandMark(20),
      h('span', { class: 'title' }, [s.phase === 'done' ? 'Filled' : 'AutoFillTool']),
    ]),
    iconBtn('×', 'Collapse', collapse),
  ]);

  const content = s.phase === 'filling' ? renderFilling() : renderDone();
  return frag([header, content]);
}

/** Small idle pill — tucked into the right edge; click runs the fill. */
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
  const label = h('div', { class: 'sub light' }, ['Filling fields…']);
  const bar = h('div', { class: 'track' }, [h('div', { class: 'fill' }, [])]);
  // Animate the indeterminate bar forward on the next frame.
  const inner = bar.firstElementChild as HTMLElement;
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
  };

  const chips = h('div', { class: 'row gap chips' }, [
    chip('ok', `✓ ${st.filled} filled`),
    ...(st.skipped > 0 ? [chip('skip', `${st.skipped} skipped`)] : []),
    ...(st.failed > 0 ? [chip('fail', `${st.failed} failed`)] : []),
    ...(st.suggest > 0 ? [chip('ai', `✨ ${st.suggest} to Suggest`)] : []),
  ]);

  const resume = resumeLine(st.resume);

  const note = h('div', { class: 'row note' }, [
    clockGlyph(),
    h('span', {}, [
      "We'll log this application ",
      h('strong', {}, ['automatically']),
      ' once you reach the confirmation page — no need to mark it.',
    ]),
  ]);

  const actions = h('div', { class: 'row gap top' }, [
    btn({ class: 'ghost', text: 'Dismiss', onClick: dismiss }),
  ]);

  return frag([chips, ...(resume ? [resume] : []), note, actions]);
}

function resumeLine(state_: TriggerResume): HTMLElement | null {
  switch (state_) {
    case 'attached':
      return h('div', { class: 'sub' }, [chip('ok', 'Resume attached')]);
    case 'notFound':
      return h('div', { class: 'sub' }, [chip('skip', 'Resume: no slot on this page')]);
    default:
      return null;
  }
}

/* --------------------------------------------------------- DOM helpers */

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

/** The extension's brand mark — matches public/icons/icon.svg (form fields). */
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
      width: 320px;
      box-sizing: border-box;
      border: 1px solid rgba(255,255,255,0.06);
    }
    .stack > * + * { margin-top: 10px; }
    .row { display: flex; align-items: center; }
    .row.between { justify-content: space-between; }
    .row.gap > * + * { margin-left: 8px; }
    .row.gap-sm > * + * { margin-left: 9px; }
    .row.top { margin-top: 10px; }
    .head { margin-bottom: 2px; }
    .title { font-weight: 700; color: #f8fafc; font-size: 14px; }
    .sub { color: #94a3b8; font-size: 12.5px; }
    .sub.light { color: #cbd5e1; }
    .sub strong { color: #cbd5e1; }
    .chips { flex-wrap: wrap; }
    .chip {
      font-size: 11.5px; padding: 3px 9px; border-radius: 999px;
      background: rgba(255,255,255,0.06); color: #cbd5e1; font-weight: 600;
      white-space: nowrap;
    }
    .chip.ok   { color: #34d399; }
    .chip.skip { color: #94a3b8; }
    .chip.fail { color: #fb7185; }
    .chip.ai   { color: #7dd3fc; }
    .note {
      align-items: flex-start; gap: 7px;
      font-size: 11.5px; color: #94a3b8; line-height: 1.45;
    }
    .note strong { color: #cbd5e1; }
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
