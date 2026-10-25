# LCPulse: LeetCode & GitHub Activity Analyzer

Analyze activity for multiple users over a custom time range, in two tabs:

- **LeetCode:** problems solved, topics covered, all-time difficulty totals, and a leaderboard.
- **GitHub:** commits, lines added/removed, PRs, per-repo breakdown, commits-per-day chart, and a leaderboard.

- **Backend:** Node.js + Express. It proxies the LeetCode GraphQL API and the GitHub GraphQL API, and parses PDFs with `pdf-parse`.
- **Frontend:** Vanilla HTML/CSS/JS with no build step, served from `public/`.

## LeetCode tab
- **Names + usernames.** Add people with the *Name* (optional) + *LeetCode username or profile link* form. Click a chip to edit it. The list is saved in your browser's `localStorage` and has a **Clear all** button.
- **PDF import.** Upload a PDF where each line or table row has a name and a LeetCode link (e.g. `1. Janvi Hegde - leetcode.com/u/janvihegde`, or a table with Name and LeetCode columns).
  - The server reads it line by line. The text next to each link becomes the name, with numbering (`1.`, `2)`) and separators (`-`, `|`, `:`) removed.
  - Reserved paths like `/problems` are ignored, and duplicates are removed.
- **CSV import.** Upload a CSV with columns `name,username`. The username column can also hold profile links.
- **Review step.** Every import opens a review table. You can edit, add or delete rows before confirming. Rows where no name was found are left blank for you to fill in.
- Pick a start/end date-time (default: last 7 days) or use the presets.
- Each person gets a card titled with their name, with the username as a small link. Each card shows:
  - Unique problems solved in the range
  - Topic tags with counts
  - Problem list (title, difficulty, link, time)
  - All-time Easy/Medium/Hard totals
- **Leaderboard:**
  - Ranked by unique problems solved in the range. Ties share a rank and are ordered by hard problems.
  - Columns: Rank, Name, Solved in range, Easy/Medium/Hard, Top topic.
  - The top 3 get gold, silver and bronze highlights. The heading shows the time range.
- **Downloads (privacy).** **Download CSV** and **Download image** include **names only**, with no usernames, links or other identifiers.
  - Columns: Rank, Name, Solved in range, Easy, Medium, Hard, Top topic.
  - Empty names appear as "Unnamed".
  - The date range is in the image title and the file name (e.g. `leetcode-leaderboard_2026-10-18_to_2026-10-25.csv`).
- **Errors.** The red banner appears only when there is a message. Failed people are listed as `<name>: reason` (not found, private, blocked, or rate-limited).
- Caching: user data is cached for 5 minutes in memory. Question metadata is cached for 24 hours and also written to `cache/questions.json`.
- Throttling: requests to LeetCode are sent one at a time, at least 350 ms apart, with exponential-backoff retries on 429/5xx.
- Clear errors for invalid/private users, rate limits, and **403 / Cloudflare blocks**.

## GitHub tab
- Add users by username or `github.com/<name>` URL, or upload a PDF. Reserved paths (`/orgs`, `/topics`, `/features`, `/settings`, …) are skipped, and duplicates are removed.
- Uses the same time range and presets as the LeetCode tab. There is also an optional **specific repo** field (`owner/repo` or a URL).
- Each user gets a card with:
  - Commits, lines added/removed, net lines, PRs opened
  - A per-repo table
  - A commits-per-day chart (weekly bars for ranges over about 2 months)
- Leaderboard ranked by commits, with toggles for lines added and PRs. Ties share a rank. It also has CSV and PNG export.
- How the data is fetched:
  - `contributionsCollection(from, to)` gives commits, PRs, issues, and commits per repo/day. Ranges longer than one year are split into 1-year chunks.
  - Lines of code come from `defaultBranchRef.target.history(author, since, until)` for the user's **top 5 repos by commits**, or only the specified repo if you gave one. Additions and deletions are summed, capped at 500 commits per repo.
- Results are cached for 5 minutes.
- Unknown users get an error card. A missing or invalid token and rate limits are shown as banners.

### GitHub token
The GitHub tab needs a personal access token on the **server**. It is never sent to the browser.

1. Create a token at <https://github.com/settings/tokens>:
   - Classic: `read:user` is enough for public data. Add `repo` to include private repos you can access.
   - Fine-grained: read-only public access.
2. Make it available to the server in one of these ways:
   - Locally: create a `.env` file (gitignored) with `GITHUB_TOKEN=ghp_xxx`, or run `$env:GITHUB_TOKEN="ghp_xxx"; npm start` in PowerShell.
   - On Render: set `GITHUB_TOKEN` in the service's **Environment** tab.

If the token is missing, the GitHub tab shows a banner explaining how to set it, and the Analyze button is disabled.

## Run locally
Requires **Node.js 18+**.

```bash
npm install
npm start
# open http://localhost:3000
```

Use `npm run dev` to auto-restart on file changes. Set `PORT` to change the port.

## API
| Method | Path | Body | Description |
|---|---|---|---|
| GET | `/health` | n/a | Health check |
| POST | `/api/parse-pdf` | multipart `file` | Returns `{ pairs: [{ name, username }], usernames, count }`. Add `?type=github` to extract GitHub usernames |
| POST | `/api/analyze` | `{ usernames: [], start, end }` (ISO strings) | Per-user analysis plus `globalError` if LeetCode blocked or rate-limited the request |
| GET | `/api/github/status` | n/a | `{ tokenConfigured }` |
| POST | `/api/github/analyze` | `{ usernames: [], start, end, repo? }` | Per-user GitHub stats plus `globalError` |

## How counting works
- LeetCode's public API only returns the **20 most recent accepted submissions**. These are filtered to your range, and unique `titleSlug`s are counted.
- Sometimes the range starts before the oldest of those 20 submissions. In that case the card shows a notice that the list may be incomplete. It also shows **"≈ N submissions (calendar)"**, which comes from `submissionCalendar`. Keep in mind:
  - The calendar counts accepted *submissions*, not unique problems, so solving the same problem twice counts twice.
  - The calendar uses UTC days.
- The leaderboard ranks by the unique count. The calendar figure is shown only as extra context.

## Deploy (Render)
1. Push this repo to GitHub (already set up as `origin` → `janvihegde/leetcode_ranker`):
   ```bash
   git push
   ```
2. In [Render](https://dashboard.render.com), choose **New → Blueprint** and select the repo. Render reads `render.yaml`:
   - Web service, free plan
   - Build: `npm install`
   - Start: `npm start`
   - Health check: `/health`
3. When asked, enter a value for **`GITHUB_TOKEN`**. It is declared with `sync: false`, so the value lives only in Render, not in git.
4. Wait for the deploy, then open the `*.onrender.com` URL. Every push to `main` redeploys automatically.

You can also set it up by hand: **New → Web Service**, with runtime Node, build `npm install`, and start `npm start`.

Notes:
- The server listens on `process.env.PORT` and binds to `0.0.0.0`.
- Render's disk is temporary. The `cache/` folder is created automatically when the server starts and gets rebuilt as needed.
- Free instances sleep when idle, so the first request after a while can take about 30 seconds.
- **Cloud IPs are sometimes blocked by LeetCode/Cloudflare.** If that happens, the UI shows a clear "LeetCode blocked the request" error. Running locally usually works.

## Project structure
```
server/
  index.js      Express app, routes, LeetCode analysis, .env loader
  leetcode.js   LeetCode GraphQL client (queue, retries, block detection)
  github.js     GitHub GraphQL client (contributions, line stats, caching)
  cache.js      TTL caches + on-disk question cache
public/
  index.html, styles.css
  app.js        LeetCode tab + tab switching
  github.js     GitHub tab
render.yaml
```
