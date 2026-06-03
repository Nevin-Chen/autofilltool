/**
 * Transient in-page toasts in a closed Shadow DOM (host CSS can't reach them):
 *   - showLoggedToast: confirms an auto-logged application (submit-watch).
 *   - showNoticeToast: a generic notice (e.g. "No application form detected").
 *
 * The proactive "Fill this page" trigger and its post-fill results state now
 * live in ./affordance.ts; this module is just the short-lived notices.
 */

import type { LoggedRecord } from './submit-watch';

const HOST_ID = 'autofilltool-pill-host';

/**
 * Small auto-dismissing toast shown when submit-watch auto-logs an application.
 */
export function showLoggedToast(record: LoggedRecord): void {
  const { container, host } = mountToast();

  const where = record.posted ? 'Logged to your sheet' : 'Logged locally';
  const label = [record.role, record.company].filter(Boolean).join(' · ');
  container.append(
    h('div', { class: 'row between' }, [
      h('div', { class: 'title' }, ['Application logged ✓']),
      btn({ class: 'icon', text: '×', title: 'Dismiss', onClick: () => host.remove() }),
    ]),
    h('div', { class: 'sub' }, [where + (label ? ` — ${label}` : '')]),
  );

  setTimeout(() => host.remove(), 6000);
}

/**
 * Generic transient notice toast (e.g. "No application form detected"). Sent by
 * the background to the top frame after a Fill that detected zero fields.
 */
export function showNoticeToast(text: string): void {
  const { container, host } = mountToast();

  container.append(
    h('div', { class: 'row between' }, [
      h('div', { class: 'title' }, ['AutoFillTool']),
      btn({ class: 'icon', text: '×', title: 'Dismiss', onClick: () => host.remove() }),
    ]),
    h('div', { class: 'sub' }, [text]),
  );

  setTimeout(() => host.remove(), 6000);
}

/* ----------------------------------------------------------- rendering */

function mountToast(): { host: HTMLElement; container: HTMLElement } {
  document.getElementById(HOST_ID)?.remove();

  const host = document.createElement('div');
  host.id = HOST_ID;
  // `all: initial` first, then positioning — otherwise the reset clobbers the
  // fixed anchor and the toast lands bottom-left in normal flow.
  Object.assign(host.style, {
    all: 'initial',
    position: 'fixed',
    right: '16px',
    bottom: '16px',
    zIndex: '2147483647',
  } as CSSStyleDeclaration);

  const shadow = host.attachShadow({ mode: 'closed' });
  shadow.appendChild(buildStyle());
  const container = document.createElement('div');
  container.className = 'card';
  shadow.appendChild(container);

  (document.body ?? document.documentElement).appendChild(host);
  return { host, container };
}

/* ------------------------------------------------------- DOM helpers */

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

function buildStyle(): HTMLStyleElement {
  const s = document.createElement('style');
  s.textContent = `
    :host { all: initial; }
    .card {
      font: 13px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: #0f172a;
      color: #e2e8f0;
      border-radius: 12px;
      box-shadow: 0 12px 30px rgba(0,0,0,0.28);
      padding: 12px 14px;
      width: 320px;
      border: 1px solid rgba(255,255,255,0.06);
    }
    .row { display: flex; align-items: center; }
    .row.between { justify-content: space-between; }
    .title { font-weight: 600; color: #f8fafc; }
    .sub { color: #94a3b8; margin: 2px 0 0; }
    button {
      font: inherit; border-radius: 8px; padding: 6px 10px;
      border: 1px solid transparent; cursor: pointer;
    }
    button.icon {
      background: transparent; color: #94a3b8; border: none;
      font-size: 16px; line-height: 1; padding: 2px 6px;
    }
    button.icon:hover { color: #f8fafc; }
  `;
  return s;
}
