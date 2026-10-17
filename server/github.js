const { TTLCache } = require('./cache');

const ENDPOINT = 'https://api.github.com/graphql';
const YEAR_MS = 365 * 24 * 3600 * 1000;
const TOP_REPOS = 5;
const MAX_HISTORY_PAGES = 5; // up to 500 commits per repo for line counts

const cache = new TTLCache(5 * 60 * 1000);

class GitHubError extends Error {
  constructor(message, code, status) {
    super(message);
    this.code = code; // NO_TOKEN | TOKEN_INVALID | NOT_FOUND | RATE_LIMITED | REPO_NOT_FOUND | UPSTREAM
    this.status = status;
  }
}

const hasToken = () => Boolean(process.env.GITHUB_TOKEN && process.env.GITHUB_TOKEN.trim());

async function gql(query, variables) {
  if (!hasToken()) {
    throw new GitHubError('GITHUB_TOKEN is not configured on the server. Add it as an environment variable and restart.', 'NO_TOKEN', 503);
  }
  let res;
  try {
    res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `bearer ${process.env.GITHUB_TOKEN.trim()}`,
        'Content-Type': 'application/json',
        'User-Agent': 'lcpulse-analyzer',
      },
      body: JSON.stringify({ query, variables }),
    });
  } catch (e) {
    throw new GitHubError(`Network error contacting GitHub: ${e.message}`, 'UPSTREAM', 502);
  }
  if (res.status === 401) throw new GitHubError('GITHUB_TOKEN is invalid or expired.', 'TOKEN_INVALID', 503);
  if (res.status === 403 || res.status === 429) {
    const reset = res.headers.get('x-ratelimit-reset');
    const when = reset ? ` Resets at ${new Date(Number(reset) * 1000).toLocaleTimeString()}.` : '';
    throw new GitHubError(`GitHub rate limit or abuse protection hit.${when}`, 'RATE_LIMITED', 429);
  }
  if (!res.ok) throw new GitHubError(`GitHub API error (${res.status}).`, 'UPSTREAM', 502);
  const json = await res.json();
  if (json.errors?.some((e) => e.type === 'RATE_LIMITED')) {
    throw new GitHubError('GitHub GraphQL rate limit exceeded. Try again later.', 'RATE_LIMITED', 429);
  }
  return json;
}

/** Split [from,to] into ≤1-year chunks (contributionsCollection limit). */
function chunks(from, to) {
  const out = [];
  let s = from.getTime();
  const e = to.getTime();
  while (s < e) {
    const ce = Math.min(s + YEAR_MS - 1000, e);
    out.push([new Date(s), new Date(ce)]);
    s = ce + 1000;
  }
  return out;
}

const CONTRIB_QUERY = `
query($login: String!, $from: DateTime!, $to: DateTime!) {
  user(login: $login) {
    id login name avatarUrl url
    contributionsCollection(from: $from, to: $to) {
      totalCommitContributions
      totalPullRequestContributions
      totalIssueContributions
      totalPullRequestReviewContributions
      restrictedContributionsCount
      commitContributionsByRepository(maxRepositories: 100) {
        repository { nameWithOwner url isPrivate defaultBranchRef { name } }
        contributions(first: 100) { totalCount nodes { occurredAt commitCount } }
      }
    }
  }
}`;

const HISTORY_QUERY = `
query($owner: String!, $name: String!, $author: ID!, $since: GitTimestamp!, $until: GitTimestamp!, $cursor: String) {
  repository(owner: $owner, name: $name) {
    nameWithOwner url
    defaultBranchRef {
      target {
        ... on Commit {
          history(author: { id: $author }, since: $since, until: $until, first: 100, after: $cursor) {
            totalCount
            pageInfo { hasNextPage endCursor }
            nodes { additions deletions committedDate }
          }
        }
      }
    }
  }
}`;

async function repoHistory(nameWithOwner, authorId, since, until) {
  const [owner, name] = nameWithOwner.split('/');
  let cursor = null, pages = 0, additions = 0, deletions = 0, total = 0, url = `https://github.com/${nameWithOwner}`;
  const days = {};
  let truncated = false;
  do {
    const json = await gql(HISTORY_QUERY, {
      owner, name, author: authorId, since: since.toISOString(), until: until.toISOString(), cursor,
    });
    const repo = json.data?.repository;
    if (!repo) throw new GitHubError(`Repository "${nameWithOwner}" not found or not accessible.`, 'REPO_NOT_FOUND', 404);
    url = repo.url;
    const h = repo.defaultBranchRef?.target?.history;
    if (!h) break; // empty repo
    total = h.totalCount;
    for (const n of h.nodes) {
      additions += n.additions;
      deletions += n.deletions;
      const d = n.committedDate.slice(0, 10);
      days[d] = (days[d] || 0) + 1;
    }
    cursor = h.pageInfo.hasNextPage ? h.pageInfo.endCursor : null;
    pages++;
    if (cursor && pages >= MAX_HISTORY_PAGES) { truncated = true; cursor = null; }
  } while (cursor);
  return { repo: nameWithOwner, url, commits: total, additions, deletions, days, truncated };
}

/** Parse "owner/repo" or a GitHub URL into "owner/repo". */
function parseRepo(input) {
  if (!input) return null;
  const s = String(input).trim().replace(/\.git$/, '').replace(/\/+$/, '');
  const m = s.match(/(?:github\.com\/)?([A-Za-z0-9-]{1,39})\/([A-Za-z0-9._-]{1,100})$/i);
  return m ? `${m[1]}/${m[2]}` : undefined;
}

async function analyzeUser(login, from, to, repo) {
  const key = `${login.toLowerCase()}|${from.toISOString()}|${to.toISOString()}|${repo || ''}`;
  const hit = cache.get(key);
  if (hit) return hit;

  let user = null;
  const totals = { commits: 0, prs: 0, issues: 0, reviews: 0, restricted: 0 };
  const repoCommits = new Map(); // nameWithOwner -> { commits, url, hasBranch }
  const days = {};

  for (const [cf, ct] of chunks(from, to)) {
    const json = await gql(CONTRIB_QUERY, { login, from: cf.toISOString(), to: ct.toISOString() });
    const u = json.data?.user;
    if (!u) throw new GitHubError(`GitHub user "${login}" does not exist.`, 'NOT_FOUND', 404);
    user = user || u;
    const c = u.contributionsCollection;
    totals.commits += c.totalCommitContributions;
    totals.prs += c.totalPullRequestContributions;
    totals.issues += c.totalIssueContributions;
    totals.reviews += c.totalPullRequestReviewContributions;
    totals.restricted += c.restrictedContributionsCount;
    for (const r of c.commitContributionsByRepository) {
      const k = r.repository.nameWithOwner;
      const prev = repoCommits.get(k) || { commits: 0, url: r.repository.url, hasBranch: !!r.repository.defaultBranchRef, isPrivate: r.repository.isPrivate };
      prev.commits += r.contributions.totalCount;
      repoCommits.set(k, prev);
      if (!repo) for (const n of r.contributions.nodes) {
        const d = n.occurredAt.slice(0, 10);
        days[d] = (days[d] || 0) + n.commitCount;
      }
    }
  }

  let repos;
  let notes = [];
  if (repo) {
    const h = await repoHistory(repo, user.id, from, to);
    repos = [h];
    totals.commits = h.commits;
    Object.assign(days, h.days);
    if (h.truncated) notes.push(`Line counts use the latest ${MAX_HISTORY_PAGES * 100} commits only.`);
  } else {
    const sorted = [...repoCommits.entries()].sort((a, b) => b[1].commits - a[1].commits);
    const top = sorted.filter(([, v]) => v.hasBranch).slice(0, TOP_REPOS);
    repos = [];
    for (const [name, v] of top) {
      try {
        const h = await repoHistory(name, user.id, from, to);
        repos.push({ ...h, commits: v.commits, historyCommits: h.commits });
        if (h.truncated) notes.push(`${name}: line counts use the latest ${MAX_HISTORY_PAGES * 100} commits only.`);
      } catch (e) {
        if (e.code === 'RATE_LIMITED' || e.code === 'TOKEN_INVALID') throw e;
        repos.push({ repo: name, url: v.url, commits: v.commits, additions: 0, deletions: 0, error: e.message });
      }
    }
    // Remaining repos (no line stats) for the table
    for (const [name, v] of sorted) {
      if (!repos.some((r) => r.repo === name)) repos.push({ repo: name, url: v.url, commits: v.commits, additions: null, deletions: null });
    }
    if (sorted.length > TOP_REPOS) notes.push(`Lines are counted for the top ${TOP_REPOS} repositories only (default branch).`);
  }

  const additions = repos.reduce((s, r) => s + (r.additions || 0), 0);
  const deletions = repos.reduce((s, r) => s + (r.deletions || 0), 0);

  const result = {
    username: user.login,
    name: user.name || '',
    avatar: user.avatarUrl,
    url: user.url,
    commits: totals.commits,
    prs: totals.prs,
    issues: totals.issues,
    reviews: totals.reviews,
    restricted: totals.restricted,
    additions,
    deletions,
    net: additions - deletions,
    repos,
    topRepo: repos.slice().sort((a, b) => b.commits - a.commits)[0]?.repo || '',
    days,
    notes,
    repoFilter: repo || null,
  };
  cache.set(key, result);
  return result;
}

module.exports = { analyzeUser, parseRepo, hasToken, GitHubError };
