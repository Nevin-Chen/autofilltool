import { describe, expect, it } from 'vitest';
import {
  ProfileSchema,
  SettingsSchema,
  ResumeRecordSchema,
  emptyProfile,
  defaultSettings,
  CURRENT_SCHEMA_VERSION,
} from '@/profile/schema';
import {
  migrateProfile,
  migrateSettings,
  migrateResume,
} from '@/profile/migrations';

describe('profile schema', () => {
  it('emptyProfile() round-trips through ProfileSchema', () => {
    const p = emptyProfile();
    const parsed = ProfileSchema.parse(p);
    expect(parsed.firstName).toBe('');
    expect(parsed.address.country).toBe('');
    expect(parsed.workAuth.authorizedToWorkInUS).toBeNull();
    expect(parsed.savedAnswers).toEqual([]);
  });

  it('rejects an invalid email', () => {
    const r = ProfileSchema.safeParse({ ...emptyProfile(), email: 'not-an-email' });
    expect(r.success).toBe(false);
  });

  it('accepts an empty email (means "not set yet")', () => {
    const r = ProfileSchema.safeParse({ ...emptyProfile(), email: '' });
    expect(r.success).toBe(true);
  });
});

describe('settings schema', () => {
  it('defaults to all adapters enabled and overwrite off', () => {
    const s = defaultSettings();
    expect(s.forceOverwrite).toBe(false);
    expect(s.enabledAdapters).toContain('generic');
    expect(s.enabledAdapters).toContain('greenhouse');
    expect(s.ai.provider).toBe('none');
    expect(s.ai.endpoint).toBe('');
    expect(s.tracking.webhookUrl).toBe('');
  });

  it('accepts ollama as a provider with a custom endpoint', () => {
    const r = SettingsSchema.safeParse({
      ...defaultSettings(),
      ai: {
        provider: 'ollama',
        apiKey: '',
        model: 'llama3.2',
        endpoint: 'http://localhost:11434',
        cacheResponses: false,
      },
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.ai.provider).toBe('ollama');
      expect(r.data.ai.endpoint).toBe('http://localhost:11434');
    }
  });

  it('rejects an http:// webhook url', () => {
    const r = SettingsSchema.safeParse({
      ...defaultSettings(),
      tracking: { webhookUrl: 'http://example.com/hook' },
    });
    expect(r.success).toBe(false);
  });

  it('accepts an https:// webhook url', () => {
    const r = SettingsSchema.safeParse({
      ...defaultSettings(),
      tracking: { webhookUrl: 'https://script.google.com/macros/s/abc/exec' },
    });
    expect(r.success).toBe(true);
  });
});

describe('resume schema', () => {
  it('requires non-empty filename and mimeType', () => {
    const bad = ResumeRecordSchema.safeParse({
      filename: '',
      mimeType: '',
      size: 0,
      bytesBase64: '',
      uploadedAt: new Date().toISOString(),
    });
    expect(bad.success).toBe(false);
  });

  it('accepts a well-formed record', () => {
    const good = ResumeRecordSchema.safeParse({
      filename: 'resume.pdf',
      mimeType: 'application/pdf',
      size: 1234,
      bytesBase64: 'AAAA',
      uploadedAt: new Date().toISOString(),
    });
    expect(good.success).toBe(true);
  });
});

describe('migrations', () => {
  it('passes a v1 profile through unchanged', () => {
    const p = emptyProfile();
    const out = migrateProfile(p, CURRENT_SCHEMA_VERSION);
    expect(out).toEqual(p);
  });

  it('migrateSettings yields defaults for empty input', () => {
    const out = migrateSettings({}, CURRENT_SCHEMA_VERSION);
    expect(out.forceOverwrite).toBe(false);
  });

  it('migrateResume throws on garbage', () => {
    expect(() => migrateResume({ junk: true }, CURRENT_SCHEMA_VERSION)).toThrow();
  });
});
