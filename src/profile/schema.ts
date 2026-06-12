import { z } from 'zod';

export const CURRENT_SCHEMA_VERSION = 1 as const;

export const AddressSchema = z.object({
  line1: z.string().default(''),
  line2: z.string().default(''),
  city: z.string().default(''),
  region: z.string().default(''),
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

export const WorkAuthSchema = z.object({
  authorizedToWorkInUS: z.boolean().nullable().default(null),
  requiresSponsorship: z.boolean().nullable().default(null),
  willingToRelocate: z.boolean().nullable().default(null),
  noticePeriodWeeks: z.number().int().nonnegative().nullable().default(null),
  desiredSalary: z.string().default(''),
});
export type WorkAuth = z.infer<typeof WorkAuthSchema>;

export const DemographicsSchema = z.object({
  gender: z.string().nullable().default(null),
  pronouns: z.string().nullable().default(null),
  ethnicity: z.string().nullable().default(null),
  race: z.string().nullable().default(null),
  veteranStatus: z.string().nullable().default(null),
  disabilityStatus: z.string().nullable().default(null),
});
export type Demographics = z.infer<typeof DemographicsSchema>;

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
  phoneCountry: z.string().default(''),

  address: AddressSchema.default({}),
  links: LinksSchema.default({}),
  workAuth: WorkAuthSchema.default({}),
  demographics: DemographicsSchema.default({}),
  defaultCoverLetter: z.string().default(''),
  savedAnswers: z.array(SavedAnswerSchema).default([]),
});
export type Profile = z.infer<typeof ProfileSchema>;

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

export const AiSettingsSchema = z.object({
  provider: AiProviderSchema.default('none'),
  apiKey: z.string().default(''),
  model: z.string().default(''),
  endpoint: z.string().default(''),
  cacheResponses: z.boolean().default(false),
  fallbackClassifier: z.boolean().default(false),
  fallbackIncludeCompliance: z.boolean().default(false),
  autoFillSuggestFields: z.boolean().default(false),
});
export type AiSettings = z.infer<typeof AiSettingsSchema>;

export const TrackingSettingsSchema = z.object({
  webhookUrl: z
    .string()
    .url()
    .startsWith('https://', { message: 'Webhook must use https://' })
    .or(z.literal(''))
    .default(''),
});
export type TrackingSettings = z.infer<typeof TrackingSettingsSchema>;

export const UiSettingsSchema = z.object({
  animateFill: z.boolean().default(true),
});
export type UiSettings = z.infer<typeof UiSettingsSchema>;

export const SettingsSchema = z.object({
  enabledAdapters: z.array(AdapterIdSchema).default([
    'greenhouse',
    'lever',
    'ashby',
    'workday',
    'generic',
  ]),
  forceOverwrite: z.boolean().default(false),
  perSiteAllowlist: z.array(z.string()).default([]),
  ai: AiSettingsSchema.default({}),
  tracking: TrackingSettingsSchema.default({}),
  ui: UiSettingsSchema.default({}),
});
export type Settings = z.infer<typeof SettingsSchema>;

export const ResumeRecordSchema = z.object({
  filename: z.string().min(1),
  mimeType: z.string().min(1),
  size: z.number().int().nonnegative(),
  bytesBase64: z.string(),
  uploadedAt: z.string().datetime(),
  extractedText: z.string().optional(),
});
export type ResumeRecord = z.infer<typeof ResumeRecordSchema>;

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
  source: AdapterIdSchema,
  status: SubmissionStatusSchema,
  note: z.string().default(''),
});
export type SubmissionRecord = z.infer<typeof SubmissionRecordSchema>;

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

export function emptyProfile(): Profile {
  return ProfileSchema.parse({});
}

export function defaultSettings(): Settings {
  return SettingsSchema.parse({});
}
