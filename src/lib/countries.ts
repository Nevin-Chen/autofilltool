/**
 * Country dial-code table for the phone field. `iso` is the ISO 3166-1
 * alpha-2 code we persist (Profile.phoneCountry) so the Options UI can
 * reconstruct the dropdown selection on reload; `dial` is the calling-code
 * prefix (without the leading `+`) prepended to the stored phone string.
 *
 * Not exhaustive — a practical set covering the regions our users apply
 * from. Sorted alphabetically by name; the picker pins a default (US) on top.
 */

export type Country = {
  iso: string;
  name: string;
  dial: string;
  flag: string;
};

export const COUNTRIES: ReadonlyArray<Country> = [
  { iso: 'US', name: 'United States', dial: '1', flag: '🇺🇸' },
  { iso: 'CA', name: 'Canada', dial: '1', flag: '🇨🇦' },
  { iso: 'GB', name: 'United Kingdom', dial: '44', flag: '🇬🇧' },
  { iso: 'AU', name: 'Australia', dial: '61', flag: '🇦🇺' },
  { iso: 'AT', name: 'Austria', dial: '43', flag: '🇦🇹' },
  { iso: 'BE', name: 'Belgium', dial: '32', flag: '🇧🇪' },
  { iso: 'BR', name: 'Brazil', dial: '55', flag: '🇧🇷' },
  { iso: 'BG', name: 'Bulgaria', dial: '359', flag: '🇧🇬' },
  { iso: 'CL', name: 'Chile', dial: '56', flag: '🇨🇱' },
  { iso: 'CN', name: 'China', dial: '86', flag: '🇨🇳' },
  { iso: 'CO', name: 'Colombia', dial: '57', flag: '🇨🇴' },
  { iso: 'HR', name: 'Croatia', dial: '385', flag: '🇭🇷' },
  { iso: 'CZ', name: 'Czechia', dial: '420', flag: '🇨🇿' },
  { iso: 'DK', name: 'Denmark', dial: '45', flag: '🇩🇰' },
  { iso: 'EG', name: 'Egypt', dial: '20', flag: '🇪🇬' },
  { iso: 'EE', name: 'Estonia', dial: '372', flag: '🇪🇪' },
  { iso: 'FI', name: 'Finland', dial: '358', flag: '🇫🇮' },
  { iso: 'FR', name: 'France', dial: '33', flag: '🇫🇷' },
  { iso: 'DE', name: 'Germany', dial: '49', flag: '🇩🇪' },
  { iso: 'GR', name: 'Greece', dial: '30', flag: '🇬🇷' },
  { iso: 'HK', name: 'Hong Kong', dial: '852', flag: '🇭🇰' },
  { iso: 'HU', name: 'Hungary', dial: '36', flag: '🇭🇺' },
  { iso: 'IN', name: 'India', dial: '91', flag: '🇮🇳' },
  { iso: 'ID', name: 'Indonesia', dial: '62', flag: '🇮🇩' },
  { iso: 'IE', name: 'Ireland', dial: '353', flag: '🇮🇪' },
  { iso: 'IL', name: 'Israel', dial: '972', flag: '🇮🇱' },
  { iso: 'IT', name: 'Italy', dial: '39', flag: '🇮🇹' },
  { iso: 'JP', name: 'Japan', dial: '81', flag: '🇯🇵' },
  { iso: 'KR', name: 'South Korea', dial: '82', flag: '🇰🇷' },
  { iso: 'MY', name: 'Malaysia', dial: '60', flag: '🇲🇾' },
  { iso: 'MX', name: 'Mexico', dial: '52', flag: '🇲🇽' },
  { iso: 'NL', name: 'Netherlands', dial: '31', flag: '🇳🇱' },
  { iso: 'NZ', name: 'New Zealand', dial: '64', flag: '🇳🇿' },
  { iso: 'NG', name: 'Nigeria', dial: '234', flag: '🇳🇬' },
  { iso: 'NO', name: 'Norway', dial: '47', flag: '🇳🇴' },
  { iso: 'PK', name: 'Pakistan', dial: '92', flag: '🇵🇰' },
  { iso: 'PE', name: 'Peru', dial: '51', flag: '🇵🇪' },
  { iso: 'PH', name: 'Philippines', dial: '63', flag: '🇵🇭' },
  { iso: 'PL', name: 'Poland', dial: '48', flag: '🇵🇱' },
  { iso: 'PT', name: 'Portugal', dial: '351', flag: '🇵🇹' },
  { iso: 'RO', name: 'Romania', dial: '40', flag: '🇷🇴' },
  { iso: 'SA', name: 'Saudi Arabia', dial: '966', flag: '🇸🇦' },
  { iso: 'SG', name: 'Singapore', dial: '65', flag: '🇸🇬' },
  { iso: 'ZA', name: 'South Africa', dial: '27', flag: '🇿🇦' },
  { iso: 'ES', name: 'Spain', dial: '34', flag: '🇪🇸' },
  { iso: 'SE', name: 'Sweden', dial: '46', flag: '🇸🇪' },
  { iso: 'CH', name: 'Switzerland', dial: '41', flag: '🇨🇭' },
  { iso: 'TW', name: 'Taiwan', dial: '886', flag: '🇹🇼' },
  { iso: 'TH', name: 'Thailand', dial: '66', flag: '🇹🇭' },
  { iso: 'TR', name: 'Turkey', dial: '90', flag: '🇹🇷' },
  { iso: 'AE', name: 'United Arab Emirates', dial: '971', flag: '🇦🇪' },
  { iso: 'UA', name: 'Ukraine', dial: '380', flag: '🇺🇦' },
  { iso: 'VN', name: 'Vietnam', dial: '84', flag: '🇻🇳' },
];

const BY_ISO = new Map(COUNTRIES.map((c) => [c.iso, c] as const));

export function countryByIso(iso: string): Country | undefined {
  return BY_ISO.get(iso);
}

/**
 * Split a stored phone string into its dial-code country (by `iso`) and the
 * remaining national number. Used to seed the picker from saved data when the
 * persisted phoneCountry is missing/blank. Prefers the longest matching dial
 * code so e.g. +1 isn't chosen over a 3-digit code that also starts with 1.
 */
export function splitPhone(
  phone: string,
  preferredIso?: string,
): { iso: string; national: string } {
  const trimmed = phone.trim();
  if (preferredIso) {
    const c = BY_ISO.get(preferredIso);
    if (c) {
      const national = stripDial(trimmed, c.dial);
      if (national !== null) return { iso: c.iso, national };
      // phoneCountry set but the number doesn't carry that prefix: keep the
      // country selection and treat the whole string as the national part.
      return { iso: c.iso, national: trimmed.replace(/^\+/, '').trim() };
    }
  }
  if (trimmed.startsWith('+')) {
    const matches = COUNTRIES.filter(
      (c) => stripDial(trimmed, c.dial) !== null,
    ).sort((a, b) => b.dial.length - a.dial.length);
    const best = matches[0];
    if (best) {
      return { iso: best.iso, national: stripDial(trimmed, best.dial) ?? '' };
    }
  }
  return { iso: '', national: trimmed };
}

/** Join a dial code and national number into the stored phone string. */
export function joinPhone(iso: string, national: string): string {
  const num = national.trim();
  const c = BY_ISO.get(iso);
  if (!c) return num;
  if (!num) return '';
  return `+${c.dial} ${num}`;
}

/** Returns the national remainder if `phone` starts with `+<dial>`, else null. */
function stripDial(phone: string, dial: string): string | null {
  const prefix = `+${dial}`;
  if (!phone.startsWith(prefix)) return null;
  return phone.slice(prefix.length).replace(/^[\s-]+/, '').trim();
}
