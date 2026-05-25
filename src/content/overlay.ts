/**
 * Minimal in-page toast. Mounted into a closed Shadow DOM so the host page's
 * CSS can't bleed in or out. Auto-dismisses after a few seconds; click to
 * dismiss early. The full floating-pill overlay (with action log, Suggest
 * All, Mark Submitted) arrives alongside the AI and webhook steps that
 * actually need it.
 */

const HOST_ID = 'autofilltool-toast-host';

export type ToastInput = {
  filled: number;
  skipped: number;
  failed: number;
  adapterName: string;
};

export function showToast(input: ToastInput): void {
  // Replace any prior toast so quick repeated fills don't stack.
  document.getElementById(HOST_ID)?.remove();

  const host = document.createElement('div');
  host.id = HOST_ID;
  Object.assign(host.style, {
    position: 'fixed',
    right: '16px',
    bottom: '16px',
    zIndex: '2147483647', // top of the stacking order
    all: 'initial', // reset any inherited host styles
  } as CSSStyleDeclaration);

  const shadow = host.attachShadow({ mode: 'closed' });
  const root = document.createElement('div');
  root.innerHTML = `
    <style>
      :host { all: initial; }
      .card {
        font: 13px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        background: #0f172a;
        color: #e2e8f0;
        border-radius: 10px;
        box-shadow: 0 10px 30px rgba(0,0,0,0.25);
        padding: 12px 14px;
        max-width: 320px;
        cursor: pointer;
        user-select: none;
        border: 1px solid rgba(255,255,255,0.06);
      }
      .title { font-weight: 600; margin-bottom: 4px; color: #f8fafc; }
      .row { display: flex; gap: 10px; margin-top: 2px; }
      .pill {
        font-size: 11px; padding: 1px 6px; border-radius: 999px;
        background: rgba(255,255,255,0.06); color: #cbd5e1;
      }
      .pill.ok    { color: #34d399; }
      .pill.skip  { color: #94a3b8; }
      .pill.fail  { color: #fb7185; }
      .hint { color: #64748b; margin-top: 6px; font-size: 11px; }
    </style>
    <div class="card" role="status" aria-live="polite">
      <div class="title">AutoFillTool</div>
      <div>via <strong>${escapeHtml(input.adapterName)}</strong></div>
      <div class="row">
        <span class="pill ok">${input.filled} filled</span>
        <span class="pill skip">${input.skipped} skipped</span>
        ${input.failed > 0 ? `<span class="pill fail">${input.failed} failed</span>` : ''}
      </div>
      <div class="hint">Click to dismiss · review fields before submitting</div>
    </div>
  `;
  shadow.appendChild(root);

  const card = root.querySelector<HTMLDivElement>('.card');
  const dismiss = () => host.remove();
  card?.addEventListener('click', dismiss);

  (document.body ?? document.documentElement).appendChild(host);

  // Auto-dismiss after 6s.
  setTimeout(dismiss, 6000);
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
