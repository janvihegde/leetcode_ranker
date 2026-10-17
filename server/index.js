const path = require('path');
const fs = require('fs');

// Minimal .env loader for local development (production uses real env vars).
try {
  const envFile = path.join(__dirname, '..', '.env');
  if (fs.existsSync(envFile)) {
    for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
    }
  }
} catch {}

const express = require('express');
const multer = require('multer');
// Import the lib directly to avoid pdf-parse's debug-mode test file read.
const pdfParse = require('pdf-parse/lib/pdf-parse.js');
const { getUser, getQuestion, LeetCodeError, sleep } = require('./leetcode');
const { ensureCacheDir } = require('./cache');
const github = require('./github');

ensureCacheDir();

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

const RESERVED = new Set([
  'problems', 'problemset', 'contest', 'discuss', 'explore', 'u', 'accounts', 'subscribe',
  'store', 'interview', 'study-plan', 'studyplan', 'company', 'tag', 'tags', 'graphql', 'api',
  'assessment', 'support', 'jobs', 'premium', 'submissions', 'progress', 'list', 'notifications',
  'profile', 'settings', 'login', 'signup', 'terms', 'privacy', 'faq', 'region', 'static',
  'playground', 'articles', 'circle', 'event', 'events', 'points', 'bugbounty', 'student',
]);

const USERNAME_RE = /^[A-Za-z0-9_-]{1,40}$/;

/** Extract usernames from arbitrary text (URLs + bare usernames on their own line). */
function extractUsernames(text) {
  const found = new Map();
  const add = (n) => {
    if (!n || RESERVED.has(n.toLowerCase()) || !USERNAME_RE.test(n)) return;
    if (!found.has(n.toLowerCase())) found.set(n.toLowerCase(), n);
  };
  const re = /leetcode\.(?:com|cn)\/(?:u\/)?([A-Za-z0-9_-]+)/gi;
  let m;
  while ((m = re.exec(text))) add(m[1]);
  return [...found.values()];
}

const GH_RESERVED = new Set([
  'orgs', 'topics', 'features', 'settings', 'about', 'pricing', 'marketplace', 'explore', 'login', 'logout',
  'join', 'signup', 'sponsors', 'notifications', 'issues', 'pulls', 'search', 'trending', 'collections',
  'events', 'enterprise', 'team', 'teams', 'security', 'site', 'contact', 'apps', 'organizations',
  'new', 'codespaces', 'customer-stories', 'readme', 'blog', 'docs', 'login', 'password_reset',
  'dashboard', 'stars', 'watching', 'gist', 'marketplace', 'resources', 'solutions', 'github',
]);
const GH_USER_RE = /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/;

function extractGithubUsernames(text) {
  const found = new Map();
  const re = /github\.com\/([A-Za-z0-9-]{1,39})(?![A-Za-z0-9-])/gi;
  let m;
  while ((m = re.exec(text))) {
    const n = m[1];
    if (GH_RESERVED.has(n.toLowerCase()) || !GH_USER_RE.test(n)) continue;
    if (!found.has(n.toLowerCase())) found.set(n.toLowerCase(), n);
  }
  return [...found.values()];
}

app.get('/health', (req, res) => res.json({ status: 'ok', uptime: process.uptime() }));

app.post('/api/parse-pdf', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded (field name "file").' });
  if (!/pdf/i.test(req.file.mimetype) && !/\.pdf$/i.test(req.file.originalname)) {
    return res.status(400).json({ error: 'Please upload a PDF file.' });
  }
  try {
    const data = await pdfParse(req.file.buffer);
    // PDF text may break URLs across lines; also join hyphen/linebreak splits.
    const text = data.text + '\n' + data.text.replace(/\s*\n\s*/g, '');
    const usernames = req.query.type === 'github' ? extractGithubUsernames(text) : extractUsernames(text);
    res.json({ usernames, count: usernames.length });
  } catch (e) {
    res.status(422).json({ error: 'Could not read PDF: ' + e.message });
  }
});

/** Sum calendar counts for UTC days overlapping [startSec, endSec]. */
function calendarSum(calendar, startSec, endSec) {
  const dayStart = Math.floor(startSec / 86400) * 86400;
  let sum = 0;
  for (const [day, count] of Object.entries(calendar)) {
    const d = Number(day);
    if (d >= dayStart && d <= endSec) sum += Number(count) || 0;
  }
  return sum;
}

async function analyzeUser(username, startSec, endSec) {
  const user = await getUser(username);
  const inRange = user.recent.filter((s) => s.timestamp >= startSec && s.timestamp <= endSec);

  // Dedupe by slug, keep latest timestamp.
  const bySlug = new Map();
  for (const s of inRange) {
    const prev = bySlug.get(s.titleSlug);
    if (!prev || s.timestamp > prev.timestamp) bySlug.set(s.titleSlug, s);
  }

  const problems = [];
  const topics = {};
  const difficultyCounts = { Easy: 0, Medium: 0, Hard: 0 };
  for (const s of bySlug.values()) {
    let q;
    try {
      q = await getQuestion(s.titleSlug);
    } catch (e) {
      if (e instanceof LeetCodeError && (e.code === 'BLOCKED' || e.code === 'RATE_LIMITED')) throw e;
      q = { title: s.title, difficulty: 'Unknown', topicTags: [] };
    }
    problems.push({
      title: s.title,
      titleSlug: s.titleSlug,
      id: q.id,
      difficulty: q.difficulty,
      link: `https://leetcode.com/problems/${s.titleSlug}/`,
      solvedAt: s.timestamp,
      topics: q.topicTags.map((t) => t.name),
    });
    if (difficultyCounts[q.difficulty] !== undefined) difficultyCounts[q.difficulty]++;
    for (const t of q.topicTags) topics[t.name] = (topics[t.name] || 0) + 1;
  }
  problems.sort((a, b) => b.solvedAt - a.solvedAt);

  const oldest = user.recent.length ? Math.min(...user.recent.map((s) => s.timestamp)) : null;
  const incomplete = user.recent.length >= 20 && oldest !== null && oldest > startSec;
  const calendarCount = calendarSum(user.calendar, startSec, endSec);

  return {
    username: user.username,
    realName: user.realName,
    avatar: user.avatar,
    ranking: user.ranking,
    totals: user.totals,
    solvedInRange: problems.length,
    difficultyCounts,
    topics: Object.entries(topics)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
    problems,
    incomplete,
    calendarCount,
    recentCoverageFrom: oldest,
  };
}

app.post('/api/analyze', async (req, res) => {
  const { usernames, start, end } = req.body || {};
  if (!Array.isArray(usernames) || usernames.length === 0)
    return res.status(400).json({ error: 'Provide a non-empty "usernames" array.' });
  if (usernames.length > 50) return res.status(400).json({ error: 'Max 50 users per request.' });
  const startSec = Math.floor(new Date(start).getTime() / 1000);
  const endSec = Math.floor(new Date(end).getTime() / 1000);
  if (!Number.isFinite(startSec) || !Number.isFinite(endSec) || startSec >= endSec)
    return res.status(400).json({ error: 'Invalid time range.' });

  const results = [];
  let blocked = null;
  for (let i = 0; i < usernames.length; i++) {
    const name = String(usernames[i]).trim();
    if (blocked) {
      results.push({ username: name, error: blocked.message, errorCode: blocked.code });
      continue;
    }
    if (!USERNAME_RE.test(name)) {
      results.push({ username: name, error: 'Invalid username format.', errorCode: 'INVALID' });
      continue;
    }
    try {
      results.push(await analyzeUser(name, startSec, endSec));
    } catch (e) {
      const code = e instanceof LeetCodeError ? e.code : 'UPSTREAM';
      if (code === 'BLOCKED' || code === 'RATE_LIMITED') blocked = e;
      results.push({ username: name, error: e.message, errorCode: code });
    }
    if (i < usernames.length - 1) await sleep(300);
  }

  res.json({
    range: { start: startSec, end: endSec },
    results,
    globalError: blocked ? { code: blocked.code, message: blocked.message } : null,
  });
});

// ---------- GitHub ----------
app.get('/api/github/status', (req, res) => res.json({ tokenConfigured: github.hasToken() }));

app.post('/api/github/analyze', async (req, res) => {
  const { usernames, start, end, repo } = req.body || {};
  if (!github.hasToken()) {
    return res.status(503).json({
      error: 'GITHUB_TOKEN is not configured on the server. Set it as an environment variable (see README) and restart.',
      code: 'NO_TOKEN',
    });
  }
  if (!Array.isArray(usernames) || usernames.length === 0)
    return res.status(400).json({ error: 'Provide a non-empty "usernames" array.' });
  if (usernames.length > 30) return res.status(400).json({ error: 'Max 30 GitHub users per request.' });
  const from = new Date(start), to = new Date(end);
  if (isNaN(from) || isNaN(to) || from >= to) return res.status(400).json({ error: 'Invalid time range.' });
  const repoName = github.parseRepo(repo);
  if (repo && repo.trim() && !repoName) return res.status(400).json({ error: 'Repo must be "owner/repo" or a GitHub URL.' });

  const results = [];
  let fatal = null;
  for (const raw of usernames) {
    const name = String(raw).trim();
    if (fatal) { results.push({ username: name, error: fatal.message, errorCode: fatal.code }); continue; }
    if (!GH_USER_RE.test(name)) { results.push({ username: name, error: 'Invalid username format.', errorCode: 'INVALID' }); continue; }
    try {
      results.push(await github.analyzeUser(name, from, to, repoName));
    } catch (e) {
      const code = e.code || 'UPSTREAM';
      if (['RATE_LIMITED', 'TOKEN_INVALID', 'NO_TOKEN'].includes(code)) fatal = e;
      results.push({ username: name, error: e.message, errorCode: code });
    }
  }
  res.json({
    range: { start: from.toISOString(), end: to.toISOString() },
    repo: repoName,
    results,
    globalError: fatal ? { code: fatal.code, message: fatal.message } : null,
  });
});

const PORT = Number(process.env.PORT) || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`LeetCode Activity Analyzer running on http://0.0.0.0:${PORT}`);
});

module.exports = { extractUsernames };
