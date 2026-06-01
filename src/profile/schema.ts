import { z } from 'zod';

/** Bump on any on-disk shape change needing a runtime migration (./migrations.ts). */
export const CURRENT_SCHEMA_VERSION = 1 as const;

/* ------------------------------------------------------------------ Profile */

export const AddressSchema = z.object({
  line1: z.string().default(''),
  line2: z.string().default(''),
  city: z.string().default(''),
  region: z.string().default(''), // state/province
  postalCode: z.string().default(''),
  country: z.string().default(''),
});
export type Address = z.infer<typeof AddressSchema>;

export const LinksSchema = z.object({
  linkedin: z.string().default(''),
  github: z.string().default(''),
  portfolio: z.string().default(''),
  twitter: z.string().default(''),
  other: z.string().default(''),
});
export type Links = z.infer<typeof LinksSchema>;

/**
 * Work authorization. All fields are nullable because users may want to leave
 * them blank rather than say "no" — that's important on EEO-adjacent questions.
 */
export const WorkAuthSchema = z.object({
  authorizedToWorkInUS: z.boolean().nullable().default(null),
  requiresSponsorship: z.boolean().nullable().default(null),
  willingToRelocate: z.boolean().nullable().default(null),
  noticePeriodWeeks: z.number().int().nonnegative().nullable().default(null),
  desiredSalary: z.string().default(''), // free text; users phrase this differently
});
export type WorkAuth = z.infer<typeof WorkAuthSchema>;

/**
 * Demographics — strictly optional, all nullable. We never pre-fill these
 * unless the user has explicitly entered a value.
 */
export const DemographicsSchema = z.object({
  gender: z.string().nullable().default(null),
  pronouns: z.string().nullable().default(null),
  ethnicity: z.string().nullable().default(null),
  veteranStatus: z.string().nullable().default(null),
  disabilityStatus: z.string().nullable().default(null),
});
export type Demographics = z.infer<typeof DemographicsSchema>;

/**
 * A canned answer the user has saved for an open-ended question they tend to
 * see repeatedly ("Why this company?" etc.). Matched by `questionPattern` —
 * a substring (case-insensitive) of the question label on the page.
 */
export const SavedAnswerSchema = z.object({
  id: z.string().uuid(),
  questionPattern: z.string().min(1),
  answer: z.string(),
  updatedAt: z.string().datetime(),
});
export type SavedAnswer = z.infer<typeof SavedAnswerSchema>;

export const ProfileSchema = z.object({
  firstName: z.string().default(''),
  lastName: z.string().default(''),
  preferredName: z.string().default(''),
  email: z.string().email().or(z.literal('')).default(''),
  phone: z.string().default(''),
  address: AddressSchema.default({}),
  links: LinksSchema.default({}),
  workAuth: WorkAuthSchema.default({}),
  demographics: DemographicsSchema.default({}),
  defaultCoverLetter: z.string().default(''),
  savedAnswers: z.array(SavedAnswerSchema).default([]),
});
export type Profile = z.infer<typeof ProfileSchema>;

/* ----------------------------------------------------------------- Settings */

export const AdapterIdSchema = z.enum([
  'greenhouse',
  'lever',
  'ashby',
  'workday',
  'generic',
]);
export type AdapterId = z.infer<typeof AdapterIdSchema>;

export const AiProviderSchema = z.enum([
  'openai',
  'anthropic',
  'gemini',
  'ollama',
  'none',
]);
export type AiProvider = z.infer<typeof AiProviderSchema>;

/** `endpoint` is Ollama-only: a remote host base URL; the fetch appends the chat path. */
export const AiSettingsSchema = z.object({
  provider: AiProviderSchema.default('none'),
  apiKey: z.string().default(''), // stored in chrome.storage.local only, never synced
  model: z.string().default(''),
  endpoint: z.string().default(''), // Ollama only; blank → http://localhost:11434
  cacheResponses: z.boolean().default(false),
});
export type AiSettings = z.infer<typeof AiSettingsSchema>;

export const TrackingSettingsSchema = z.object({
  webhookUrl: z
    .string()
    .url()
    .startsWith('https://', { message: 'Webhook must use https://' })
    .or(z.literal(''))
    .default(''),
  // Opt-in: auto-log when the user's own submit succeeds, skipping the pill.
  autoLogOnSubmit: z.boolean().default(false),
});
export type TrackingSettings = z.infer<typeof TrackingSettingsSchema>;

export const SettingsSchema = z.object({
  enabledAdapters: z.array(AdapterIdSchema).default([
    'greenhouse',
    'lever',
    'ashby',
    'workday',
    'generic',
  ]),
  forceOverwrite: z.boolean().default(false),
  perSiteAllowlist: z.array(z.string()).default([]), // hostnames
  ai: AiSettingsSchema.default({}),
  tracking: TrackingSettingsSchema.default({}),
});
export type Settings = z.infer<typeof SettingsSchema>;

/* --------------------------------------------------------------- Resume */

/**
 * Stored separately from Profile in chrome.storage because of size.
 * `bytesBase64` is the raw file content. Reconstructed into a File at fill time.
 */
export const ResumeRecordSchema = z.object({
  filename: z.string().min(1),
  mimeType: z.string().min(1),
  size: z.number().int().nonnegative(),
  bytesBase64: z.string(), // base64 of the file contents
  uploadedAt: z.string().datetime(),
});
export type ResumeRecord = z.infer<typeof ResumeRecordSchema>;

/* --------------------------------------------------------------- History */

export const SubmissionStatusSchema = z.enum([
  'filled',
  'submitted',
  'skipped',
  'error',
]);
export type SubmissionStatus = z.infer<typeof SubmissionStatusSchema>;

export const SubmissionRecordSchema = z.object({
  id: z.string().uuid(),
  timestamp: z.string().datetime(),
  company: z.string().default(''),
  role: z.string().default(''),
  jobUrl: z.string().default(''),
  source: AdapterIdSchema, // which adapter handled it
  status: SubmissionStatusSchema,
  note: z.string().default(''),
});
export type SubmissionRecord = z.infer<typeof SubmissionRecordSchema>;

/* --------------------------------------------------- Envelope on disk */

/** Each storage key holds a versioned envelope; ./store.ts validates + migrates on read. */
export const ProfileEnvelopeSchema = z.object({
  schemaVersion: z.literal(CURRENT_SCHEMA_VERSION),
  data: ProfileSchema,
});
export type ProfileEnvelope = z.infer<typeof ProfileEnvelopeSchema>;

export const SettingsEnvelopeSchema = z.object({
  schemaVersion: z.literal(CURRENT_SCHEMA_VERSION),
  data: SettingsSchema,
});
export type SettingsEnvelope = z.infer<typeof SettingsEnvelopeSchema>;

export const ResumeEnvelopeSchema = z.object({
  schemaVersion: z.literal(CURRENT_SCHEMA_VERSION),
  data: ResumeRecordSchema,
});
export type ResumeEnvelope = z.infer<typeof ResumeEnvelopeSchema>;

export const HistoryEnvelopeSchema = z.object({
  schemaVersion: z.literal(CURRENT_SCHEMA_VERSION),
  data: z.array(SubmissionRecordSchema),
});
export type HistoryEnvelope = z.infer<typeof HistoryEnvelopeSchema>;

/* --------------------------------------------------- Convenience defaults */

/**
 * Builds an empty Profile by feeding `{}` through the schema. Every leaf has
 * `.default(...)`, so this never throws and matches what we want on first run.
 */
export function emptyProfile(): Profile {
  return ProfileSchema.parse({});
}

export function defaultSettings(): Settings {
  return SettingsSchema.parse({});
}
