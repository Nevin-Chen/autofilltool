import type { ReactNode } from 'react';

export function Grid(props: { children: ReactNode }) {
  return <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">{props.children}</div>;
}

export function TextField(props: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
}) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block text-slate-700 dark:text-slate-200">
        {props.label}
      </span>
      <input
        type={props.type ?? 'text'}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        className="w-full rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm shadow-sm focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
      />
    </label>
  );
}

export function SelectField(props: {
  label: string;
  value: string | null;
  options: ReadonlyArray<string>;
  onChange: (v: string) => void;
}) {
  const value = props.value ?? '';
  const known = props.options.includes(value);
  return (
    <label className="block text-sm">
      <span className="mb-1 block text-slate-700 dark:text-slate-200">
        {props.label}
      </span>
      <select
        value={value}
        onChange={(e) => props.onChange(e.target.value)}
        className="w-full rounded-md border border-slate-300 bg-white pl-3 pr-9 py-1.5 text-sm shadow-sm focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
      >
        <option value="">— blank —</option>
        {!known && value !== '' && <option value={value}>{value}</option>}
        {props.options.map((opt) => (
          <option key={opt} value={opt}>
            {opt}
          </option>
        ))}
      </select>
    </label>
  );
}
