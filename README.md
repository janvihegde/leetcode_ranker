# LCPulse: LeetCode Activity Analyzer

Analyze LeetCode activity for multiple users over a custom time range: problems solved, topics covered, all-time difficulty totals, and a combined leaderboard.

- **Backend:** Node.js + Express. It proxies LeetCode GraphQL and parses PDFs with `pdf-parse`.
- **Frontend:** Vanilla HTML/CSS/JS with no build step, served from `public/`.

## Features
- Add users by username or profile URL (`leetcode.com/u/name` or `leetcode.com/name`). You can paste several, separated by commas or spaces.
- Upload a PDF. The server extracts profile links with a regex, skips reserved paths (`/problems`, `/contest`, …), and removes duplicates.
- Pick a start/end date-time (default: last 7 days) or use the presets.
- Each user gets a card with:
  - Unique problems solved in the range
  - Topic tags with counts
  - Problem list (title, difficulty, link, time)
  - All-time Easy/Medium/Hard totals
- Combined leaderboard sorted by solved count.
- Caching: user data is cached for 5 minutes in memory. Question metadata is cached for 24 hours and also written to `cache/questions.json`.
- Throttling: requests to LeetCode are sent one at a time, at least 350 ms apart, with exponential-backoff retries on 429/5xx.
- Clear errors for invalid/private users, rate limits, and **403 / Cloudflare blocks**.

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
| POST | `/api/parse-pdf` | multipart `file` | Returns `{ usernames, count }` |
| POST | `/api/analyze` | `{ usernames: [], start, end }` (ISO strings) | Per-user analysis plus `globalError` if LeetCode blocked or rate-limited the request |

## How counting works
- LeetCode's public API only returns the **20 most recent accepted submissions**. These are filtered to your range, and unique `titleSlug`s are counted.
- Sometimes the range starts before the oldest of those 20 submissions. In that case the card shows a notice that the list may be incomplete. It also shows **"≈ N submissions (calendar)"**, which comes from `submissionCalendar`. Keep in mind:
  - The calendar counts accepted *submissions*, not unique problems, so solving the same problem twice counts twice.
  - The calendar uses UTC days.
- The leaderboard ranks by the larger of the unique count and the calendar count.

## Deploy (Render)
1. Push this repo to GitHub:
   ```bash
   git remote add origin https://github.com/<you>/leetcode-activity-analyzer.git
   git push -u origin main
   ```
2. In [Render](https://dashboard.render.com), choose **New → Blueprint** and select the repo. Render reads `render.yaml`:
   - Web service, free plan
   - Build: `npm install`
   - Start: `npm start`
   - Health check: `/health`
3. Wait for the deploy, then open the `*.onrender.com` URL.

You can also set it up by hand: **New → Web Service**, with runtime Node, build `npm install`, and start `npm start`.

Notes:
- The server listens on `process.env.PORT` and binds to `0.0.0.0`.
- Render's disk is temporary. The `cache/` folder is created automatically when the server starts and gets rebuilt as needed.
- Free instances sleep when idle, so the first request after a while can take about 30 seconds.
- **Cloud IPs are sometimes blocked by LeetCode/Cloudflare.** If that happens, the UI shows a clear "LeetCode blocked the request" error. Running locally usually works.

## Project structure
```
server/
  index.js      Express app, routes, analysis logic
  leetcode.js   GraphQL client (queue, retries, block detection)
  cache.js      TTL caches + on-disk question cache
public/
  index.html, styles.css, app.js
render.yaml
```
