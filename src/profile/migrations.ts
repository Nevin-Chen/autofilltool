import {
  CURRENT_SCHEMA_VERSION,
  ProfileSchema,
  SettingsSchema,
  ResumeRecordSchema,
  SubmissionRecordSchema,
} from './schema';

/**
 * Migrations run in order from the stored `schemaVersion` up to
 * CURRENT_SCHEMA_VERSION. Each step receives the previous step's output and
 * returns the next shape. Keep them small and idempotent.
 *
 * For v1 (initial), there are no migrations — but the wiring is here so future
 * changes (e.g., renaming a field, splitting `links` into multiple records)
 * have an obvious home.
 */

type MigrationFn = (raw: unknown) => unknown;

const profileMigrations: Record<number, MigrationFn> = {};

const settingsMigrations: Record<number, MigrationFn> = {};
const resumeMigrations: Record<number, MigrationFn> = {};
const historyMigrations: Record<number, MigrationFn> = {};

function runMigrations(
  raw: unknown,
  fromVersion: number,
  table: Record<number, MigrationFn>,
): unknown {
  let current = raw;
  for (let v = fromVersion; v < CURRENT_SCHEMA_VERSION; v++) {
    const fn = table[v];
    if (fn) current = fn(current);
  }
  return current;
}

export function migrateProfile(raw: unknown, fromVersion: number) {
  const migrated = runMigrations(raw, fromVersion, profileMigrations);
  return ProfileSchema.parse(migrated);
}

export function migrateSettings(raw: unknown, fromVersion: number) {
  const migrated = runMigrations(raw, fromVersion, settingsMigrations);
  return SettingsSchema.parse(migrated);
}

export function migrateResume(raw: unknown, fromVersion: number) {
  const migrated = runMigrations(raw, fromVersion, resumeMigrations);
  return ResumeRecordSchema.parse(migrated);
}

export function migrateHistory(raw: unknown, fromVersion: number) {
  const migrated = runMigrations(raw, fromVersion, historyMigrations);
  if (!Array.isArray(migrated)) return [];
  return migrated.map((entry) => SubmissionRecordSchema.parse(entry));
}
