import type { Education, Experience, Profile } from '@/profile/schema';
import type { FieldGroup, FieldKind } from '@/adapters/types';
import { countryByIso, countryByName, splitPhone } from '@/lib/countries';
import { workAuthAnswerFromLabel } from '@/lib/work-auth';

export function valueForField(
  profile: Profile,
  kind: FieldKind,
  label?: string,
  group?: FieldGroup,
): string | boolean | null {
  switch (kind) {
    case 'firstName':
      return profile.firstName || null;
    case 'lastName':
      return profile.lastName || null;
    case 'fullName':
      return joinFullName(profile);
    case 'preferredName':
      return profile.preferredName || null;
    case 'email':
      return profile.email || null;
    case 'phone':
      return profile.phone || null;
    case 'phoneCountry':
      return phoneCountryName(profile);
    case 'phoneNational':
      return splitPhone(profile.phone, profile.phoneCountry).national || null;

    case 'addressLine1':
      return profile.address.line1 || null;
    case 'addressLine2':
      return profile.address.line2 || null;
    case 'city':
      return profile.address.city || null;
    case 'region':
      return profile.address.region || null;
    case 'cityAndRegion':
      return joinCityAndRegion(profile);
    case 'postalCode':
      return profile.address.postalCode || null;
    case 'country':
      return addressCountryName(profile);

    case 'linkedin':
      return profile.links.linkedin || null;
    case 'github':
      return profile.links.github || null;
    case 'portfolio':
      return profile.links.portfolio || null;
    case 'twitter':
      return profile.links.twitter || null;
    case 'otherLink':
      return profile.links.other || null;

    case 'authorizedToWorkInUS':
      return workAuthAnswer(profile, label) ?? yesNo(profile.workAuth.authorizedToWorkInUS);
    case 'requiresSponsorship':
      return workAuthAnswer(profile, label) ?? yesNo(profile.workAuth.requiresSponsorship);
    case 'willingToRelocate':
      return yesNo(profile.workAuth.willingToRelocate);
    case 'desiredSalary':
      return profile.workAuth.desiredSalary || null;

    case 'gender':
      return profile.demographics.gender;
    case 'pronouns':
      return profile.demographics.pronouns;
    case 'ethnicity':
      return profile.demographics.ethnicity;
    case 'race':
      return profile.demographics.race;
    case 'sexualOrientation':
      return profile.demographics.sexualOrientation;
    case 'transgender':
      return profile.demographics.transgender;
    case 'veteranStatus':
      return profile.demographics.veteranStatus;
    case 'disabilityStatus':
      return profile.demographics.disabilityStatus;

    case 'school':
      return educationAt(profile, group)?.school || null;
    case 'degree':
      return educationAt(profile, group)?.degree || null;
    case 'fieldOfStudy':
      return educationAt(profile, group)?.fieldOfStudy || null;
    case 'gradYear':
      return educationAt(profile, group)?.gradYear || null;
    case 'gpa':
      return educationAt(profile, group)?.gpa || null;

    case 'employer':
      return experienceAt(profile, group)?.employer || null;
    case 'jobTitle':
      return experienceAt(profile, group)?.jobTitle || null;
    case 'employerLocation':
      return group ? experienceAt(profile, group)?.location || null : null;
    case 'roleDescription':
      return group ? experienceAt(profile, group)?.description || null : null;
    case 'currentlyEmployed': {
      if (!group) return null;
      const entry = experienceAt(profile, group);
      return entry ? entry.current : null;
    }

    case 'startDate':
      return historyDate(profile, group, 'startDate');
    case 'endDate':
      return historyDate(profile, group, 'endDate');

    case 'coverLetter':
      return profile.defaultCoverLetter || null;

    case 'openEnded':
      return null;

    default: {
      const _: never = kind;
      void _;
      return null;
    }
  }
}

function experienceAt(profile: Profile, group?: FieldGroup): Experience | null {
  if (group && group.kind !== 'experience') return null;
  return profile.experience[group?.index ?? 0] ?? null;
}

function educationAt(profile: Profile, group?: FieldGroup): Education | null {
  if (group && group.kind !== 'education') return null;
  return profile.education[group?.index ?? 0] ?? null;
}

function historyDate(
  profile: Profile,
  group: FieldGroup | undefined,
  field: 'startDate' | 'endDate',
): string | null {
  if (!group) return null;
  if (group.kind === 'experience') {
    const entry = experienceAt(profile, group);
    if (!entry) return null;
    if (field === 'endDate' && entry.current) return null;
    return entry[field] || null;
  }
  return educationAt(profile, group)?.[field] || null;
}

function addressCountryName(profile: Profile): string | null {
  const raw = profile.address.country;
  return countryByName(raw)?.name ?? (raw || null);
}

function phoneCountryName(profile: Profile): string | null {
  const { iso } = splitPhone(profile.phone, profile.phoneCountry);
  const named = countryByIso(iso)?.name;
  if (named) return named;
  const fromAddress = countryByName(profile.address.country)?.name;
  if (fromAddress) return fromAddress;
  return profile.address.country || null;
}

function workAuthAnswer(profile: Profile, label: string | undefined): string | null {
  if (!label) return null;
  return workAuthAnswerFromLabel(label, profile.workAuth);
}

function yesNo(v: boolean | null): string | null {
  if (v === null) return null;
  return v ? 'Yes' : 'No';
}

function joinFullName(profile: Profile): string | null {
  const first = profile.firstName.trim();
  const last = profile.lastName.trim();
  const joined = [first, last].filter(Boolean).join(' ');
  return joined || null;
}

function joinCityAndRegion(profile: Profile): string | null {
  const city = profile.address.city.trim();
  const region = profile.address.region.trim();
  const joined = [city, region].filter(Boolean).join(', ');
  return joined || null;
}
