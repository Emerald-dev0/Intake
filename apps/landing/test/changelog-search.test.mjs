import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filterReleases, groupReleasesByDate, releaseSearchText } from '../src/lib/release-search.ts';

/**
 * Finding a release in the changelog.
 *
 * The search is the reader's way in, so it has to behave the way a reader expects: a word they
 * remember finds the release that mentions it, and a word that is not there finds nothing.
 */

const RELEASES = [
  {
    slug: 'the-response-inbox',
    title: 'The inbox, and a number you can trust',
    summary: 'The answers to a hosted form can now be read, searched and exported.',
    body: '## What changed\nAn inbox, with search and a CSV export.',
    categories: ['feature'],
    releaseDate: '2026-10-29',
    publishedAt: '2026-10-29T00:00:00.000Z',
    links: [],
    heroImageUrl: null,
    highlights: ['A CSV export with the same columns as the table.'],
    audience: 'For developers who want the answers in their own hands.',
  },
  {
    slug: 'typeform-joins-google-forms',
    title: 'Typeform is now a creation target',
    summary: 'Pick Google Forms or Typeform when you describe a form.',
    body: '## What changed\nTypeform is a target now.',
    categories: ['feature'],
    releaseDate: '2026-10-24',
    publishedAt: '2026-10-24T00:00:00.000Z',
    links: [],
    heroImageUrl: null,
    highlights: [],
    audience: null,
  },
  {
    slug: 'the-mail-reads-properly',
    title: 'The mail reads properly now',
    summary: 'The row advertising a social account is gone.',
    body: '## What changed\nNo social row.',
    categories: ['improvement'],
    releaseDate: '2026-10-29',
    publishedAt: '2026-10-29T01:00:00.000Z',
    links: [],
    heroImageUrl: null,
    highlights: [],
    audience: null,
  },
];

test('a word the reader remembers finds the release that mentions it', () => {
  const found = filterReleases(RELEASES, 'inbox');
  assert.equal(found.length, 1);
  assert.equal(found[0].slug, 'the-response-inbox');
});

test('the search looks in the notes, not only in the title', () => {
  // "CSV" appears in the highlights and the body, never in the title.
  const found = filterReleases(RELEASES, 'csv');
  assert.equal(found.length, 1);
  assert.equal(found[0].slug, 'the-response-inbox');
});

test('every word has to be there', () => {
  assert.equal(filterReleases(RELEASES, 'inbox csv').length, 1);
  assert.equal(filterReleases(RELEASES, 'inbox typeform').length, 0, 'a word from another release does not match');
});

test('the search does not care about case or about the order of the words', () => {
  assert.equal(filterReleases(RELEASES, 'CSV').length, 1);
  assert.equal(filterReleases(RELEASES, 'csv export').length, 1);
  assert.equal(filterReleases(RELEASES, 'export csv').length, 1);
});

test('a word does not match a word that merely contains it', () => {
  // "at" is inside "create", but a reader who searches for "at" did not mean every release that
  // happens to contain those two letters.
  assert.equal(filterReleases(RELEASES, 'at').length, 0);
});

test('an empty search returns everything', () => {
  assert.equal(filterReleases(RELEASES, '').length, 3);
  assert.equal(filterReleases(RELEASES, '   ').length, 3);
});

test('a category narrows the list, and the two filters work together', () => {
  assert.equal(filterReleases(RELEASES, '', 'feature').length, 2);
  assert.equal(filterReleases(RELEASES, '', 'improvement').length, 1);
  assert.equal(filterReleases(RELEASES, 'mail', 'improvement').length, 1);
  assert.equal(filterReleases(RELEASES, 'mail', 'feature').length, 0);
});

test('a slug is searchable, because a reader may have the address and not the title', () => {
  assert.equal(filterReleases(RELEASES, 'response inbox').length, 1);
  assert.match(releaseSearchText(RELEASES[0]), /the response inbox/);
});

test('the releases are grouped by day, newest day first', () => {
  const groups = groupReleasesByDate(RELEASES);
  assert.equal(groups.length, 2, 'two days');
  assert.equal(groups[0].date, '2026-10-29', 'the newest day leads');
  assert.equal(groups[0].releases.length, 2);
  assert.equal(groups[1].date, '2026-10-24');
});
