/**
 * The sender check exists because of a silent failure: Calder resolves a bare `from` address to a
 * sender identity, and when there is none it sends the message unattributed instead of refusing it.
 * These cases pin the three disagreements it has to catch, and the one it must not invent.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { configuredSenders, senderGaps } from '../server/email/senders.ts';

const config = {
  fromEmail: 'hello@intake.calder.click',
  fromName: 'The Intake Team',
  announcementFromEmail: 'hello@intake.calder.click',
  announcementFromName: 'The Intake Team',
  welcomeFromEmail: 'daniel@intake.calder.click',
  welcomeFromName: 'Daniel from Intake',
};

const daniel = { email: 'daniel@intake.calder.click', displayName: 'Daniel from Intake', status: 'verified' };

test('a project whose three senders are all registered and named correctly reports nothing', () => {
  const gaps = senderGaps(configuredSenders(config), [
    { email: 'hello@intake.calder.click', displayName: 'The Intake Team', status: 'verified' },
    daniel,
  ]);
  assert.deepEqual(gaps, []);
});

test('an address Calder does not know is reported, because the send still goes out', () => {
  const gaps = senderGaps(configuredSenders(config), [daniel]);
  assert.equal(gaps.length, 1);
  assert.equal(gaps[0].kind, 'unregistered');
  assert.equal(gaps[0].role, 'system');
  assert.equal(gaps[0].email, 'hello@intake.calder.click');
});

test('a sender that exists but is not verified is a different finding from a missing one', () => {
  const gaps = senderGaps(configuredSenders(config), [
    { email: 'hello@intake.calder.click', displayName: 'The Intake Team', status: 'pending' },
    daniel,
  ]);
  assert.equal(gaps.length, 1);
  assert.equal(gaps[0].kind, 'not-ready');
  assert.equal(gaps[0].status, 'pending');
});

test('a display name Calder disagrees with is reported: that is what the recipient reads', () => {
  const gaps = senderGaps(configuredSenders(config), [
    { email: 'hello@intake.calder.click', displayName: 'The Intake Team', status: 'verified' },
    { ...daniel, displayName: 'Daniel from Calder' },
  ]);
  assert.equal(gaps.length, 1);
  assert.equal(gaps[0].kind, 'name-differs');
  assert.equal(gaps[0].providerName, 'Daniel from Calder');
  assert.equal(gaps[0].configuredName, 'Daniel from Intake');
});

test('team falling back to the system address is one sender, not two reports', () => {
  const gaps = senderGaps(
    configuredSenders({ ...config, announcementFromEmail: '' }),
    [daniel],
  );
  // hello@ is claimed by `system` only; the fallback must not add a second complaint.
  assert.equal(gaps.filter(gap => gap.email === 'hello@intake.calder.click').length, 1);
});

test('a registered sender with no display name is not a mismatch', () => {
  const gaps = senderGaps(configuredSenders(config), [
    { email: 'hello@intake.calder.click', displayName: null, status: 'verified' },
    { ...daniel, displayName: null },
  ]);
  assert.deepEqual(gaps, []);
});

test('address matching ignores case and surrounding whitespace', () => {
  const gaps = senderGaps(configuredSenders(config), [
    { email: ' HELLO@Intake.Calder.Click ', displayName: 'The Intake Team', status: 'verified' },
    { ...daniel, email: 'Daniel@Intake.calder.click' },
  ]);
  assert.deepEqual(gaps, []);
});

test('a connected Gmail sender is usable, not pending', () => {
  const gaps = senderGaps(configuredSenders(config), [
    { email: 'hello@intake.calder.click', displayName: 'The Intake Team', status: 'connected' },
    { ...daniel, status: 'connected' },
  ]);
  assert.deepEqual(gaps, []);
});
