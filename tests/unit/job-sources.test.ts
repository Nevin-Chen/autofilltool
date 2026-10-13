import { describe, expect, it } from 'vitest';
import { sourceForUrl } from '@/jobs/sources';

describe('sourceForUrl', () => {
  it('returns null for boards without a source yet', () => {
    expect(sourceForUrl('https://www.linkedin.com/jobs/search/?keywords=software')).toBeNull();
    expect(sourceForUrl('https://jobs.example.com/search?q=software')).toBeNull();
  });

  it('returns null for text that is not a URL', () => {
    expect(sourceForUrl('not a url')).toBeNull();
  });
});
