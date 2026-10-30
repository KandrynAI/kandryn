import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CONFLICT_TEXT,
  EMPTY_LIST_TEXT,
  FAILURE_TEXT,
  SUCCESS_TEXT,
  canSubmit,
  codeFromLocation,
  prepareCode,
  siteLabel,
  sortLinks,
  stateFromError,
  submitMessage,
  type SubmitState,
} from './jiraLink.ts';

/**
 * The link page's logic.
 *
 * The important assertions here are negative: that no failure is tellable
 * apart from another, and that no code can ever arrive from the URL. Both are
 * security properties of the linking design, not presentation choices.
 */

test('every failure cause produces the identical message', () => {
  // 400 wrong, 400 expired, 403 not entitled, 429 rate limited, 500, and a
  // network error with no status at all.
  const states = [400, 403, 429, 500, undefined].map(stateFromError);
  const messages = states.map((s) => submitMessage(s)?.text);
  assert.equal(new Set(messages).size, 1, 'the causes must not be distinguishable');
  assert.equal(messages[0], FAILURE_TEXT);
});

test('only a 409 is told apart, and it says nothing about the code', () => {
  assert.deepEqual(stateFromError(409), { kind: 'conflict' });
  const msg = submitMessage({ kind: 'conflict' });
  assert.equal(msg?.text, CONFLICT_TEXT);
  assert.ok(!/expired|wrong|invalid|used/i.test(CONFLICT_TEXT), 'must not describe the code');
});

test('success tells the person what to do next, in Jira', () => {
  const msg = submitMessage({ kind: 'success', siteUrl: 'https://acme.atlassian.net' });
  assert.equal(msg?.tone, 'success');
  assert.equal(msg?.text, SUCCESS_TEXT);
  assert.match(SUCCESS_TEXT, /Check again/);
});

test('idle and submitting show nothing', () => {
  assert.equal(submitMessage({ kind: 'idle' }), null);
  assert.equal(submitMessage({ kind: 'submitting' }), null);
});

test('no failure message is ever rendered in a red tone', () => {
  // House rule: amber for cautions, never red in the Kandryn UI.
  for (const state of [{ kind: 'failed' } as SubmitState, { kind: 'conflict' } as SubmitState]) {
    assert.equal(submitMessage(state)?.tone, 'caution');
  }
});

test('a code can never come from the URL, whatever the URL says', () => {
  // This is the attack the typed-code design exists to prevent: a link that
  // carries a code lets an attacker bind their Jira account to a victim's
  // Kandryn account. The page has no path from location to the input.
  assert.equal(codeFromLocation('?code=ABCDEFGHJK', ''), null);
  assert.equal(codeFromLocation('?c=ABCDEFGHJK&x=1', '#ABCDEFGHJK'), null);
  assert.equal(codeFromLocation('', '#code=ABCDEFGHJK'), null);
  assert.equal(codeFromLocation('', ''), null);
});

test('Connect is enabled on any non-empty input, and never mid-submit', () => {
  const idle: SubmitState = { kind: 'idle' };
  assert.equal(canSubmit('A', idle), true);
  // Deliberately permissive: a mistyped code must reach the server, which is
  // what counts the attempt. Screening it here would allow free probing.
  assert.equal(canSubmit('nonsense', idle), true);
  assert.equal(canSubmit('   ', idle), false);
  assert.equal(canSubmit('', idle), false);
  assert.equal(canSubmit('ABCDEFGHJK', { kind: 'submitting' }), false);
});

test('the typed code is passed through with only whitespace trimmed', () => {
  // Case, spaces and dashes are the server's to normalize — one normalizer,
  // not two that can drift apart.
  assert.equal(prepareCode('  abcd-efgh  '), 'abcd-efgh');
  assert.equal(prepareCode('ABCDEFGHJK'), 'ABCDEFGHJK');
});

test('a site reads as its host, with a fallback when unknown', () => {
  assert.equal(siteLabel('https://acme.atlassian.net'), 'acme.atlassian.net');
  assert.equal(siteLabel('https://acme.atlassian.net/'), 'acme.atlassian.net');
  assert.equal(siteLabel(null), 'Jira site');
});

test('connections list newest first, with the id breaking a tie', () => {
  const rows = [
    { id: 1, siteUrl: 'https://a.atlassian.net', linkedAt: '2026-10-01T00:00:00.000Z' },
    { id: 3, siteUrl: 'https://c.atlassian.net', linkedAt: '2026-10-30T00:00:00.000Z' },
    { id: 2, siteUrl: 'https://b.atlassian.net', linkedAt: '2026-10-15T00:00:00.000Z' },
  ];
  assert.deepEqual(sortLinks(rows).map((r) => r.id), [3, 2, 1]);
  const tie = [
    { id: 5, siteUrl: null, linkedAt: '2026-10-01T00:00:00.000Z' },
    { id: 9, siteUrl: null, linkedAt: '2026-10-01T00:00:00.000Z' },
  ];
  assert.deepEqual(sortLinks(tie).map((r) => r.id), [9, 5]);
  // Does not mutate its input.
  assert.deepEqual(rows.map((r) => r.id), [1, 3, 2]);
});

test('the empty state names the thing that is empty', () => {
  assert.match(EMPTY_LIST_TEXT, /No Jira accounts connected/);
});

test('the page itself has no way to read a code from the URL', () => {
  // A guard, not a style check. The typed-code design is only as good as the
  // page: one `useSearch()` or `URLSearchParams` prefilling the field would
  // quietly restore the attack the server works to prevent, and it would look
  // like a convenience in review.
  const src = readFileSync(
    join(fileURLToPath(new URL('.', import.meta.url)), '../pages/JiraLinkPage.tsx'),
    'utf8',
  );
  for (const forbidden of [
    'useSearch',
    'URLSearchParams',
    'location.search',
    'location.hash',
    'window.location',
    'searchParams',
  ]) {
    assert.ok(!src.includes(forbidden), `JiraLinkPage must not use ${forbidden}`);
  }
  // And the only place a code is sent from is the typed input's state.
  assert.match(src, /completeJiraLink\(prepareCode\(code\)\)/);
});
