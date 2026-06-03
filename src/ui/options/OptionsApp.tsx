import { useEffect, useMemo, useState } from 'react';
import {
  emptyProfile,
  defaultSettings,
  ProfileSchema,
  SettingsSchema,
  type Profile,
  type Settings,
} from '@/profile/schema';
import { getProfile, setProfile, getSettings, setSettings } from '@/profile/store';
import { COUNTRIES, splitPhone, joinPhone } from '@/lib/countries';
import { TrackingSection } from './TrackingSection';
import { ResumeSection } from './ResumeSection';
import { AISection } from './AISection';

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

export function OptionsApp() {
  const [profile, setProfileState] = useState<Profile>(emptyProfile);
  const [settings, setSettingsState] = useState<Settings>(defaultSettings);
  const [loaded, setLoaded] = useState(false);
  const [save, setSave] = useState<SaveState>('idle');
  const [error, setError] = useState<string | null>(null);
  // The provider actually persisted to storage — distinct from the live
  // `settings.ai.provider`, which reflects an unsaved radio selection. Drives
  // the "(current)" marker so the user can tell what's saved vs picked.
  const [savedProvider, setSavedProvider] = useState<Settings['ai']['provider']>('none');

  // Initial load from chrome.storage.local.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [p, s] = await Promise.all([getProfile(), getSettings()]);
      if (cancelled) return;
      setProfileState(p);
      setSettingsState(s);
      setSavedProvider(s.ai.provider);
      setLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const onSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSave('saving');
    setError(null);
    // Re-validate at the boundary; this catches anything the UI failed to type-check.
    const pParsed = ProfileSchema.safeParse(profile);
    const sParsed = SettingsSchema.safeParse(settings);
    if (!pParsed.success || !sParsed.success) {
      setSave('error');
      setError(
        [
          ...(pParsed.success ? [] : pParsed.error.issues.map((i) => `profile.${i.path.join('.')}: ${i.message}`)),
          ...(sParsed.success ? [] : sParsed.error.issues.map((i) => `settings.${i.path.join('.')}: ${i.message}`)),
        ].join('\n'),
      );
      return;
    }
    try {
      await Promise.all([setProfile(pParsed.data), setSettings(sParsed.data)]);
      setSavedProvider(sParsed.data.ai.provider);
      setSave('saved');
      setTimeout(() => setSave('idle'), 1500);
    } catch (err) {
      setSave('error');
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const updateProfile = useMemo(
    () =>
      <K extends keyof Profile>(key: K, value: Profile[K]) =>
        setProfileState((prev) => ({ ...prev, [key]: value })),
    [],
  );

  if (!loaded) {
    return (
      <main className="mx-auto max-w-3xl p-6 text-slate-600 dark:text-slate-300">
        Loading…
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-3xl p-6">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">AutoFillTool</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          All data is stored locally in your browser (chrome.storage.local) and
          never synced. The extension only calls services you configure yourself.
        </p>
      </header>

      <form onSubmit={onSave} className="space-y-8">
        {/* ------------------------------------------------ Identity */}
        <Section title="Identity" hint="Used to fill name and contact fields.">
          <Grid>
            <TextField
              label="First name"
              value={profile.firstName}
              onChange={(v) => updateProfile('firstName', v)}
            />
            <TextField
              label="Last name"
              value={profile.lastName}
              onChange={(v) => updateProfile('lastName', v)}
            />
            <TextField
              label="Preferred name"
              value={profile.preferredName}
              onChange={(v) => updateProfile('preferredName', v)}
            />
            <TextField
              label="Email"
              type="email"
              value={profile.email}
              onChange={(v) => updateProfile('email', v)}
            />
            <PhoneField
              country={profile.phoneCountry}
              phone={profile.phone}
              onChange={(country, phone) =>
                setProfileState((prev) => ({
                  ...prev,
                  phoneCountry: country,
                  phone,
                }))
              }
            />
          </Grid>
        </Section>

        {/* ------------------------------------------------ Address */}
        <Section title="Address">
          <Grid>
            <TextField
              label="Street"
              value={profile.address.line1}
              onChange={(v) =>
                updateProfile('address', { ...profile.address, line1: v })
              }
            />
            <TextField
              label="Apt / Suite"
              value={profile.address.line2}
              onChange={(v) =>
                updateProfile('address', { ...profile.address, line2: v })
              }
            />
            <TextField
              label="City"
              value={profile.address.city}
              onChange={(v) =>
                updateProfile('address', { ...profile.address, city: v })
              }
            />
            <TextField
              label="State / Region"
              value={profile.address.region}
              onChange={(v) =>
                updateProfile('address', { ...profile.address, region: v })
              }
            />
            <TextField
              label="Postal code"
              value={profile.address.postalCode}
              onChange={(v) =>
                updateProfile('address', { ...profile.address, postalCode: v })
              }
            />
            <CountryField
              label="Country"
              value={profile.address.country}
              onChange={(v) =>
                updateProfile('address', { ...profile.address, country: v })
              }
            />
          </Grid>
        </Section>

        {/* ------------------------------------------------ Links */}
        <Section title="Links">
          <Grid>
            <TextField
              label="LinkedIn"
              value={profile.links.linkedin}
              onChange={(v) =>
                updateProfile('links', { ...profile.links, linkedin: v })
              }
            />
            <TextField
              label="GitHub"
              value={profile.links.github}
              onChange={(v) =>
                updateProfile('links', { ...profile.links, github: v })
              }
            />
            <TextField
              label="Portfolio"
              value={profile.links.portfolio}
              onChange={(v) =>
                updateProfile('links', { ...profile.links, portfolio: v })
              }
            />
            <TextField
              label="Other"
              value={profile.links.other}
              onChange={(v) =>
                updateProfile('links', { ...profile.links, other: v })
              }
            />
          </Grid>
        </Section>

        {/* ------------------------------------------------ Work auth */}
        <Section
          title="Work authorization"
          hint="Leave any field blank to skip it on forms."
        >
          <Grid>
            <TristateField
              label="Authorized to work in US?"
              value={profile.workAuth.authorizedToWorkInUS}
              onChange={(v) =>
                updateProfile('workAuth', {
                  ...profile.workAuth,
                  authorizedToWorkInUS: v,
                })
              }
            />
            <TristateField
              label="Requires sponsorship?"
              value={profile.workAuth.requiresSponsorship}
              onChange={(v) =>
                updateProfile('workAuth', {
                  ...profile.workAuth,
                  requiresSponsorship: v,
                })
              }
            />
            <TristateField
              label="Willing to relocate?"
              value={profile.workAuth.willingToRelocate}
              onChange={(v) =>
                updateProfile('workAuth', {
                  ...profile.workAuth,
                  willingToRelocate: v,
                })
              }
            />
            <TextField
              label="Desired salary (free text)"
              value={profile.workAuth.desiredSalary}
              onChange={(v) =>
                updateProfile('workAuth', {
                  ...profile.workAuth,
                  desiredSalary: v,
                })
              }
            />
          </Grid>
        </Section>

        {/* ------------------------------------------------ Behavior */}
        <Section title="Behavior">
          <label className="flex items-start gap-3 text-sm">
            <input
              type="checkbox"
              className="mt-1"
              checked={settings.forceOverwrite}
              onChange={(e) =>
                setSettingsState((prev) => ({
                  ...prev,
                  forceOverwrite: e.target.checked,
                }))
              }
            />
            <span>
              <span className="font-medium">Force overwrite</span>
              <span className="block text-slate-500 dark:text-slate-400">
                By default, fields with existing values are skipped. Enabling
                this overwrites them.
              </span>
            </span>
          </label>
        </Section>

        {/* ------------------------------------------------ Resume */}
        <ResumeSection />

        {/* ------------------------------------------------ AI */}
        <AISection
          settings={settings.ai}
          savedProvider={savedProvider}
          onChange={(ai) => setSettingsState((prev) => ({ ...prev, ai }))}
        />

        {/* ------------------------------------------------ Tracking */}
        <TrackingSection
          url={settings.tracking.webhookUrl}
          onChange={(webhookUrl) =>
            setSettingsState((prev) => ({
              ...prev,
              tracking: { ...prev.tracking, webhookUrl },
            }))
          }
          autoLogOnSubmit={settings.tracking.autoLogOnSubmit}
          onAutoLogChange={(autoLogOnSubmit) =>
            setSettingsState((prev) => ({
              ...prev,
              tracking: { ...prev.tracking, autoLogOnSubmit },
            }))
          }
        />

        <div className="flex items-center gap-4">
          <button
            type="submit"
            className="rounded-md bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-500 disabled:opacity-60"
            disabled={save === 'saving'}
          >
            {save === 'saving' ? 'Saving…' : 'Save'}
          </button>
          {save === 'saved' && (
            <span className="text-sm text-emerald-600 dark:text-emerald-400">
              Saved.
            </span>
          )}
          {save === 'error' && (
            <span className="whitespace-pre text-sm text-rose-600 dark:text-rose-400">
              {error ?? 'Save failed.'}
            </span>
          )}
        </div>
      </form>

      <footer className="mt-10 border-t border-slate-200 pt-4 text-xs text-slate-500 dark:border-slate-700 dark:text-slate-400">
        v0.1.0 · Step 1 of roadmap (skeleton). Filler, adapters, AI, and
        webhook logging arrive in later steps.
      </footer>
    </main>
  );
}

/* -------------------------------------------------- tiny presentational bits */

function Section(props: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-base font-semibold">{props.title}</h2>
      {props.hint && (
        <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
          {props.hint}
        </p>
      )}
      <div className="mt-3">{props.children}</div>
    </section>
  );
}

function Grid(props: { children: React.ReactNode }) {
  return <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">{props.children}</div>;
}

function TextField(props: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
}) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block text-slate-700 dark:text-slate-200">
        {props.label}
      </span>
      <input
        type={props.type ?? 'text'}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        className="w-full rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm shadow-sm focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
      />
    </label>
  );
}

function CountryField(props: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  // Store country name (forms expect "United States"); preserve free-text fallback.
  const known = COUNTRIES.some((c) => c.name === props.value);
  return (
    <label className="block text-sm">
      <span className="mb-1 block text-slate-700 dark:text-slate-200">
        {props.label}
      </span>
      <select
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        className="w-full rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm shadow-sm focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
      >
        <option value="">— select —</option>
        {!known && props.value !== '' && (
          <option value={props.value}>{props.value}</option>
        )}
        {COUNTRIES.map((c) => (
          <option key={c.iso} value={c.name}>
            {c.flag} {c.name}
          </option>
        ))}
      </select>
    </label>
  );
}

function PhoneField(props: {
  country: string;
  phone: string;
  onChange: (country: string, phone: string) => void;
}) {
  // Seed from saved ISO or inferred +<dial> prefix.
  const { iso, national } = splitPhone(props.phone, props.country);

  const setCountry = (nextIso: string) =>
    props.onChange(nextIso, joinPhone(nextIso, national));
  const setNational = (nextNational: string) =>
    props.onChange(iso, joinPhone(iso, nextNational));

  return (
    <label className="block text-sm">
      <span className="mb-1 block text-slate-700 dark:text-slate-200">Phone</span>
      <div className="flex gap-2">
        <select
          aria-label="Country dialing code"
          value={iso}
          onChange={(e) => setCountry(e.target.value)}
          className="w-32 shrink-0 rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm shadow-sm focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
        >
          <option value="">—</option>
          {COUNTRIES.map((c) => (
            <option key={c.iso} value={c.iso}>
              {c.flag} {c.iso} +{c.dial}
            </option>
          ))}
        </select>
        <input
          type="tel"
          value={national}
          onChange={(e) => setNational(e.target.value)}
          placeholder="555 123 4567"
          className="w-full rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm shadow-sm focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
        />
      </div>
    </label>
  );
}

function TristateField(props: {
  label: string;
  value: boolean | null;
  onChange: (v: boolean | null) => void;
}) {
  const v = props.value === null ? '' : props.value ? 'yes' : 'no';
  return (
    <label className="block text-sm">
      <span className="mb-1 block text-slate-700 dark:text-slate-200">
        {props.label}
      </span>
      <select
        value={v}
        onChange={(e) => {
          const next =
            e.target.value === '' ? null : e.target.value === 'yes' ? true : false;
          props.onChange(next);
        }}
        className="w-full rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm shadow-sm focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
      >
        <option value="">— blank —</option>
        <option value="yes">Yes</option>
        <option value="no">No</option>
      </select>
    </label>
  );
}
