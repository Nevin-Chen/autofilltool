export function resolveAiOption(rawValue: string, options: string[]): string | null {
  const v = rawValue.trim().toLowerCase();
  if (!v) return null;

  for (const opt of options) {
    if (opt.trim().toLowerCase() === v) return opt;
  }

  const wholeWordMatches = options.filter((opt) => {
    const o = opt.trim().toLowerCase();
    if (!o) return false;
    return new RegExp(`(?:^|\\W)${escapeRegExp(o)}(?:\\W|$)`, 'i').test(v);
  });
  if (wholeWordMatches.length === 1) return wholeWordMatches[0]!;

  if (v.length >= 3) {
    const prefixMatches = options.filter((opt) => {
      const o = opt.trim().toLowerCase();
      return o.startsWith(v) || o === v;
    });
    if (prefixMatches.length === 1) return prefixMatches[0]!;
  }

  return null;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function parseMultiSelect(rawValue: string, options: string[]): string[] {
  const parts = rawValue
    .split(/[\n;,]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  const candidates = parts.length > 0 ? parts : [rawValue];
  const picks: string[] = [];
  for (const c of candidates) {
    const resolved = resolveAiOption(c, options);
    if (resolved && !picks.includes(resolved)) picks.push(resolved);
  }
  if (picks.length === 0) {
    const resolved = resolveAiOption(rawValue, options);
    if (resolved) picks.push(resolved);
  }
  return picks;
}
