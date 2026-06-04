/**
 * Collapsible section wrapper shared by all Options panels. Owns its own
 * open/closed state; parent picks the initial state via `defaultCollapsed`.
 *
 * Lives in its own file to avoid a circular import between OptionsApp and the
 * three sub-section components (Resume / AI / Tracking) that consume it.
 */

import { useState, type ReactNode } from 'react';

export function Section(props: {
  title: string;
  hint?: ReactNode | undefined;
  children: ReactNode;
  collapsible?: boolean | undefined;
  defaultCollapsed?: boolean | undefined;
}) {
  const [collapsed, setCollapsed] = useState(props.defaultCollapsed ?? false);
  const slug = props.title.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
  const panelId = `section-${slug}-panel`;
  const open = !props.collapsible || !collapsed;

  return (
    <section>
      {props.collapsible ? (
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          aria-expanded={open}
          aria-controls={panelId}
          className="-mx-1 flex w-full items-center gap-2 rounded px-1 py-0.5 text-left hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-sky-500 dark:hover:bg-slate-800/60"
        >
          <Chevron open={open} />
          <h2 className="text-base font-semibold">{props.title}</h2>
        </button>
      ) : (
        <h2 className="text-base font-semibold">{props.title}</h2>
      )}
      {open && (
        <div id={panelId}>
          {props.hint && (
            <p
              className={`mt-0.5 text-xs text-slate-500 dark:text-slate-400 ${
                props.collapsible ? 'pl-5' : ''
              }`}
            >
              {props.hint}
            </p>
          )}
          <div className="mt-3">{props.children}</div>
        </div>
      )}
    </section>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="currentColor"
      aria-hidden="true"
      className={`h-3 w-3 shrink-0 text-slate-500 transition-transform dark:text-slate-400 ${
        open ? 'rotate-90' : ''
      }`}
    >
      <path
        fillRule="evenodd"
        d="M7.21 14.77a.75.75 0 0 1 .02-1.06L11.168 10 7.23 6.29a.75.75 0 1 1 1.04-1.08l4.5 4.25a.75.75 0 0 1 0 1.08l-4.5 4.25a.75.75 0 0 1-1.06-.02z"
        clipRule="evenodd"
      />
    </svg>
  );
}
