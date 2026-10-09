import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { todayInShanghai, resolvePeriod, validatePeriod, inPeriod, parsePeriod } from '../lib/news-period';
import { initialProfile } from '../lib/personal-engine';
import type { News } from '../lib/personal-types';

test('presets include today, handle month/year/leap boundaries and Shanghai midnight', () => {
  assert.equal(todayInShanghai(new Date('2026-10-08T16:00:00Z')), '2026-10-09');
  assert.equal(todayInShanghai(new Date('2026-10-08T15:59:59Z')), '2026-10-08');
  assert.deepEqual(resolvePeriod({ kind: 'days', days: 1 }, '2026-10-09'), { start: '2026-10-09', end: '2026-10-09' });
  assert.deepEqual(resolvePeriod({ kind: 'days', days: 7 }, '2026-01-03'), { start: '2025-12-28', end: '2026-01-03' });
  assert.deepEqual(resolvePeriod({ kind: 'days', days: 30 }, '2024-03-01'), { start: '2024-02-01', end: '2024-03-01' });
  assert.equal(resolvePeriod({ kind: 'all' }), null);
});
test('custom values reject incomplete, impossible, reversed, future and oversized ranges', () => {
  for (const days of [0, 31, 1.5, NaN]) assert.throws(() => resolvePeriod({ kind: 'days', days }));
  for (const [start, end] of [['', '2026-10-09'], ['2026-02-30', '2026-03-01'], ['2026-10-09', '2026-10-08'], ['2026-10-01', '2026-10-10'], ['2026-09-09', '2026-10-09']])
    assert.throws(() => validatePeriod({ start, end }, '2026-10-09'));
  assert.deepEqual(validatePeriod({ start: '2026-09-10', end: '2026-10-09' }, '2026-10-09'), { start: '2026-09-10', end: '2026-10-09' });
  assert.throws(() => parsePeriod(new URLSearchParams('start=2026-10-01')));
  assert.equal(parsePeriod(new URLSearchParams()), null);
});
test('range includes both boundaries and excludes unknown dates', () => {
  const period = { start: '2026-10-03', end: '2026-10-09' };
  for (const date of ['2026-10-03', '2026-10-05', '2026-10-09']) assert.equal(inPeriod(date, period), true);
  for (const date of ['2026-10-02', '2026-10-10', 'unknown']) assert.equal(inPeriod(date, period), false);
});
test('feed filters before the ranking cap, includes public news and leaves rules unchanged', async () => {
  mkdirSync('test-results', { recursive: true });
  process.env.NEWS_DATA_DIR = mkdtempSync('test-results/period-');
  const { db } = await import('../lib/store');
  const { view } = await import('../lib/personal-store');
  const profile = initialProfile();
  profile.description = '测试';
  profile.answers = Array.from({ length: 5 }, (_, i) => ({ newsId: `answered-${i}`, interest: null, importance: null }));
  profile.rules.weights = { relevance: 0, importance: 100, freshness: 0 };
  db.prepare('INSERT INTO personal_profiles VALUES (?,?)').run('period-user', JSON.stringify(profile));
  const news: News[] = Array.from({ length: 25 }, (_, i) => ({ id: `old-${i}`, title: '区间外高分新闻', summary: '', topic: '科研', source: 'test', url: 'https://example.com', date: '2026-10-01', importance: 5, evidence: { approved: true, note: '测试' } }));
  news.push({ ...news[0], id: 'inside', date: '2026-10-09', importance: 1, publicAssessment: { reach: 5, severity: 5, urgency: 5, reason: '测试公共新闻' } });
  assert.equal(view('period-user', news, '').personal.some(n => n.id === 'inside'), false);
  const filtered = view('period-user', news, '', { start: '2026-10-09', end: '2026-10-09' });
  assert.deepEqual(filtered.personal.map(n => n.id), ['inside']);
  assert.deepEqual(filtered.publicNews.map(n => n.id), ['inside']);
  assert.equal(filtered.personal[0].duplicate, true);
  assert.deepEqual(filtered.profile, profile);
  assert.equal(view('period-user', news, '', { start: '2026-09-01', end: '2026-09-01' }).personal.length, 0);
  assert.equal(view('new-user', news, '', { start: '2026-09-01', end: '2026-09-01' }).sources.length, 1);
  db.close();
});
