export function ProgressBar(props: { label: string; detail?: string; fraction: number; compact?: boolean }) {
  const percent = Math.round(Math.max(0, Math.min(1, props.fraction)) * 100);
  return (
    <div>
      {!props.compact && (
        <div className="flex items-baseline justify-between gap-3 text-xs text-slate-600 dark:text-slate-300">
          <span>{props.label}</span>
          {props.detail && <span className="tabular-nums text-slate-500 dark:text-slate-400">{props.detail}</span>}
        </div>
      )}
      <div
        role="progressbar"
        aria-label={props.label}
        aria-valuetext={props.detail}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        className={`${props.compact ? 'h-1' : 'mt-1 h-2'} overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700`}
      >
        <div className="h-full rounded-full bg-sky-500 transition-[width] duration-500" style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}
