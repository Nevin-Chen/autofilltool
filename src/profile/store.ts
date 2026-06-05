import {
  CURRENT_SCHEMA_VERSION,
  type Profile,
  type Settings,
  type ResumeRecord,
  type SubmissionRecord,
  emptyProfile,
  defaultSettings,
} from './schema';
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

export async function getResume(): Promise<ResumeRecord | null> {
  const env = await rawGet<unknown>(STORAGE_KEYS.resume);
  if (!env) return null;
  try {
    return migrateResume(env.data, env.schemaVersion ?? 0);
  } catch (err) {
    console.warn('[autofilltool] resume failed validation; ignoring', err);
    return null;
  }
}

export async function setResume(record: ResumeRecord): Promise<void> {
  await rawSet(STORAGE_KEYS.resume, wrap(record));
}

export async function clearResume(): Promise<void> {
  await chrome.storage.local.remove(STORAGE_KEYS.resume);
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
