import {
  MAX_HISTORY_ENTRIES,
  emptyEducation,
  emptyExperience,
  type Education,
  type Experience,
} from '@/profile/schema';
import { Section } from './Section';
import { Grid, SelectField, TextField } from './fields';

const DEGREE_OPTIONS = [
  'High School Diploma',
  "Associate's Degree",
  "Bachelor's Degree",
  "Master's Degree",
  'MBA',
  'PhD',
  'Other',
] as const;

export function ExperienceSection(props: {
  entries: Experience[];
  onChange: (entries: Experience[]) => void;
}) {
  const list = entryControlsFor(props.entries, props.onChange, emptyExperience);
  return (
    <Section title="Work history" collapsible defaultCollapsed>
      <EntryList
        count={props.entries.length}
        noun="job"
        onAdd={list.add}
        render={(index) => {
          const entry = props.entries[index]!;
          const set = <K extends keyof Experience>(key: K, value: Experience[K]) =>
            list.update(index, { [key]: value } as Partial<Experience>);
          return (
            <EntryCard
              key={index}
              title={entryTitle(entry.jobTitle, entry.employer, `Job ${index + 1}`)}
              index={index}
              count={props.entries.length}
              controls={list}
            >
              <Grid>
                <TextField
                  label="Job title"
                  value={entry.jobTitle}
                  onChange={(v) => set('jobTitle', v)}
                />
                <TextField
                  label="Company"
                  value={entry.employer}
                  onChange={(v) => set('employer', v)}
                />
                <TextField
                  label="Location"
                  value={entry.location}
                  onChange={(v) => set('location', v)}
                />
                <label className="flex items-end pb-1.5 text-sm">
                  <input
                    type="checkbox"
                    checked={entry.current}
                    onChange={(e) => set('current', e.target.checked)}
                    className="mr-2 h-4 w-4 rounded border-slate-300 text-sky-600 focus:ring-sky-500 dark:border-slate-600"
                  />
                  <span className="text-slate-700 dark:text-slate-200">I currently work here</span>
                </label>
                <TextField
                  label="From"
                  value={entry.startDate}
                  onChange={(v) => set('startDate', v)}
                  type="month"
                />
                {!entry.current && (
                  <TextField
                    label="To"
                    value={entry.endDate}
                    onChange={(v) => set('endDate', v)}
                    type="month"
                  />
                )}
              </Grid>
              <label className="mt-3 block text-sm">
                <span className="mb-1 block text-slate-700 dark:text-slate-200">What you did</span>
                <textarea
                  value={entry.description}
                  onChange={(e) => set('description', e.target.value)}
                  rows={4}
                  className="w-full rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm shadow-sm focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                />
              </label>
            </EntryCard>
          );
        }}
      />
    </Section>
  );
}

export function EducationSection(props: {
  entries: Education[];
  onChange: (entries: Education[]) => void;
}) {
  const list = entryControlsFor(props.entries, props.onChange, emptyEducation);
  return (
    <Section title="Education" collapsible defaultCollapsed>
      <EntryList
        count={props.entries.length}
        noun="school"
        onAdd={list.add}
        render={(index) => {
          const entry = props.entries[index]!;
          const set = <K extends keyof Education>(key: K, value: Education[K]) =>
            list.update(index, { [key]: value } as Partial<Education>);
          return (
            <EntryCard
              key={index}
              title={entryTitle(entry.school, entry.degree, `School ${index + 1}`)}
              index={index}
              count={props.entries.length}
              controls={list}
            >
              <Grid>
                <TextField
                  label="School / University"
                  value={entry.school}
                  onChange={(v) => set('school', v)}
                />
                <SelectField
                  label="Degree"
                  value={entry.degree}
                  options={DEGREE_OPTIONS}
                  onChange={(v) => set('degree', v)}
                />
                <TextField
                  label="Field of study / major"
                  value={entry.fieldOfStudy}
                  onChange={(v) => set('fieldOfStudy', v)}
                />
                <TextField
                  label="Graduation year"
                  value={entry.gradYear}
                  onChange={(v) => set('gradYear', v)}
                />
                <TextField
                  label="From"
                  value={entry.startDate}
                  onChange={(v) => set('startDate', v)}
                  type="month"
                />
                <TextField
                  label="To"
                  value={entry.endDate}
                  onChange={(v) => set('endDate', v)}
                  type="month"
                />
                <TextField label="GPA" value={entry.gpa} onChange={(v) => set('gpa', v)} />
              </Grid>
            </EntryCard>
          );
        }}
      />
    </Section>
  );
}

type EntryControls = {
  add: () => void;
  remove: (index: number) => void;
  move: (index: number, delta: number) => void;
};

function entryControlsFor<T>(
  entries: T[],
  onChange: (next: T[]) => void,
  blank: () => T,
): EntryControls & { update: (index: number, patch: Partial<T>) => void } {
  return {
    add: () => {
      if (entries.length >= MAX_HISTORY_ENTRIES) return;
      onChange([...entries, blank()]);
    },
    remove: (index) => onChange(entries.filter((_, i) => i !== index)),
    move: (index, delta) => {
      const target = index + delta;
      if (target < 0 || target >= entries.length) return;
      const next = [...entries];
      const moved = next[index]!;
      next[index] = next[target]!;
      next[target] = moved;
      onChange(next);
    },
    update: (index, patch) =>
      onChange(entries.map((e, i) => (i === index ? { ...e, ...patch } : e))),
  };
}

function EntryList(props: {
  count: number;
  noun: string;
  onAdd: () => void;
  render: (index: number) => React.ReactNode;
}) {
  const full = props.count >= MAX_HISTORY_ENTRIES;
  return (
    <div className="space-y-3">
      {props.count === 0 ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">No {props.noun}s saved yet.</p>
      ) : (
        Array.from({ length: props.count }, (_, i) => props.render(i))
      )}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={props.onAdd}
          disabled={full}
          className="rounded-md bg-sky-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-sky-500 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500 dark:disabled:bg-slate-700 dark:disabled:text-slate-400"
        >
          Add {props.noun}
        </button>
        {full && (
          <span className="text-xs text-slate-500 dark:text-slate-400">
            {MAX_HISTORY_ENTRIES} is the limit.
          </span>
        )}
      </div>
    </div>
  );
}

function EntryCard(props: {
  title: string;
  index: number;
  count: number;
  controls: EntryControls;
  children: React.ReactNode;
}) {
  const { index, count, controls } = props;
  return (
    <div className="rounded-md border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-800">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="truncate text-sm font-medium text-slate-800 dark:text-slate-100">
          {props.title}
        </h3>
        <div className="flex shrink-0 items-center gap-1">
          <IconButton
            label={`Move ${props.title} earlier`}
            disabled={index === 0}
            onClick={() => controls.move(index, -1)}
          >
            ↑
          </IconButton>
          <IconButton
            label={`Move ${props.title} later`}
            disabled={index === count - 1}
            onClick={() => controls.move(index, 1)}
          >
            ↓
          </IconButton>
          <button
            type="button"
            onClick={() => controls.remove(index)}
            className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-sky-500 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700"
          >
            Remove
          </button>
        </div>
      </div>
      {props.children}
    </div>
  );
}

function IconButton(props: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={props.label}
      disabled={props.disabled}
      onClick={props.onClick}
      className="rounded-md border border-slate-300 px-2 py-1 text-xs leading-none text-slate-700 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-sky-500 disabled:cursor-not-allowed disabled:text-slate-300 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700 dark:disabled:text-slate-600"
    >
      {props.children}
    </button>
  );
}

function entryTitle(primary: string, secondary: string, fallback: string): string {
  const parts = [primary.trim(), secondary.trim()].filter(Boolean);
  return parts.length > 0 ? parts.join(' · ') : fallback;
}
