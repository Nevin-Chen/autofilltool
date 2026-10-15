import { describe, expect, it } from 'vitest';
import { listingFingerprint, localDateKey, selectNewListings } from '@/jobs/dedupe';
import { NOW, POSTED_YESTERDAY, judged, listing } from './job-fixtures';

const today = localDateKey(NOW);

describe('listingFingerprint', () => {
  it('ignores case and spacing so the same posting on two boards matches', () => {
    expect(listingFingerprint(listing({ title: 'Software  Engineer, PAYMENTS ' }))).toBe(
      listingFingerprint(listing()),
    );
  });

  it('changes when the requirements are reworded', () => {
    expect(listingFingerprint(listing({ requirements: 'Reworded requirements.' }))).not.toBe(
      listingFingerprint(listing()),
    );
  });
});

describe('selectNewListings', () => {
  it('keeps only postings from today', () => {
    const selection = selectNewListings(
      [listing(), listing({ id: 'example:old', postedAt: POSTED_YESTERDAY })],
      [],
      today,
    );
    expect(selection.postedToday).toBe(1);
    expect(selection.candidates.map((c) => c.listing.id)).toEqual(['example:k2stripe0001']);
  });

  it('skips listings already judged by id', () => {
    const selection = selectNewListings([listing()], [judged()], today);
    expect(selection.alreadySeen).toBe(1);
    expect(selection.candidates).toEqual([]);
  });

  it('drops a listing identical to one already judged, even under a new id', () => {
    const selection = selectNewListings([listing({ id: 'example:other-board' })], [judged()], today);
    expect(selection.identicalRepeats).toBe(1);
    expect(selection.candidates).toEqual([]);
  });

  it('drops identical listings within one check', () => {
    const selection = selectNewListings(
      [listing(), listing({ id: 'example:k2stripe0002' }), listing({ id: 'example:k2stripe0003' })],
      [],
      today,
    );
    expect(selection.identicalRepeats).toBe(2);
    expect(selection.candidates).toHaveLength(1);
  });

  it('flags a same-title listing with a reworded description for Claude to compare', () => {
    const earlier = judged({
      id: 'example:bd-1',
      title: 'Robotics Software Engineer',
      company: 'Boston Dynamics',
      requirements: '1+ years in technology operations; strong communication and problem-solving.',
    });
    const reworded = listing({
      id: 'example:bd-2',
      title: 'Robotics Software Engineer',
      company: 'Boston Dynamics',
      requirements: '1+ years in technology operations; communication and problem-solving skills.',
    });
    const [candidate] = selectNewListings([reworded], [earlier], today).candidates;
    expect(candidate?.sameTitleAs?.id).toBe('example:bd-1');
  });

  it('flags the second of two same-title listings found in one check', () => {
    const selection = selectNewListings(
      [
        listing({ id: 'example:rp-1', company: 'Recursion Pharma', requirements: 'Python data pipelines.' }),
        listing({ id: 'example:rp-2', company: 'Recursion Pharma', requirements: 'React dashboards.' }),
      ],
      [],
      today,
    );
    expect(selection.candidates.map((c) => c.sameTitleAs?.id ?? null)).toEqual([null, 'example:rp-1']);
  });

  it('counts a listing returned by two saved searches once', () => {
    const selection = selectNewListings([listing(), listing()], [], today);
    expect(selection.postedToday).toBe(1);
    expect(selection.identicalRepeats).toBe(0);
    expect(selection.candidates).toHaveLength(1);
  });
});
