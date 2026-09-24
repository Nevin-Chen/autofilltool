import {
  historyKindFor,
  isSharedHistoryKind,
  type DetectedField,
  type FieldGroup,
  type HistoryGroupKind,
} from './types';

export function assignHistoryGroups(fields: DetectedField[]): DetectedField[] {
  const named = namedGroups(fields);
  if (named) return named;

  const experience = entryContainers(fields, 'experience');
  const education = entryContainers(fields, 'education');
  if (experience.length === 0 && education.length === 0) return fields;

  return fields.map((field) => {
    const group = groupFor(field, experience, education);
    if (!group) return field;
    return { ...field, group };
  });
}

function namedGroups(fields: DetectedField[]): DetectedField[] | null {
  const ranks = new Map<HTMLElement, FieldGroup>();
  for (const section of ['experience', 'education'] as const) {
    const seeds = fields.filter((f) => historyKindFor(f.kind) === section);
    if (new Set(seeds.map((f) => f.kind)).size < 2) continue;
    const ranked = rankedByName(seeds);
    if (!ranked) return null;
    for (const [el, index] of ranked) ranks.set(el, { kind: section, index });

    for (const field of fields) {
      if (!isSharedHistoryKind(field.kind)) continue;
      if (ranks.has(field.el)) continue;
      if (sectionFromName(field.el) !== section) continue;
      const index = indexFromName(field.el);
      if (index === null) continue;
      const sibling = Array.from(ranked).find(
        ([el]) => indexFromName(el) === index,
      );
      if (sibling) ranks.set(field.el, { kind: section, index: sibling[1] });
    }
  }
  if (ranks.size === 0) return null;
  return fields.map((field) => {
    const group = ranks.get(field.el);
    return group ? { ...field, group } : field;
  });
}

function groupFor(
  field: DetectedField,
  experience: HTMLElement[],
  education: HTMLElement[],
): FieldGroup | null {
  const own = historyKindFor(field.kind);
  if (own) {
    const containers = own === 'experience' ? experience : education;
    const index = indexIn(containers, field.el);
    return index === null ? null : { kind: own, index };
  }
  if (!isSharedHistoryKind(field.kind)) return null;
  const inExperience = indexIn(experience, field.el);
  if (inExperience !== null) return { kind: 'experience', index: inExperience };
  const inEducation = indexIn(education, field.el);
  if (inEducation !== null) return { kind: 'education', index: inEducation };
  return null;
}

function indexIn(containers: HTMLElement[], el: HTMLElement): number | null {
  for (let i = 0; i < containers.length; i++) {
    const container = containers[i]!;
    if (container === el || container.contains(el)) return i;
  }
  return null;
}

const NAMED_INDEX_RE =
  /(?:experience|employment|work[_\-.]?history|education|school|job)[^0-9]{0,12}?(\d{1,2})/i;

export function indexFromName(el: HTMLElement): number | null {
  for (const attr of ['name', 'id']) {
    const raw = el.getAttribute(attr);
    if (!raw) continue;
    const m = NAMED_INDEX_RE.exec(raw);
    if (m) return Number(m[1]);
  }
  return null;
}

export function sectionFromName(el: HTMLElement): HistoryGroupKind | null {
  for (const attr of ['name', 'id']) {
    const raw = el.getAttribute(attr);
    if (!raw) continue;
    const m = NAMED_INDEX_RE.exec(raw);
    if (!m) continue;
    return /educat|school/i.test(m[0]) ? 'education' : 'experience';
  }
  return null;
}

function rankedByName(seeds: DetectedField[]): Map<HTMLElement, number> | null {
  const found = new Map<HTMLElement, number>();
  for (const seed of seeds) {
    const index = indexFromName(seed.el);
    if (index === null) return null;
    found.set(seed.el, index);
  }
  const ranks = Array.from(new Set(found.values())).sort((a, b) => a - b);
  const out = new Map<HTMLElement, number>();
  for (const [el, index] of found) out.set(el, ranks.indexOf(index));
  return out;
}

function entryContainers(
  fields: DetectedField[],
  section: HistoryGroupKind,
): HTMLElement[] {
  const seeds = fields.filter((f) => historyKindFor(f.kind) === section);
  if (new Set(seeds.map((f) => f.kind)).size < 2) return [];

  let node: HTMLElement | null = seeds[0]!.el;
  while (node) {
    const parent: HTMLElement | null = node.parentElement;
    if (!parent) break;
    const bearing = bearingChildren(parent, seeds);
    if (bearing.length >= 2 && repeatsAKind(bearing, seeds)) return bearing;
    node = parent;
  }
  return [singleContainer(seeds)];
}

function bearingChildren(
  parent: HTMLElement,
  seeds: DetectedField[],
): HTMLElement[] {
  const out: HTMLElement[] = [];
  for (const child of Array.from(parent.children)) {
    if (!(child instanceof HTMLElement)) continue;
    if (seeds.some((s) => child === s.el || child.contains(s.el))) out.push(child);
  }
  return out;
}

function repeatsAKind(
  containers: HTMLElement[],
  seeds: DetectedField[],
): boolean {
  const seen = new Set<string>();
  for (const container of containers) {
    const kinds = new Set(
      seeds
        .filter((s) => container === s.el || container.contains(s.el))
        .map((s) => s.kind),
    );
    for (const kind of kinds) {
      if (seen.has(kind)) return true;
      seen.add(kind);
    }
  }
  return false;
}

function singleContainer(seeds: DetectedField[]): HTMLElement {
  let node: HTMLElement = seeds[0]!.el;
  while (!seeds.every((s) => node.contains(s.el) || node === s.el)) {
    const parent = node.parentElement;
    if (!parent) break;
    node = parent;
  }
  return node;
}
