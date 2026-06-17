import { describe, expect, it } from 'vitest';
import {
  ProfileSchema,
  SettingsSchema,
  ResumeRecordSchema,
  emptyProfile,
  defaultSettings,
  activeApiKey,
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

  it('defaults the education block to empty strings', () => {
    expect(emptyProfile().education).toEqual({
      school: '',
      degree: '',
      fieldOfStudy: '',
      gradYear: '',
    });
  });

  it('backfills education for profiles stored before the field existed', () => {
    const migrated = migrateProfile({ firstName: 'Ada' }, CURRENT_SCHEMA_VERSION);
    expect(migrated.education.school).toBe('');
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

  it('defaults apiKeys to an empty map; activeApiKey() returns "" for "none"', () => {
    const s = defaultSettings();
    expect(s.ai.apiKeys).toEqual({});
    expect(activeApiKey(s.ai)).toBe('');
  });

  it('activeApiKey() returns the per-provider entry once one is set', () => {
    const s = defaultSettings();
    const ai = {
      ...s.ai,
      provider: 'openai' as const,
      apiKeys: { openai: 'sk-test', anthropic: 'sk-ant' },
    };
    expect(activeApiKey(ai)).toBe('sk-test');
    expect(activeApiKey({ ...ai, provider: 'anthropic' })).toBe('sk-ant');
    expect(activeApiKey({ ...ai, provider: 'gemini' })).toBe('');
  });

  it('defaults the per-provider models map to empty', () => {
    expect(defaultSettings().ai.models).toEqual({});
  });

  it('persists per-provider models so switching providers does not lose them', () => {
    const r = SettingsSchema.safeParse({
      ...defaultSettings(),
      ai: {
        provider: 'gemini',
        model: 'gemini-2.5-flash',
        models: { ollama: 'qwen2.5:14b', gemini: 'gemini-2.5-flash' },
      },
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.ai.models.ollama).toBe('qwen2.5:14b');
    }
  });

  it('backfills models={} for settings stored before the field existed', () => {
    const migrated = migrateSettings(
      { ai: { provider: 'ollama', model: 'qwen2.5:14b' } },
      CURRENT_SCHEMA_VERSION,
    );
    expect(migrated.ai.models).toEqual({});
  });
});

describe('AI settings v1 → v2 migration', () => {
  it('backfills the old shared apiKey into apiKeys under its provider', () => {
    const v1 = {
      ai: {
        provider: 'gemini',
        apiKey: 'AIza-test',
        model: 'gemini-2.5-flash',
        endpoint: '',
        cacheResponses: false,
      },
    };
    const migrated = migrateSettings(v1, 1);
    expect(migrated.ai.provider).toBe('gemini');
    expect(migrated.ai.apiKeys).toEqual({ gemini: 'AIza-test' });
  });

  it('does NOT backfill ollama or none (their old apiKey was a stale leak)', () => {
    for (const provider of ['ollama', 'none'] as const) {
      const migrated = migrateSettings(
        {
          ai: {
            provider,
            apiKey: 'sk-leaked-from-openai',
            model: '',
            endpoint: '',
            cacheResponses: false,
          },
        },
        1,
      );
      expect(migrated.ai.apiKeys).toEqual({});
    }
  });

  it('respects an existing apiKeys[provider] entry over the old apiKey', () => {
    const migrated = migrateSettings(
      {
        ai: {
          provider: 'openai',
          apiKey: 'sk-old',
          apiKeys: { openai: 'sk-new' },
          model: '',
          endpoint: '',
          cacheResponses: false,
        },
      },
      1,
    );
    expect(migrated.ai.apiKeys.openai).toBe('sk-new');
  });

  it('drops the old apiKey field entirely after migration', () => {
    const migrated = migrateSettings(
      {
        ai: {
          provider: 'anthropic',
          apiKey: 'sk-ant-test',
          model: '',
          endpoint: '',
          cacheResponses: false,
        },
      },
      1,
    );
    expect((migrated.ai as unknown as Record<string, unknown>).apiKey).toBeUndefined();
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
