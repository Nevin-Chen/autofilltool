import {
  CURRENT_SCHEMA_VERSION,
  MAX_RESUME_VARIANTS,
  RESUME_LIBRARY_BUDGET_BYTES,
  ResumeLibrarySchema,
  type Profile,
  type Settings,
  type ResumeLibrary,
  type ResumeVariant,
  type SubmissionRecord,
  emptyProfile,
  defaultSettings,
  emptyResumeLibrary,
} from './schema';
import { resumeLibraryBytes } from './resume';
import { pruneCompanyChoices } from './resume-select';
import {
  migrateProfile,
  migrateSettings,
  migrateResume,
  migrateHistory,
} from './migrations';

export const STORAGE_KEYS = {
  profile: 'profile',
  settings: 'settings',
  resume: 'resume',
  history: 'history',
} as const;

export type StorageKey = (typeof STORAGE_KEYS)[keyof typeof STORAGE_KEYS];

type Envelope<T> = { schemaVersion: number; data: T };

function wrap<T>(data: T): Envelope<T> {
  return { schemaVersion: CURRENT_SCHEMA_VERSION, data };
}

async function rawGet<T>(key: StorageKey): Promise<Envelope<T> | undefined> {
  const got = await chrome.storage.local.get(key);
  const value = got[key];
  if (!value || typeof value !== 'object') return undefined;
  return value as Envelope<T>;
}

async function rawSet<T>(key: StorageKey, envelope: Envelope<T>): Promise<void> {
  await chrome.storage.local.set({ [key]: envelope });
}

export async function getProfile(): Promise<Profile> {
  const env = await rawGet<unknown>(STORAGE_KEYS.profile);
  if (!env) return emptyProfile();
  try {
    return migrateProfile(env.data, env.schemaVersion ?? 0);
  } catch (err) {
    console.warn('[autofilltool] profile failed validation; using empty', err);
    return emptyProfile();
  }
}

export async function setProfile(profile: Profile): Promise<void> {
  await rawSet(STORAGE_KEYS.profile, wrap(profile));
}

export async function getSettings(): Promise<Settings> {
  const env = await rawGet<unknown>(STORAGE_KEYS.settings);
  if (!env) return defaultSettings();
  try {
    return migrateSettings(env.data, env.schemaVersion ?? 0);
  } catch (err) {
    console.warn('[autofilltool] settings failed validation; using defaults', err);
    return defaultSettings();
  }
}

export async function setSettings(settings: Settings): Promise<void> {
  await rawSet(STORAGE_KEYS.settings, wrap(settings));
}

export async function getResumeLibrary(): Promise<ResumeLibrary> {
  const env = await rawGet<unknown>(STORAGE_KEYS.resume);
  if (!env) return emptyResumeLibrary();
  try {
    return migrateResume(env.data, env.schemaVersion ?? 0);
  } catch (err) {
    console.warn('[autofilltool] resume library failed validation; ignoring', err);
    return emptyResumeLibrary();
  }
}

export async function setResumeLibrary(library: ResumeLibrary): Promise<void> {
  await rawSet(STORAGE_KEYS.resume, wrap(ResumeLibrarySchema.parse(library)));
}

export async function addResumeVariant(variant: ResumeVariant): Promise<ResumeLibrary> {
  const library = await getResumeLibrary();
  if (library.variants.length >= MAX_RESUME_VARIANTS) {
    throw new Error(
      `You can store ${MAX_RESUME_VARIANTS} resumes. Remove one to add another.`,
    );
  }
  const projected = resumeLibraryBytes([...library.variants, variant]);
  if (projected > RESUME_LIBRARY_BUDGET_BYTES) {
    throw new Error(
      'Not enough local storage left for another resume. Remove one first.',
    );
  }
  const next: ResumeLibrary = {
    variants: [...library.variants, variant],
    activeId: library.activeId ?? variant.id,
  };
  await setResumeLibrary(next);
  return next;
}

export async function updateResumeVariant(
  id: string,
  patch: Partial<Omit<ResumeVariant, 'id'>>,
): Promise<ResumeLibrary> {
  const library = await getResumeLibrary();
  const next: ResumeLibrary = {
    ...library,
    variants: library.variants.map((v) => (v.id === id ? { ...v, ...patch } : v)),
  };
  await setResumeLibrary(next);
  return next;
}

export async function setDefaultResume(id: string): Promise<ResumeLibrary> {
  const library = await getResumeLibrary();
  if (!library.variants.some((v) => v.id === id)) return library;
  const next: ResumeLibrary = { ...library, activeId: id };
  await setResumeLibrary(next);
  return next;
}

export async function removeResumeVariant(id: string): Promise<ResumeLibrary> {
  const library = await getResumeLibrary();
  const variants = library.variants.filter((v) => v.id !== id);
  const next: ResumeLibrary = {
    variants,
    activeId: library.activeId === id ? (variants[0]?.id ?? null) : library.activeId,
  };
  await setResumeLibrary(next);

  const settings = await getSettings();
  const pruned = pruneCompanyChoices(settings.resume.companyChoices, next);
  if (
    Object.keys(pruned).length !== Object.keys(settings.resume.companyChoices).length
  ) {
    await setSettings({ ...settings, resume: { ...settings.resume, companyChoices: pruned } });
  }
  return next;
}

export async function getHistory(): Promise<SubmissionRecord[]> {
  const env = await rawGet<unknown>(STORAGE_KEYS.history);
  if (!env) return [];
  try {
    return migrateHistory(env.data, env.schemaVersion ?? 0);
  } catch (err) {
    console.warn('[autofilltool] history failed validation; starting fresh', err);
    return [];
  }
}

export async function pushHistory(entry: SubmissionRecord): Promise<void> {
  const list = await getHistory();
  const next = [entry, ...list];
  await rawSet(STORAGE_KEYS.history, wrap(next));
}

export async function clearHistory(): Promise<void> {
  await chrome.storage.local.remove(STORAGE_KEYS.history);
}

type Listener = (changed: Partial<Record<StorageKey, unknown>>) => void;

export function subscribe(listener: Listener): () => void {
  const watched = new Set<string>(Object.values(STORAGE_KEYS));
  const handler = (
    changes: { [key: string]: chrome.storage.StorageChange },
    areaName: chrome.storage.AreaName,
  ) => {
    if (areaName !== 'local') return;
    const interesting: Partial<Record<StorageKey, unknown>> = {};
    let any = false;
    for (const [key, change] of Object.entries(changes)) {
      if (watched.has(key)) {
        interesting[key as StorageKey] = change.newValue;
        any = true;
      }
    }
    if (any) listener(interesting);
  };
  chrome.storage.onChanged.addListener(handler);
  return () => chrome.storage.onChanged.removeListener(handler);
}
