import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  linkedInDetails,
  linkedInListings,
  linkedInSearchPageUrl,
  linkedInSource,
  normalizePay,
  parseLinkedInCard,
  readLinkedInJobPage,
  readLinkedInSearchPage,
  readLinkedInSelectedJob,
} from '@/jobs/sources/linkedin';
import { sourceForUrl } from '@/jobs/sources';

const NOW = Date.parse('2026-10-14T15:00:00.000Z');

const SEARCH_URL =
  'https://www.linkedin.com/jobs/search-results/?currentJobId=4400000009&keywords=Software%20Engineer&geoId=103644278&f_TPR=r86400';

const PAYMENTS_CARD = {
  id: '4400000001',
  lines: [
    'Software Engineer, Payments (Verified job)',
    'Software Engineer, Payments',
    'Stripe',
    'New York, NY (Hybrid)',
    '$140K/yr - $185K/yr',
    '•',
    '1 benefit',
    '12 school alumni work here',
    'Posted 13 hours ago',
    '13 hours ago',
    '·',
    'Be an early applicant',
  ],
};

const ROBOTICS_CARD = {
  id: '4400000002',
  lines: [
    'Selected, Robotics Software Engineer (Verified job)',
    'Robotics Software Engineer',
    'Boston Dynamics',
    'Waltham, MA (On-site)',
    'Medical, 401(k)',
    'Viewed',
    '·',
    'Easy Apply',
  ],
};

describe('LinkedIn search URLs', () => {
  it('matches search pages on both layouts but not job pages', () => {
    expect(sourceForUrl(SEARCH_URL)?.id).toBe('linkedin');
    expect(sourceForUrl('https://www.linkedin.com/jobs/search/?keywords=Software')?.id).toBe('linkedin');
    expect(sourceForUrl('https://www.linkedin.com/jobs/view/4400000001/')).toBeNull();
    expect(sourceForUrl('https://www.linkedin.com/feed/')).toBeNull();
  });

  it('drops the open job and pages with start in steps of 25', () => {
    const first = new URL(linkedInSearchPageUrl(SEARCH_URL, 0));
    expect(first.searchParams.has('currentJobId')).toBe(false);
    expect(first.searchParams.has('start')).toBe(false);
    expect(first.searchParams.get('f_TPR')).toBe('r86400');
    expect(new URL(linkedInSearchPageUrl(SEARCH_URL, 2)).searchParams.get('start')).toBe('50');
  });

  it('replaces a start already in the saved URL', () => {
    expect(new URL(linkedInSearchPageUrl(`${SEARCH_URL}&start=25`, 0)).searchParams.has('start')).toBe(false);
  });

  it('judges every result, not just postings from today', () => {
    expect(linkedInSource.postedTodayOnly).toBe(false);
  });
});

describe('parseLinkedInCard', () => {
  it('reads title, company, location, workplace, pay and posting time from the card lines', () => {
    expect(parseLinkedInCard(PAYMENTS_CARD, NOW)).toEqual({
      id: 'linkedin:4400000001',
      source: 'linkedin',
      title: 'Software Engineer, Payments',
      company: 'Stripe',
      location: 'New York, NY',
      workplace: 'Hybrid',
      category: null,
      minYoe: null,
      pay: '$140k-$185k',
      postedAt: new Date(NOW - 13 * 3_600_000).toISOString(),
      requirements: '',
      tools: [],
      listingUrl: 'https://www.linkedin.com/jobs/view/4400000001/',
      applyUrl: null,
      easyApply: false,
    });
  });

  it('handles the selected card and Easy Apply', () => {
    expect(parseLinkedInCard(ROBOTICS_CARD, NOW)).toMatchObject({
      title: 'Robotics Software Engineer',
      company: 'Boston Dynamics',
      location: 'Waltham, MA',
      workplace: 'On-site',
      pay: null,
      easyApply: true,
      postedAt: new Date(NOW).toISOString(),
    });
  });

  it('reads cards without the verified label line, where the title comes first', () => {
    const card = {
      id: '4400000007',
      lines: ['Stripe Payments Engineer', 'Stripe', 'New York City Metropolitan Area (Hybrid)', '$90/hr', 'Posted 1 hour ago'],
    };
    expect(parseLinkedInCard(card, NOW)).toMatchObject({
      title: 'Stripe Payments Engineer',
      company: 'Stripe',
      location: 'New York City Metropolitan Area',
      workplace: 'Hybrid',
      pay: '$90/hr',
      postedAt: new Date(NOW - 3_600_000).toISOString(),
    });
  });

  it('reads minutes and remote roles', () => {
    const card = {
      id: '4400000003',
      lines: ['Platform Engineer', 'Platform Engineer', 'Globex', 'United States (Remote)', '$45/hr - $60/hr', '35 minutes ago'],
    };
    expect(parseLinkedInCard(card, NOW)).toMatchObject({
      location: 'United States',
      workplace: 'Remote',
      pay: '$45-$60/hr',
      postedAt: new Date(NOW - 35 * 60_000).toISOString(),
    });
  });

  it('skips cards LinkedIn has not drawn and ids that are not numbers', () => {
    expect(parseLinkedInCard({ id: '4400000004', lines: [] }, NOW)).toBeNull();
    expect(parseLinkedInCard({ ...PAYMENTS_CARD, id: 'abc' }, NOW)).toBeNull();
  });
});

describe('normalizePay', () => {
  it('matches the format other boards use', () => {
    expect(normalizePay('$135K/yr - $160K/yr')).toBe('$135k-$160k');
    expect(normalizePay('$150K/yr')).toBe('$150k');
    expect(normalizePay('$45/hr - $60/hr')).toBe('$45-$60/hr');
  });
});

describe('linkedInListings', () => {
  it('parses every drawn card and skips malformed ones', () => {
    const listings = linkedInListings(
      { blocked: false, hasNext: true, cards: [PAYMENTS_CARD, { id: 7 }, ROBOTICS_CARD, { id: '4400000005', lines: [] }] },
      NOW,
    );
    expect(listings?.map((l) => l.id)).toEqual(['linkedin:4400000001', 'linkedin:4400000002']);
  });

  it('returns null for a blocked page or anything unexpected', () => {
    expect(linkedInListings({ blocked: true }, NOW)).toBeNull();
    expect(linkedInListings(null, NOW)).toBeNull();
  });

  it('reports more pages only when LinkedIn shows an enabled Next button', () => {
    expect(linkedInSource.hasMorePages({ cards: [PAYMENTS_CARD], hasNext: true })).toBe(true);
    expect(linkedInSource.hasMorePages({ cards: [PAYMENTS_CARD], hasNext: false })).toBe(false);
    expect(linkedInSource.hasMorePages({ cards: [], hasNext: true })).toBe(false);
    expect(linkedInSource.isBlocked({ blocked: true })).toBe(true);
    expect(linkedInSource.unreadCards?.({ cards: [PAYMENTS_CARD, { id: '4400000005', lines: [] }] })).toBe(1);
  });
});

describe('linkedInDetails', () => {
  it('keeps the description, an http apply URL, and the Easy Apply flag', () => {
    expect(
      linkedInDetails({ blocked: false, description: ' Full posting. ', applyUrl: 'https://job-boards.greenhouse.io/stripe/jobs/7000001', easyApply: false }),
    ).toEqual({ description: 'Full posting.', applyUrl: 'https://job-boards.greenhouse.io/stripe/jobs/7000001', easyApply: false, postedAt: null });
    expect(linkedInDetails({ blocked: false, description: '', applyUrl: 'javascript:alert(1)', easyApply: true })).toEqual({
      description: null,
      applyUrl: null,
      easyApply: true,
      postedAt: null,
    });
    expect(linkedInDetails({ blocked: true })).toBeNull();
  });

  it('turns the posting time from the detail pane into a timestamp', () => {
    expect(linkedInDetails({ blocked: false, description: 'x', postedAgo: '10 minutes ago' }, NOW)?.postedAt).toBe(
      new Date(NOW - 10 * 60_000).toISOString(),
    );
  });
});

describe('readLinkedInSearchPage', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    Element.prototype.scrollIntoView = vi.fn();
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  function card(id: string, lines: string[]) {
    return `<div><div componentkey="job-card-component-ref-${id}"><div componentkey="job-card-component-ref-${id}">${lines
      .map((line) => `<p>${line}</p>`)
      .join('')}</div></div></div><hr>`;
  }

  async function read() {
    const pending = readLinkedInSearchPage();
    await vi.advanceTimersByTimeAsync(20_000);
    return (await pending) as { blocked: boolean; hasNext: boolean; cards: Array<{ id: string; lines: string[] }> };
  }

  it('reads each card once with its lines, and sees the Next button', async () => {
    document.body.innerHTML = `<div data-testid="lazy-column" data-component-type="LazyColumn">${card(PAYMENTS_CARD.id, PAYMENTS_CARD.lines.slice(0, 5))}${card(ROBOTICS_CARD.id, ROBOTICS_CARD.lines)}</div><button aria-label="Next">Next</button>`;
    const result = await read();
    expect(result.blocked).toBe(false);
    expect(result.hasNext).toBe(true);
    expect(result.cards.map((c) => c.id)).toEqual([PAYMENTS_CARD.id, ROBOTICS_CARD.id]);
    expect(result.cards[0]?.lines).toEqual(PAYMENTS_CARD.lines.slice(0, 5));
  });

  it('scrolls an undrawn card into view and reports it with no lines', async () => {
    document.body.innerHTML = `<div data-testid="lazy-column">${card(PAYMENTS_CARD.id, PAYMENTS_CARD.lines)}<div><div componentkey="job-card-component-ref-4400000006"></div></div></div>`;
    const result = await read();
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledTimes(1);
    expect(result.cards.find((c) => c.id === '4400000006')?.lines).toEqual([]);
  });

  it('reports no next page on the last page', async () => {
    document.body.innerHTML = `<div data-testid="lazy-column">${card(PAYMENTS_CARD.id, PAYMENTS_CARD.lines)}</div><button aria-label="Next" disabled>Next</button>`;
    expect((await read()).hasNext).toBe(false);
  });
});

describe('readLinkedInJobPage', () => {
  const POSTING = 'You will build payment APIs in TypeScript and React for millions of businesses. '.repeat(8).trim();

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  async function read() {
    const pending = readLinkedInJobPage();
    await vi.advanceTimersByTimeAsync(20_000);
    return (await pending) as { blocked: boolean; description: string; applyUrl: string | null; easyApply: boolean };
  }

  it('reads the full description without the "more" button, and the employer apply URL', async () => {
    document.body.innerHTML = `
      <div componentkey="JobDetailsAboutTheJob">
        <h2>About the job</h2>
        <div data-testid="expandable-text-box">${POSTING}<button>… more</button></div>
      </div>
      <a href="https://www.linkedin.com/safety/go/?url=https%3A%2F%2Fjob-boards.greenhouse.io%2Fstripe%2Fjobs%2F7000001&amp;urlhash=abc" aria-label="Apply on company website">Apply</a>`;
    expect(await read()).toEqual({
      blocked: false,
      description: POSTING,
      applyUrl: 'https://job-boards.greenhouse.io/stripe/jobs/7000001',
      easyApply: false,
      postedAgo: null,
    });
  });

  it('flags Easy Apply jobs, which have no employer link', async () => {
    document.body.innerHTML = `
      <div data-testid="expandable-text-box">${POSTING}</div>
      <button aria-label="Easy Apply to Software Engineer at Stripe">Easy Apply</button>`;
    expect(await read()).toMatchObject({ applyUrl: null, easyApply: true });
  });

  it('falls back to the text under the "About the job" heading', async () => {
    document.body.innerHTML = `<section><h2>About the job</h2><div>${POSTING}</div></section>`;
    expect((await read()).description).toBe(POSTING);
  });
});

describe('readLinkedInSelectedJob', () => {
  const POSTING = 'You will build payment APIs in TypeScript and React for millions of businesses. '.repeat(8).trim();

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  function pane(jobId: string, extra = '') {
    return `<div componentkey="JobDetails_AboutTheJob_${jobId}"><h2>About the job</h2><div data-testid="expandable-text-box">${POSTING}<button>… more</button></div></div>${extra}`;
  }

  function searchPage(cards: string[], openPane = '') {
    document.body.innerHTML = `<div data-testid="lazy-column">${cards
      .map(
        (id) =>
          `<div role="button" tabindex="0" componentkey="job-card-component-ref-${id}"><p>Software Engineer</p><button aria-label="Dismiss Software Engineer job">x</button></div>`,
      )
      .join('')}</div><section id="pane">${openPane}</section>`;
  }

  async function select(listingId: string) {
    const pending = readLinkedInSelectedJob(listingId);
    await vi.advanceTimersByTimeAsync(20_000);
    return pending;
  }

  it('clicks the card, waits for that job in the detail pane, and reads it', async () => {
    searchPage(['4400000001', '4400000002']);
    const dismiss = vi.fn();
    document.querySelector('[aria-label^="Dismiss"]')?.addEventListener('click', dismiss);
    document.querySelector('[componentkey="job-card-component-ref-4400000002"]')?.addEventListener('click', () => {
      setTimeout(() => {
        document.getElementById('pane')!.innerHTML = pane(
          '4400000002',
          '<a href="https://www.linkedin.com/safety/go/?url=https%3A%2F%2Fjob-boards.greenhouse.io%2Fstripe%2Fjobs%2F7000001&amp;urlhash=abc">Apply on company website</a>',
        );
      }, 1_200);
    });
    expect(await select('linkedin:4400000002')).toEqual({
      blocked: false,
      description: POSTING,
      applyUrl: 'https://job-boards.greenhouse.io/stripe/jobs/7000001',
      easyApply: false,
      postedAgo: null,
    });
    expect(dismiss).not.toHaveBeenCalled();
  });

  it('does not click when the pane already shows that job', async () => {
    searchPage(['4400000001'], pane('4400000001', '<button aria-label="Easy Apply to this job">Easy Apply</button>'));
    const clicked = vi.fn();
    document.querySelector('[componentkey="job-card-component-ref-4400000001"]')?.addEventListener('click', clicked);
    expect(await select('linkedin:4400000001')).toMatchObject({ easyApply: true, applyUrl: null });
    expect(clicked).not.toHaveBeenCalled();
  });

  it('ignores the pane of a different job', async () => {
    searchPage(['4400000001', '4400000002'], pane('4400000001'));
    expect(await select('linkedin:4400000002')).toEqual({ missing: true });
  });

  it('reports a card that is not on the page', async () => {
    searchPage(['4400000001']);
    expect(await select('linkedin:4400000009')).toEqual({ missing: true });
  });
});

describe('LinkedIn classic layout', () => {
  const POSTING = 'You will build payment APIs in TypeScript and React for millions of businesses. '.repeat(8).trim();

  beforeEach(() => {
    vi.useFakeTimers();
    Element.prototype.scrollIntoView = vi.fn();
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  async function settle<T>(pending: Promise<T>): Promise<T> {
    await vi.advanceTimersByTimeAsync(20_000);
    return pending;
  }

  function classicCard(id: string, lines: string[]) {
    return `<li data-occludable-job-id="${id}"><div data-job-id="${id}"><a href="/jobs/view/${id}/?trk=search">${lines[0] ?? ''}</a>${lines
      .slice(1)
      .map((line) => `<span>${line}</span>`)
      .join('')}</div></li>`;
  }

  it('reads classic cards, fills in undrawn ones, and sees "View next page"', async () => {
    document.body.innerHTML = `<ul>${classicCard('4400000011', ['Rust Software Engineer', 'Globex', 'Mountain View, CA (On-site)', '8 minutes ago', 'Easy Apply'])}<li data-occludable-job-id="4400000012"></li></ul>
      <button aria-label="Company photos Next">Next</button><button aria-label="View next page">Next</button>`;
    const list = document.querySelector('li[data-occludable-job-id="4400000012"]')!;
    (Element.prototype.scrollIntoView as ReturnType<typeof vi.fn>).mockImplementation(function (this: Element) {
      if (this === list) this.innerHTML = '<div><a href="/jobs/view/4400000012/">Platform Engineer</a><span>Stripe</span><span>Remote</span></div>';
    });
    const result = (await settle(readLinkedInSearchPage())) as { cards: Array<{ id: string; lines: string[] }>; hasNext: boolean };
    expect(result.hasNext).toBe(true);
    expect(result.cards).toEqual([
      { id: '4400000011', lines: ['Rust Software Engineer', 'Globex', 'Mountain View, CA (On-site)', '8 minutes ago', 'Easy Apply'] },
      { id: '4400000012', lines: ['Platform Engineer', 'Stripe', 'Remote'] },
    ]);
    expect(linkedInListings(result, NOW)?.[0]).toMatchObject({ title: 'Rust Software Engineer', company: 'Globex', workplace: 'On-site', easyApply: true });
  });

  it('does not mistake the photo carousel for a next page', async () => {
    document.body.innerHTML = `<ul>${classicCard('4400000011', ['Rust Software Engineer', 'Globex', 'Remote'])}</ul><button aria-label="Company photos Next">Next</button>`;
    expect(((await settle(readLinkedInSearchPage())) as { hasNext: boolean }).hasNext).toBe(false);
  });

  function classicPane(id: string, applyLabel: string) {
    return `<div class="jobs-search__job-details--wrapper"><div><h2><a href="/jobs/view/${id}/">Software Engineer</a></h2><p>West Huntsville, AL · Reposted 10 minutes ago · Over 100 people clicked apply</p></div>
      <button id="jobs-apply-button-id" class="jobs-apply-button" aria-label="${applyLabel}">Apply</button>
      <div id="job-details">About the job ${POSTING}</div></div>`;
  }

  it('clicks the classic card link and reads the job once the pane shows it', async () => {
    document.body.innerHTML = `<ul>${classicCard('4400000011', ['Rust Software Engineer', 'Globex'])}${classicCard('4400000012', ['Platform Engineer', 'Stripe', '45 minutes ago'])}</ul><section id="detail">${classicPane('4400000011', 'Apply to Rust Software Engineer on company website')}</section>`;
    document.querySelector('a[href^="/jobs/view/4400000012"]')!.addEventListener('click', (event) => {
      event.preventDefault();
      setTimeout(() => {
        document.getElementById('detail')!.innerHTML = classicPane('4400000012', 'Easy Apply to Platform Engineer');
      }, 900);
    });
    expect(await settle(readLinkedInSelectedJob('linkedin:4400000012'))).toEqual({
      blocked: false,
      description: POSTING,
      applyUrl: null,
      easyApply: true,
      postedAgo: '10 minutes ago',
    });
  });

  it('does not take the "Easy Apply" search filter for an Easy Apply job', async () => {
    document.body.innerHTML = `<button aria-label="Easy Apply filter.">Easy Apply</button><ul>${classicCard('4400000011', ['Rust Software Engineer', 'Globex'])}</ul>${classicPane('4400000011', 'Apply to Rust Software Engineer on company website')}`;
    expect(await settle(readLinkedInSelectedJob('linkedin:4400000011'))).toMatchObject({ easyApply: false });
  });

  it('reads the classic pane without clicking when it already shows the job', async () => {
    document.body.innerHTML = `<ul>${classicCard('4400000011', ['Rust Software Engineer', 'Globex'])}</ul>${classicPane('4400000011', 'Apply to Rust Software Engineer on company website')}`;
    const clicked = vi.fn();
    document.querySelector('a[href^="/jobs/view/4400000011"]')!.addEventListener('click', clicked);
    expect(await settle(readLinkedInSelectedJob('linkedin:4400000011'))).toMatchObject({ description: POSTING, easyApply: false });
    expect(clicked).not.toHaveBeenCalled();
  });

  it('reads #job-details on a classic job page', async () => {
    document.body.innerHTML = `<div id="job-details">About the job ${POSTING}</div>`;
    expect(((await settle(readLinkedInJobPage())) as { description: string }).description).toBe(POSTING);
  });

  it('randomizes how far each check goes', () => {
    expect(linkedInSource.limits.searchPages.min).toBeLessThan(linkedInSource.limits.searchPages.max);
    expect(linkedInSource.limits.detailReads.min).toBeLessThan(linkedInSource.limits.detailReads.max);
  });
});
