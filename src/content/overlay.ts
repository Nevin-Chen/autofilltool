/**
 * Persistent in-page pill. Lives in a closed Shadow DOM so the host page's
 * CSS can't reach it. Two states:
 *
 *   1. Summary — counts, "Mark submitted" button, close button.
 *   2. Submit form — editable company/role pre-filled from the page,
 *      "Send" → posts LOG_SUBMISSION → toast result → close.
 *
 * The pill is mounted by the content script after a fill and stays put until
 * the user dismisses it (clicking the × or hitting "Send"). It does not
 * auto-dismiss — the user often needs minutes to finish the form before
 * they're ready to mark it submitted.
 */

import type { AdapterId } from '@/profile/schema';
import type { JobContext } from './job-context';
import { extractJobContext } from './job-context';
import { sendToBackground } from '@/lib/messaging';

const HOST_ID = 'autofilltool-pill-host';

export type PillInput = {
  filled: number;
  skipped: number;
  failed: number;
  adapterId: AdapterId;
  adapterName: string;
};

export function showPill(input: PillInput): void {
  // If a previous pill is still on the page, replace it.
  document.getElementById(HOST_ID)?.remove();

  const host = document.createElement('div');
  host.id = HOST_ID;
  Object.assign(host.style, {
    position: 'fixed',
    right: '16px',
    bottom: '16px',
    zIndex: '2147483647',
    all: 'initial',
  } as CSSStyleDeclaration);

  const shadow = host.attachShadow({ mode: 'closed' });
  shadow.appendChild(buildStyle());

  const container = document.createElement('div');
  container.className = 'card';
  shadow.appendChild(container);

  const close = () => host.remove();
  renderSummary(container, input, () => renderForm(container, input, close), close);

  (document.body ?? document.documentElement).appendChild(host);
}

/* ----------------------------------------------------------- rendering */

function renderSummary(
  root: HTMLElement,
  input: PillInput,
  onMark: () => void,
  onClose: () => void,
): void {
  root.innerHTML = '';
  const header = h('div', { class: 'row between' }, [
    h('div', { class: 'title' }, ['AutoFillTool']),
    btn({ class: 'icon', text: '×', title: 'Dismiss', onClick: onClose }),
  ]);
  const via = h('div', { class: 'sub' }, [
    'via ',
    h('strong', {}, [input.adapterName]),
  ]);
  const stats = h('div', { class: 'row gap' }, [
    pill('ok', `${input.filled} filled`),
    pill('skip', `${input.skipped} skipped`),
    ...(input.failed > 0 ? [pill('fail', `${input.failed} failed`)] : []),
  ]);
  const hint = h('div', { class: 'hint' }, [
    'Review the form, then click Submit on the page. Use the button below to log the application.',
  ]);
  const actions = h('div', { class: 'row gap top' }, [
    btn({
      class: 'primary',
      text: 'Mark submitted',
      onClick: onMark,
    }),
  ]);

  root.append(header, via, stats, hint, actions);
}

function renderForm(root: HTMLElement, input: PillInput, onClose: () => void): void {
  const ctx: JobContext = safeExtract();

  root.innerHTML = '';
  const header = h('div', { class: 'row between' }, [
    h('div', { class: 'title' }, ['Mark submitted']),
    btn({ class: 'icon', text: '×', title: 'Cancel', onClick: onClose }),
  ]);
  const company = inputField('Company', ctx.company, 'company');
  const role = inputField('Role', ctx.role, 'role');
  const url = inputField('Job URL', ctx.jobUrl, 'jobUrl');

  const status = h('div', { class: 'status' }, ['']) as HTMLDivElement;
  const send = btn({
    class: 'primary',
    text: 'Send',
    onClick: async () => {
      status.textContent = 'Sending…';
      try {
        const res = await sendToBackground({
          type: 'LOG_SUBMISSION',
          record: {
            company: company.input.value.trim(),
            role: role.input.value.trim(),
            jobUrl: url.input.value.trim(),
            source: input.adapterId,
            status: 'submitted',
          },
        });
        if (res.ok) {
          if (res.value.posted) {
            status.textContent = 'Logged & posted to your sheet.';
          } else if (res.value.webhookError) {
            status.textContent = `Saved locally. Webhook failed: ${res.value.webhookError}`;
          } else {
            status.textContent = 'Saved locally (no webhook configured).';
          }
          setTimeout(onClose, 1500);
        } else {
          status.textContent = res.error;
        }
      } catch (err) {
        status.textContent = err instanceof Error ? err.message : String(err);
      }
    },
  });
  const cancel = btn({ class: 'ghost', text: 'Cancel', onClick: onClose });

  root.append(
    header,
    company.wrapper,
    role.wrapper,
    url.wrapper,
    h('div', { class: 'row gap top' }, [send, cancel]),
    status,
  );
}

function safeExtract(): JobContext {
  try {
    return extractJobContext(document, new URL(location.href));
  } catch {
    return { company: '', role: '', jobUrl: location.href };
  }
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

function pill(kind: 'ok' | 'skip' | 'fail', text: string): HTMLElement {
  return h('span', { class: `chip ${kind}` }, [text]);
}

function inputField(
  label: string,
  initial: string,
  key: string,
): { wrapper: HTMLElement; input: HTMLInputElement } {
  const input = document.createElement('input');
  input.type = 'text';
  input.value = initial;
  input.name = key;
  input.className = 'in';
  const wrapper = h('label', { class: 'field' }, [
    h('span', { class: 'label' }, [label]),
    input,
  ]);
  return { wrapper, input };
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
    .row.gap > * + * { margin-left: 8px; }
    .row.top { margin-top: 10px; }
    .title { font-weight: 600; color: #f8fafc; }
    .sub { color: #94a3b8; margin: 2px 0 8px; }
    .hint { color: #64748b; margin-top: 8px; font-size: 11px; }
    .chip {
      font-size: 11px; padding: 2px 8px; border-radius: 999px;
      background: rgba(255,255,255,0.06); color: #cbd5e1;
    }
    .chip.ok   { color: #34d399; }
    .chip.skip { color: #94a3b8; }
    .chip.fail { color: #fb7185; }
    button {
      font: inherit; border-radius: 8px; padding: 6px 10px;
      border: 1px solid transparent; cursor: pointer;
    }
    button.primary { background: #0284c7; color: white; border-color: #0369a1; }
    button.primary:hover { background: #0ea5e9; }
    button.ghost { background: transparent; color: #cbd5e1; border-color: rgba(255,255,255,0.12); }
    button.ghost:hover { background: rgba(255,255,255,0.04); }
    button.icon {
      background: transparent; color: #94a3b8; border: none;
      font-size: 16px; line-height: 1; padding: 2px 6px;
    }
    button.icon:hover { color: #f8fafc; }
    .field { display: block; margin-top: 8px; }
    .field .label { display: block; color: #94a3b8; font-size: 11px; margin-bottom: 3px; }
    .in {
      width: 100%; box-sizing: border-box; padding: 6px 8px;
      background: #1e293b; color: #f1f5f9; border: 1px solid #334155;
      border-radius: 6px; font: inherit;
    }
    .in:focus { outline: 1px solid #0ea5e9; border-color: #0ea5e9; }
    .status { margin-top: 8px; font-size: 11px; color: #cbd5e1; min-height: 14px; }
  `;
  return s;
}
