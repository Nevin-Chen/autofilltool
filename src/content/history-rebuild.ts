import type {
  DetectedField,
  HistoryEditor,
  HistoryEntrySummary,
  HistoryGroupKind,
} from '@/adapters/types';
import {
  hasHistoryContent,
  MAX_HISTORY_ENTRIES,
  type Education,
  type Experience,
  type Profile,
} from '@/profile/schema';
import { looksLikeSubmit, type FillAction } from './filler';

const STEP_TIMEOUT_MS = 3000;
const POLL_MS = 50;

const SECTION_LABELS: Readonly<Record<HistoryGroupKind, string>> = {
  experience: 'Work history',
  education: 'Education',
};

const QUIET_SKIPS: ReadonlySet<string> = new Set([
  'no value in profile',
  'input is disabled',
  'already in desired state',
]);

export type HistoryFill = (field: DetectedField) => Promise<FillAction>;

export type HistoryOutcome = { action: FillAction; el: HTMLElement | null };

type SavedEntry = { index: number; summary: HistoryEntrySummary };

export async function rebuildHistory(
  root: Document,
  editor: HistoryEditor,
  profile: Profile,
  fill: HistoryFill,
): Promise<HistoryOutcome[]> {
  const out: HistoryOutcome[] = [];
  for (const kind of ['experience', 'education'] as const) {
    const wanted = savedEntries(profile, kind);
    if (wanted.length === 0) continue;
    out.push(...(await rebuildSection(root, editor, kind, wanted, fill)));
  }
  return out;
}

async function rebuildSection(
  root: Document,
  editor: HistoryEditor,
  kind: HistoryGroupKind,
  wanted: SavedEntry[],
  fill: HistoryFill,
): Promise<HistoryOutcome[]> {
  const section = SECTION_LABELS[kind];
  const outcome = (
    status: FillAction['status'],
    note: string,
    el: HTMLElement | null,
    label = section,
  ): HistoryOutcome => ({ action: { label, kind, status, note }, el });

  if (!editor.addButton(root, kind)) return [];

  const open = editor.openForm(root, kind);
  if (open) {
    return [outcome('skipped', 'an entry is open for editing; save or cancel it, then fill again', open)];
  }

  const existing = editor.entries(root, kind);
  const onPage = existing.map((entry) => editor.summary(entry));
  if (sameEntries(onPage, wanted.map((w) => w.summary))) {
    return [outcome('skipped', 'entries already match your profile', existing[0] ?? null)];
  }

  for (const entry of existing) {
    if (!(await removeEntry(root, editor, entry))) {
      return [outcome('error', 'could not delete an entry the page already had', entry)];
    }
  }

  const out: HistoryOutcome[] = [];
  const order = editor.newEntryFirst ? [...wanted].reverse() : wanted;
  for (const saved of order) {
    const label = entryLabel(section, wanted.indexOf(saved), saved.summary);
    const form = await openNewEntry(root, editor, kind);
    if (!form) {
      out.push(outcome('error', 'the Add button did not open a new entry', null, label));
      break;
    }
    const results: FillAction[] = [];
    for (const field of editor.formFields(form, { kind, index: saved.index })) {
      results.push(await fill(field));
    }
    if (!(await saveEntry(root, editor, kind, form))) {
      out.push(
        outcome(
          'error',
          'the form did not accept this entry; it is left open so you can fix it',
          form,
          label,
        ),
      );
      break;
    }
    const cards = editor.entries(root, kind);
    const card = (editor.newEntryFirst ? cards[0] : cards[cards.length - 1]) ?? null;
    out.push(outcome('filled', entryNote(results), card, label));
  }
  return out;
}

function savedEntries(profile: Profile, kind: HistoryGroupKind): SavedEntry[] {
  const entries: ReadonlyArray<Experience | Education> = profile[kind];
  const out: SavedEntry[] = [];
  entries.forEach((entry, index) => {
    if (hasHistoryContent(entry)) out.push({ index, summary: summaryOf(entry) });
  });
  return out.slice(0, MAX_HISTORY_ENTRIES);
}

function summaryOf(entry: Experience | Education): HistoryEntrySummary {
  return 'employer' in entry
    ? { title: entry.jobTitle, detail: entry.employer }
    : { title: entry.school, detail: entry.fieldOfStudy };
}

function sameEntries(
  onPage: HistoryEntrySummary[],
  wanted: HistoryEntrySummary[],
): boolean {
  if (onPage.length !== wanted.length) return false;
  return onPage.every((entry, i) => {
    const want = wanted[i]!;
    return comparable(entry.title) === comparable(want.title) &&
      comparable(entry.detail) === comparable(want.detail);
  });
}

function comparable(text: string): string {
  return text.replace(/\s+/g, ' ').trim().toLowerCase();
}

function entryLabel(section: string, position: number, summary: HistoryEntrySummary): string {
  const parts = [summary.title, summary.detail].map((s) => s.trim()).filter(Boolean);
  const base = `${section} ${position + 1}`;
  return parts.length > 0 ? `${base}: ${parts.join(', ')}` : base;
}

function entryNote(results: FillAction[]): string {
  const filled = results.filter((r) => r.status === 'filled').length;
  const misses = results
    .filter((r) => r.status !== 'filled' && !QUIET_SKIPS.has(r.note ?? ''))
    .map((r) => `${r.label}: ${r.note ?? r.status}`);
  const head = `filled ${filled} field${filled === 1 ? '' : 's'}`;
  return misses.length > 0 ? `${head}; ${misses.join('; ')}` : head;
}

async function removeEntry(
  root: Document,
  editor: HistoryEditor,
  entry: HTMLElement,
): Promise<boolean> {
  const remove = editor.removeButton(entry);
  if (!remove || isSubmitShaped(remove)) return false;
  remove.click();
  const confirm = await waitFor(root, () => editor.confirmRemoveButton(root));
  if (!confirm || isSubmitShaped(confirm)) return false;
  confirm.click();
  return (await waitFor(root, () => (entry.isConnected ? null : entry))) !== null;
}

async function openNewEntry(
  root: Document,
  editor: HistoryEditor,
  kind: HistoryGroupKind,
): Promise<HTMLElement | null> {
  const add = editor.addButton(root, kind);
  if (!add || isSubmitShaped(add)) return null;
  add.click();
  return waitFor(root, () => editor.openForm(root, kind));
}

async function saveEntry(
  root: Document,
  editor: HistoryEditor,
  kind: HistoryGroupKind,
  form: HTMLElement,
): Promise<boolean> {
  const save = editor.saveButton(form);
  if (!save || isSubmitShaped(save)) return false;
  save.click();
  return (await waitFor(root, () => (editor.openForm(root, kind) ? null : form))) !== null;
}

function isSubmitShaped(button: HTMLElement): boolean {
  let node: HTMLElement | null = button;
  while (node) {
    if (looksLikeSubmit(node)) return true;
    const scope = node.getRootNode();
    node = scope instanceof ShadowRoot ? (scope.host as HTMLElement) : null;
  }
  return false;
}

function waitFor<T>(root: Document, probe: () => T | null): Promise<T | null> {
  const view = root.defaultView ?? window;
  const started = Date.now();
  return new Promise((resolve) => {
    const poll = (): void => {
      const found = probe();
      if (found !== null) return resolve(found);
      if (Date.now() - started >= STEP_TIMEOUT_MS) return resolve(null);
      view.setTimeout(poll, POLL_MS);
    };
    poll();
  });
}
