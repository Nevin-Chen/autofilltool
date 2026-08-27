import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  getResumeLibrary,
  setResumeLibrary,
  addResumeVariant,
  updateResumeVariant,
  setDefaultResume,
  removeResumeVariant,
  getSettings,
  setSettings,
} from '@/profile/store';
import { defaultVariant } from '@/profile/resume-select';
import {
  CURRENT_SCHEMA_VERSION,
  MAX_RESUME_VARIANTS,
  defaultSettings,
  type ResumeVariant,
} from '@/profile/schema';
import { LEGACY_RESUME_VARIANT_ID } from '@/profile/migrations';

const store: Record<string, unknown> = {};

beforeEach(() => {
  for (const key of Object.keys(store)) delete store[key];
  vi.stubGlobal('chrome', {
    storage: {
      local: {
        get: vi.fn(async (key: string) => ({ [key]: store[key] })),
        set: vi.fn(async (obj: Record<string, unknown>) => {
          Object.assign(store, obj);
        }),
        remove: vi.fn(async (key: string) => {
          delete store[key];
        }),
      },
    },
  });
});

function variant(id: string, label: string, bytes = 'AAAA'): ResumeVariant {
  return {
    id,
    label,
    filename: `${id}.pdf`,
    mimeType: 'application/pdf',
    size: 1024,
    bytesBase64: bytes,
    uploadedAt: new Date('2026-01-01T00:00:00.000Z').toISOString(),
  };
}

describe('v2 single resume -> v3 library', () => {
  const legacy = {
    schemaVersion: 2,
    data: {
      filename: 'Nevin_Chen-backend.pdf',
      mimeType: 'application/pdf',
      size: 2048,
      bytesBase64: 'QUJD',
      uploadedAt: new Date('2026-01-01T00:00:00.000Z').toISOString(),
      extractedText: 'Backend engineer',
    },
  };

  it('carries the stored resume over as the default variant', async () => {
    store.resume = legacy;
    const lib = await getResumeLibrary();
    expect(lib.variants).toHaveLength(1);
    expect(lib.variants[0]?.filename).toBe('Nevin_Chen-backend.pdf');
    expect(lib.variants[0]?.label).toBe('Nevin Chen backend');
    expect(lib.variants[0]?.extractedText).toBe('Backend engineer');
    expect(lib.activeId).toBe(lib.variants[0]?.id);
  });

  it('mints the same id on every read, so company choices survive', async () => {
    store.resume = legacy;
    const first = await getResumeLibrary();
    const second = await getResumeLibrary();
    expect(first.variants[0]?.id).toBe(LEGACY_RESUME_VARIANT_ID);
    expect(second.variants[0]?.id).toBe(first.variants[0]?.id);
  });

  it('leaves an already-migrated library untouched', async () => {
    store.resume = {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      data: { variants: [variant('a', 'Backend')], activeId: 'a' },
    };
    const lib = await getResumeLibrary();
    expect(lib.variants[0]?.id).toBe('a');
  });

  it('returns an empty library when nothing is stored', async () => {
    expect(await getResumeLibrary()).toEqual({ variants: [], activeId: null });
    expect(defaultVariant(await getResumeLibrary())).toBeNull();
  });
});

describe('library mutations', () => {
  it('makes the first upload the default and leaves it alone after', async () => {
    await addResumeVariant(variant('a', 'Backend'));
    await addResumeVariant(variant('b', 'ML'));
    const lib = await getResumeLibrary();
    expect(lib.activeId).toBe('a');
    expect(lib.variants.map((v) => v.id)).toEqual(['a', 'b']);
    expect(defaultVariant(await getResumeLibrary())?.label).toBe('Backend');
  });

  it('refuses to store more than the cap', async () => {
    for (let i = 0; i < MAX_RESUME_VARIANTS; i++) {
      await addResumeVariant(variant(`v${i}`, `Resume ${i}`));
    }
    await expect(addResumeVariant(variant('extra', 'Extra'))).rejects.toThrow(
      /Remove one/,
    );
    expect((await getResumeLibrary()).variants).toHaveLength(MAX_RESUME_VARIANTS);
  });

  it('refuses an upload that would blow the storage budget', async () => {
    const huge = 'A'.repeat(5 * 1024 * 1024);
    await addResumeVariant(variant('a', 'Backend', huge));
    await expect(addResumeVariant(variant('b', 'ML', huge))).rejects.toThrow(
      /storage/i,
    );
  });

  it('renames a variant without touching the others', async () => {
    await addResumeVariant(variant('a', 'Backend'));
    await addResumeVariant(variant('b', 'ML'));
    const lib = await updateResumeVariant('b', { label: 'Machine learning' });
    expect(lib.variants.map((v) => v.label)).toEqual(['Backend', 'Machine learning']);
  });

  it('switches the default', async () => {
    await addResumeVariant(variant('a', 'Backend'));
    await addResumeVariant(variant('b', 'ML'));
    expect((await setDefaultResume('b')).activeId).toBe('b');
    expect((await setDefaultResume('nope')).activeId).toBe('b');
  });

  it('reassigns the default when the default is removed', async () => {
    await addResumeVariant(variant('a', 'Backend'));
    await addResumeVariant(variant('b', 'ML'));
    const lib = await removeResumeVariant('a');
    expect(lib.variants.map((v) => v.id)).toEqual(['b']);
    expect(lib.activeId).toBe('b');
  });

  it('drops company choices that pointed at the removed variant', async () => {
    await addResumeVariant(variant('a', 'Backend'));
    await addResumeVariant(variant('b', 'ML'));
    await setSettings({
      ...defaultSettings(),
      resume: {
        companyChoices: { 'jobs.lever.co/ramp': 'b', 'careers.stripe.com': 'a' },
      },
    });

    await removeResumeVariant('b');

    expect((await getSettings()).resume.companyChoices).toEqual({
      'careers.stripe.com': 'a',
    });
  });

  it('round-trips a library through storage', async () => {
    await setResumeLibrary({ variants: [variant('a', 'Backend')], activeId: 'a' });
    expect((await getResumeLibrary()).variants[0]?.label).toBe('Backend');
  });
});
