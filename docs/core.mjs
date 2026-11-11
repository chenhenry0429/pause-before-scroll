import {randomId} from './compat.mjs';
// Pure data logic. A session measures elapsed planned time, not app or video use.
export const MAX_HISTORY = 500;
export const PLATFORMS = Object.freeze(['wechat', 'bili', 'other']);
export const OUTCOMES = Object.freeze(['stopped', 'continued']);
export const MOODS = Object.freeze(['better', 'same', 'worse', 'skip']);
const MAX_DATE = 8_640_000_000_000_000;
const DEFAULT_ALTERNATIVE = '站起来，喝口水';
let fallbackSequence = 0;

export function defaultData() {
  return {
    settings: { minutes: 10, delaySeconds: 10, alternative: DEFAULT_ALTERNATIVE, sound: false },
    active: null,
    history: [],
  };
}

function record(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value));
}

function integer(value, minimum, maximum) {
  return Number.isSafeInteger(value) && value >= minimum && value <= maximum;
}

function timestamp(value) {
  return integer(value, 0, MAX_DATE);
}

function requireTimestamp(value) {
  if (!timestamp(value)) throw new RangeError('时间戳必须是有效的非负整数毫秒。');
  return value;
}

function cleanText(value, maximum) {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!text || /[\u0000-\u001f\u007f]/u.test(text) || [...text].length > maximum) return null;
  return text;
}

function sessionData(value) {
  if (!record(value)) return null;
  const id = cleanText(value.id, 100);
  const reason = cleanText(value.reason, 160);
  const alternative = cleanText(value.alternative, 120);
  if (!id || !reason || !alternative || !PLATFORMS.includes(value.platform)
      || !integer(value.minutes, 1, 180) || !timestamp(value.startedAt)
      || !timestamp(value.endsAt) || value.endsAt !== value.startedAt + value.minutes * 60_000) return null;
  return { id, platform: value.platform, minutes: value.minutes, reason, alternative,
    startedAt: value.startedAt, endsAt: value.endsAt };
}

function historyData(value) {
  const session = sessionData(value);
  if (!session || !timestamp(value.finishedAt) || value.finishedAt < session.startedAt
      || !OUTCOMES.includes(value.outcome)) return null;
  return { ...session, finishedAt: value.finishedAt,
    elapsedSeconds: Math.floor((value.finishedAt - session.startedAt) / 1_000),
    outcome: value.outcome, mood: MOODS.includes(value.mood) ? value.mood : 'skip' };
}

function cleanHistory(values) {
  if (!Array.isArray(values)) return [];
  const sorted = values.map(historyData).filter(Boolean)
    .sort((a, b) => b.finishedAt - a.finishedAt || b.startedAt - a.startedAt);
  const seen = new Set();
  return sorted.filter(item => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  }).slice(0, MAX_HISTORY);
}

export function createSession(input = {}, now = Date.now()) {
  const platform=input.platform,minutes=input.minutes,reason=input.reason,alternative=input.alternative;
  requireTimestamp(now);
  if (!PLATFORMS.includes(platform)) throw new TypeError('请选择有效的平台。');
  if (!integer(minutes, 1, 180)) throw new RangeError('时长必须是 1–180 的整数分钟。');
  const cleanReason = cleanText(reason, 160);
  const cleanAlternative = cleanText(alternative, 120);
  if (!cleanReason || !cleanAlternative) throw new TypeError('原因和替代活动必须是有效的简短文本。');
  const endsAt = now + minutes * 60_000;
  requireTimestamp(endsAt);
  let id;
  try { id = randomId(); } catch { id = `${now.toString(36)}-${(++fallbackSequence).toString(36)}-${Math.random().toString(36).slice(2)}`; }
  return { id, platform, minutes, reason: cleanReason, alternative: cleanAlternative, startedAt: now, endsAt };
}

export function remainingMs(session, now = Date.now()) {
  const clean = sessionData(session);
  if (!clean) throw new TypeError('无效的计时计划。');
  requireTimestamp(now);
  // A clock moved backwards must not grant more than the original planned time.
  return Math.min(clean.minutes * 60_000, Math.max(0, clean.endsAt - now));
}

export function finishSession(session, input = {}, now = Date.now()) {
  const outcome=input.outcome,mood=input.mood===undefined?'skip':input.mood;
  const clean = sessionData(session);
  if (!clean) throw new TypeError('无效的计时计划。');
  requireTimestamp(now);
  if (!OUTCOMES.includes(outcome) || !MOODS.includes(mood)) throw new TypeError('请选择有效的结束结果与感受。');
  // Wall-clock corrections cannot produce a negative elapsed duration.
  const finishedAt = Math.max(clean.startedAt, now);
  return { ...clean, finishedAt, elapsedSeconds: Math.floor((finishedAt - clean.startedAt) / 1_000), outcome, mood };
}

export function sanitizeData(raw) {
  const data = defaultData();
  try {
    const source = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!record(source)) return data;
    if (record(source.settings)) {
      const s = source.settings;
      if (integer(s.minutes, 1, 180)) data.settings.minutes = s.minutes;
      if (integer(s.delaySeconds, 0, 60)) data.settings.delaySeconds = s.delaySeconds;
      data.settings.alternative = cleanText(s.alternative, 120) ?? DEFAULT_ALTERNATIVE;
      if (typeof s.sound === 'boolean') data.settings.sound = s.sound;
    }
    data.history = cleanHistory(source.history);
    data.active = sessionData(source.active);
    // Never restore a plan that is already present in completed history.
    if (data.active && data.history.some(item => item.id === data.active.id)) data.active = null;
    return data;
  } catch {
    return defaultData();
  }
}

function localDateKey(date) {
  return `${String(date.getFullYear()).padStart(4, '0')}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function summarize(history, now = Date.now()) {
  requireTimestamp(now);
  // Calendar arithmetic, rather than 24-hour subtraction, also handles DST days.
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(today);
    date.setDate(date.getDate() - (6 - index));
    return { date: localDateKey(date), label: `${date.getMonth() + 1}/${date.getDate()}`, minutes: 0, count: 0 };
  });
  const byDate = new Map(days.map(day => [day.date, { day, seconds: 0 }]));
  let sessions = 0, seconds = 0, stopped = 0;
  for (const entry of cleanHistory(history)) {
    if (entry.finishedAt > now || entry.startedAt > now) continue;
    const bucket = byDate.get(localDateKey(new Date(entry.startedAt)));
    if (!bucket) continue;
    bucket.day.count += 1;
    bucket.seconds += entry.elapsedSeconds;
    sessions += 1;
    seconds += entry.elapsedSeconds;
    if (entry.outcome === 'stopped') stopped += 1;
  }
  for (const bucket of byDate.values()) bucket.day.minutes = Math.round(bucket.seconds / 6) / 10;
  return { sessions, minutes: Math.round(seconds / 6) / 10, stopped, days };
}

export function feedbackUrl(repo, input = {}) {
  const category=input.category,title=input.title,body=input.body;
  // Only a GitHub owner/repository slug is accepted, never an arbitrary URL.
  if (typeof repo !== 'string' || !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9_.-]{1,100}$/.test(repo)
      || ['.', '..'].includes(repo.split('/')[1])) throw new TypeError('反馈仓库应为 owner/repo。');
  const cleanCategory = cleanText(category, 40);
  const cleanTitle = cleanText(title, 180);
  if (!cleanCategory || !cleanTitle || typeof body !== 'string' || body.length > 6_000
      || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(body)) throw new TypeError('请输入有效的反馈分类、标题和正文。');
  const url = new URL(`https://github.com/${repo}/issues/new`);
  url.searchParams.set('title', `[${cleanCategory}] ${cleanTitle}`);
  url.searchParams.set('body', body.trim());
  // The caller explicitly supplies text; no session or history is ever attached.
  return url.toString();
}
