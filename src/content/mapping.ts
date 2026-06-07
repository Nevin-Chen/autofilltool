import type { Profile } from '@/profile/schema';
import type { FieldKind } from '@/adapters/types';

export function valueForField(profile: Profile, kind: FieldKind): string | boolean | null {
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
      return profile.address.country || null;

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
      return yesNo(profile.workAuth.authorizedToWorkInUS);
    case 'requiresSponsorship':
      return yesNo(profile.workAuth.requiresSponsorship);
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
    case 'veteranStatus':
      return profile.demographics.veteranStatus;
    case 'disabilityStatus':
      return profile.demographics.disabilityStatus;

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
