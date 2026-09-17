import type { WorkAuth } from '@/profile/schema';

const SPONSORSHIP_RE = /\b(sponsor\w*|visas?|h-?1b)\b/;
const AUTHORIZATION_RE =
  /\b(authoriz\w*|legally\s+(allowed|able|permitted|entitled)|eligible\s+to\s+work|right\s+to\s+work|work\s+permit)\b/;
const NEEDS_SPONSORSHIP_RE =
  /\b(requir\w*|need\w*|request\w*|seek\w*)\s+(\w+\s+){0,3}(sponsor\w*|visas?|h-?1b)\b/;
const WITHOUT_SPONSORSHIP_RE =
  /\b(without|not|never|no)\s+(\w+\s+){0,4}(requir\w*|need\w*)\s+(\w+\s+){0,3}(sponsor\w*|visas?|h-?1b)\b|\bwithout\s+(\w+\s+){0,3}(sponsor\w*|visas?|h-?1b)\b/;

export type WorkAuthAnswer = 'Yes' | 'No';

export function isWorkEligibilityQuestion(label: string): boolean {
  const text = normalize(label);
  return SPONSORSHIP_RE.test(text) || AUTHORIZATION_RE.test(text);
}

export function workAuthAnswerFromLabel(
  label: string,
  workAuth: WorkAuth,
): WorkAuthAnswer | null {
  const text = normalize(label);
  const mentionsSponsorship = SPONSORSHIP_RE.test(text);
  const mentionsAuthorization = AUTHORIZATION_RE.test(text);
  if (!mentionsSponsorship && !mentionsAuthorization) return null;

  const authorized = workAuth.authorizedToWorkInUS;
  const requires = workAuth.requiresSponsorship;
  const asksWithoutSponsorship = mentionsSponsorship && WITHOUT_SPONSORSHIP_RE.test(text);

  if (mentionsAuthorization && asksWithoutSponsorship) {
    if (requires !== null) {
      if (requires) return 'No';
      return authorized === false ? 'No' : 'Yes';
    }
    if (authorized !== null) return authorized ? 'Yes' : 'No';
    return null;
  }

  if (asksWithoutSponsorship) {
    if (requires === null) return null;
    return requires ? 'No' : 'Yes';
  }

  if (mentionsSponsorship && NEEDS_SPONSORSHIP_RE.test(text)) {
    if (requires === null) return null;
    return requires ? 'Yes' : 'No';
  }

  if (mentionsAuthorization) {
    if (authorized === null) return null;
    return authorized ? 'Yes' : 'No';
  }

  return null;
}

function normalize(label: string): string {
  return label
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/['’]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
