import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createSession, remainingMs, finishSession, sanitizeData, summarize, feedbackUrl, defaultData, MAX_HISTORY } from '../docs/core.mjs';

const NOW = new Date(2026, 10, 5, 12, 0, 0).getTime();
const INPUT = { platform: 'wechat', minutes: 10, reason: '想休息一会儿', alternative: '站起来，喝口水' };
const make = (now = NOW, overrides = {}) => createSession({ ...INPUT, ...overrides }, now);
const done = (start = NOW, seconds = 120, outcome = 'stopped') => finishSession(make(start), { outcome }, start + seconds * 1_000);

test('default data returns independent mutable containers', () => {
  const first = defaultData();
  first.settings.minutes = 60;
  first.history.push('changed');
  assert.deepEqual(defaultData(), { settings: { minutes: 10, delaySeconds: 10, alternative: INPUT.alternative, sound: false }, active: null, history: [] });
});

test('session stores a stable deadline and distinct ids, without changing inputs', () => {
  const input = Object.freeze({ ...INPUT, reason: '  休息  ' });
  const session = createSession(input, NOW);
  assert.equal(session.startedAt, NOW);
  assert.equal(session.endsAt, NOW + 600_000);
  assert.equal(session.reason, '休息');
  assert.notEqual(session.id, createSession(input, NOW).id);
  assert.equal(input.reason, '  休息  ');
});

test('session validates minute boundaries, including wrong types and overflow', () => {
  for (const minutes of [0, -1, 181, 1.5, NaN, Infinity, '10', null, undefined]) assert.throws(() => make(NOW, { minutes }));
  assert.equal(make(NOW, { minutes: 1 }).minutes, 1);
  assert.equal(make(NOW, { minutes: 180 }).minutes, 180);
  assert.throws(() => make(8_640_000_000_000_000));
  assert.throws(() => make(-1));
  assert.throws(() => make(NaN));
});

test('session validates platform and bounded plain strings', () => {
  for (const platform of ['', 'youtube', {}, null]) assert.throws(() => make(NOW, { platform }));
  for (const reason of ['', ' ', null, {}, 'x'.repeat(161), 'line\nbreak']) assert.throws(() => make(NOW, { reason }));
  assert.throws(() => make(NOW, { alternative: 'x'.repeat(121) }));
  assert.equal(make(NOW, { reason: '🙂'.repeat(160) }).reason.length, 320);
});

test('remaining time survives JSON reload and missed ticks without restarting', () => {
  const session = make();
  const restored = sanitizeData(JSON.stringify({ active: session })).active;
  assert.deepEqual(restored, session);
  assert.equal(remainingMs(restored, NOW + 95_000), 505_000);
  assert.equal(remainingMs(restored, NOW + 600_000), 0);
  assert.equal(remainingMs(restored, NOW + 3_600_000), 0);
  assert.equal(remainingMs(restored, NOW - 60_000), 600_000);
  assert.throws(() => remainingMs({ ...session, endsAt: NaN }, NOW));
});

test('finishing counts actual elapsed wall time, including overtime; it does not mutate the plan', () => {
  const session = Object.freeze(make());
  const early = finishSession(session, { outcome: 'stopped', mood: 'better' }, NOW + 42_999);
  const late = finishSession(session, { outcome: 'continued' }, NOW + 20 * 60_000);
  assert.equal(early.elapsedSeconds, 42);
  assert.equal(late.elapsedSeconds, 1_200);
  assert.equal(late.mood, 'skip');
  assert.equal(late.id, session.id);
  assert.equal(session.finishedAt, undefined);
});

test('finishing rejects unknown self reports and prevents negative duration after clock rollback', () => {
  assert.throws(() => finishSession(make(), { outcome: 'success' }, NOW));
  assert.throws(() => finishSession(make(), { outcome: 'stopped', mood: 'unknown' }, NOW));
  assert.throws(() => finishSession(make(), { outcome: 'stopped' }, Infinity));
  assert.equal(finishSession(make(), { outcome: 'stopped' }, NOW - 1_000).elapsedSeconds, 0);
});

test('sanitization tolerates damaged JSON, missing data, and non-record roots', () => {
  for (const raw of [null, undefined, '', '{broken', 'null', '42', '[]', [], 42, new Date()]) assert.deepEqual(sanitizeData(raw), defaultData());
  assert.deepEqual(sanitizeData({ settings: null, history: {}, active: {} }), defaultData());
  const hostile = { get settings() { throw new Error('bad property'); } };
  assert.deepEqual(sanitizeData(hostile), defaultData());
});

test('sanitization keeps valid settings and drops unknown fields without coercion', () => {
  const result = sanitizeData({ settings: { minutes: 180, delaySeconds: 0, alternative: '  去走走  ', sound: true, unknown: 'secret' }, extra: 1 });
  assert.deepEqual(result.settings, { minutes: 180, delaySeconds: 0, alternative: '去走走', sound: true });
  assert.equal(result.extra, undefined);
  assert.deepEqual(sanitizeData({ settings: { minutes: '20', delaySeconds: 61, alternative: ' ', sound: 'false' } }).settings, defaultData().settings);
});

test('malformed session timestamps, fields and unknown platforms are removed', () => {
  const s = make();
  for (const patch of [{ startedAt: null }, { endsAt: s.endsAt + 1 }, { platform: 'bad' }, { id: '' }, { minutes: 0 }]) {
    assert.equal(sanitizeData({ active: { ...s, ...patch } }).active, null);
  }
});

test('history recomputes elapsed time, defaults unknown mood, and discards invalid outcomes', () => {
  const completed = done();
  const result = sanitizeData({ history: [{ ...completed, elapsedSeconds: 9_999_999, mood: 'future', private: 'omit' }] });
  assert.equal(result.history[0].elapsedSeconds, 120);
  assert.equal(result.history[0].mood, 'skip');
  assert.equal(result.history[0].private, undefined);
  assert.deepEqual(sanitizeData({ history: [{ ...completed, outcome: 'madeup' }, { ...completed, finishedAt: completed.startedAt - 1 }] }).history, []);
});

test('duplicate completed ids are counted once and cannot be restored as an active session', () => {
  const s = make();
  const first = finishSession(s, { outcome: 'continued' }, NOW + 60_000);
  const latest = finishSession(s, { outcome: 'stopped' }, NOW + 120_000);
  const result = sanitizeData({ active: s, history: [first, latest, latest] });
  assert.equal(result.active, null);
  assert.equal(result.history.length, 1);
  assert.equal(result.history[0].outcome, 'stopped');
});

test('history limit retains newest 500 valid distinct completions', () => {
  const history = Array.from({ length: 505 }, (_, i) => done(NOW + i * 60_000, 1));
  const result = sanitizeData({ history }).history;
  assert.equal(result.length, MAX_HISTORY);
  assert.equal(result[0].startedAt, NOW + 504 * 60_000);
  assert.equal(result.at(-1).startedAt, NOW + 5 * 60_000);
});

test('summary uses seven local calendar dates and omits older or future completions', () => {
  const start = new Date(2026, 10, 5, 0, 0, 0).getTime();
  const history = [done(start, 120), done(start - 6 * 86_400_000, 60, 'continued'), done(start - 7 * 86_400_000, 600), done(NOW + 1_000, 120)];
  const result = summarize(history, NOW);
  assert.equal(result.days.length, 7);
  assert.equal(result.days[0].date, '2026-10-30');
  assert.equal(result.days[6].date, '2026-11-05');
  assert.equal(result.sessions, 2);
  assert.equal(result.minutes, 3);
  assert.equal(result.stopped, 1);
  assert.equal(result.days[6].count, 1);
});

test('cross-midnight elapsed time belongs to the local start date', () => {
  const start = new Date(2026, 10, 4, 23, 58).getTime();
  const result = summarize([done(start, 5 * 60)], NOW);
  assert.equal(result.days.find(d => d.date === '2026-11-04').minutes, 5);
  assert.equal(result.days.find(d => d.date === '2026-11-05').count, 0);
});

test('summary adds seconds before rounding and handles empty or corrupted input', () => {
  const result = summarize([done(NOW - 60_000, 8), done(NOW - 40_000, 8)], NOW);
  assert.equal(result.minutes, 0.3);
  assert.equal(result.days[6].minutes, 0.3);
  assert.equal(summarize(null, NOW).sessions, 0);
  assert.equal(summarize([null, {}, { finishedAt: NaN }], NOW).minutes, 0);
});

test('local date bucketing remains correct across daylight-saving transitions', () => {
  const moduleURL = new URL('../docs/core.mjs', import.meta.url).href;
  const script = `import { summarize } from ${JSON.stringify(moduleURL)};
    console.log(JSON.stringify(summarize([], new Date(2026, 2, 10, 12).getTime()).days.map(d => d.date)));`;
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    encoding: 'utf8', env: { ...process.env, TZ: 'America/New_York' },
  });
  assert.equal(child.status, 0, child.stderr);
  assert.deepEqual(JSON.parse(child.stdout), ['2026-03-04', '2026-03-05', '2026-03-06', '2026-03-07', '2026-03-08', '2026-03-09', '2026-03-10']);
});

test('feedback URL preserves Chinese, newlines and reserved characters without leaking records', () => {
  const body = '第一行 & 下一行\n# 标题 ? x=1';
  const url = new URL(feedbackUrl('owner/pause-before-scroll', { category: '使用建议', title: '中文 & 标题?', body, history: [done()] }));
  assert.equal(url.origin, 'https://github.com');
  assert.equal(url.pathname, '/owner/pause-before-scroll/issues/new');
  assert.equal(url.searchParams.get('title'), '[使用建议] 中文 & 标题?');
  assert.equal(url.searchParams.get('body'), body);
  assert.deepEqual([...url.searchParams.keys()], ['title', 'body']);
});

test('feedback rejects arbitrary URL destinations, traversal and malformed input', () => {
  const feedback = { category: 'bug', title: 'Details', body: '' };
  for (const repo of ['', 'https://github.com/o/r', 'owner/repo/issues', 'owner/..', 'owner/repo?redirect=evil', 'a@evil/repo']) assert.throws(() => feedbackUrl(repo, feedback));
  assert.throws(() => feedbackUrl('owner/repo', { ...feedback, title: '' }));
  assert.throws(() => feedbackUrl('owner/repo', { ...feedback, body: 'x'.repeat(6_001) }));
});

