const { userCache, questionCache, persistQuestions } = require('./cache');

const ENDPOINT = 'https://leetcode.com/graphql';
const MIN_GAP_MS = 350; // minimum gap between outgoing requests
const MAX_RETRIES = 3;

class LeetCodeError extends Error {
  constructor(message, code, status) {
    super(message);
    this.code = code; // NOT_FOUND | BLOCKED | RATE_LIMITED | UPSTREAM
    this.status = status;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Serialised request queue to be gentle with LeetCode.
let chain = Promise.resolve();
let lastCall = 0;
function enqueue(fn) {
  const run = chain.then(async () => {
    const wait = lastCall + MIN_GAP_MS - Date.now();
    if (wait > 0) await sleep(wait);
    lastCall = Date.now();
    return fn();
  });
  chain = run.catch(() => {});
  return run;
}

async function gql(query, variables) {
  let attempt = 0;
  while (true) {
    let res;
    try {
      res = await enqueue(() =>
        fetch(ENDPOINT, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Referer: 'https://leetcode.com/',
            Origin: 'https://leetcode.com',
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36',
          },
          body: JSON.stringify({ query, variables }),
        })
      );
    } catch (e) {
      if (attempt++ < MAX_RETRIES) {
        await sleep(1000 * 2 ** attempt);
        continue;
      }
      throw new LeetCodeError(`Network error contacting LeetCode: ${e.message}`, 'UPSTREAM', 502);
    }

    if (res.status === 429 || res.status >= 500) {
      if (attempt++ < MAX_RETRIES) {
        const ra = Number(res.headers.get('retry-after'));
        await sleep(ra ? ra * 1000 : 1000 * 2 ** attempt);
        continue;
      }
      if (res.status === 429)
        throw new LeetCodeError('LeetCode rate limit hit. Please wait a minute and try again.', 'RATE_LIMITED', 429);
      throw new LeetCodeError(`LeetCode server error (${res.status}).`, 'UPSTREAM', 502);
    }
    if (res.status === 403) {
      throw new LeetCodeError(
        'LeetCode blocked the request (HTTP 403). The server IP may be blocked by Cloudflare — try again later or run locally.',
        'BLOCKED',
        503
      );
    }
    const text = await res.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      // HTML challenge page etc.
      throw new LeetCodeError(
        'LeetCode returned a non-JSON response (likely a bot challenge / block). Try again later.',
        'BLOCKED',
        503
      );
    }
    if (!res.ok) throw new LeetCodeError(`LeetCode error (${res.status}).`, 'UPSTREAM', 502);
    return json;
  }
}

const USER_QUERY = `
query userData($username: String!) {
  matchedUser(username: $username) {
    username
    profile { realName userAvatar ranking }
    submitStats { acSubmissionNum { difficulty count } }
    submissionCalendar
  }
  recentAcSubmissionList(username: $username, limit: 20) {
    title
    titleSlug
    timestamp
  }
}`;

const QUESTION_QUERY = `
query q($titleSlug: String!) {
  question(titleSlug: $titleSlug) {
    questionFrontendId
    title
    difficulty
    topicTags { name slug }
  }
}`;

async function getUser(username) {
  const key = username.toLowerCase();
  const cached = userCache.get(key);
  if (cached) return cached;

  const json = await gql(USER_QUERY, { username });
  const u = json.data && json.data.matchedUser;
  if (!u) {
    throw new LeetCodeError(`User "${username}" does not exist or profile is private.`, 'NOT_FOUND', 404);
  }
  let calendar = {};
  try {
    calendar = JSON.parse(u.submissionCalendar || '{}');
  } catch {}
  const totals = {};
  for (const s of u.submitStats.acSubmissionNum) totals[s.difficulty.toLowerCase()] = s.count;

  const data = {
    username: u.username,
    realName: u.profile?.realName || '',
    avatar: u.profile?.userAvatar || '',
    ranking: u.profile?.ranking || null,
    totals, // { all, easy, medium, hard }
    calendar, // { unixDaySeconds: count }
    recent: (json.data.recentAcSubmissionList || []).map((s) => ({
      title: s.title,
      titleSlug: s.titleSlug,
      timestamp: Number(s.timestamp),
    })),
  };
  userCache.set(key, data);
  return data;
}

async function getQuestion(slug) {
  const cached = questionCache.get(slug);
  if (cached) return cached;
  const json = await gql(QUESTION_QUERY, { titleSlug: slug });
  const q = json.data && json.data.question;
  const data = q
    ? { id: q.questionFrontendId, title: q.title, difficulty: q.difficulty, topicTags: q.topicTags || [] }
    : { id: null, title: slug, difficulty: 'Unknown', topicTags: [] };
  questionCache.set(slug, data);
  persistQuestions();
  return data;
}

module.exports = { getUser, getQuestion, LeetCodeError, sleep };
