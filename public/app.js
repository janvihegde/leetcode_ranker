(() => {
  const $ = (s) => document.querySelector(s);
  const state = { users: [], results: null, sort: 'total', rangeText: '' };

  const els = {
    form: $('#add-form'), input: $('#user-input'), chips: $('#chips'), count: $('#user-count'),
    clear: $('#clear-btn'), pdf: $('#pdf-input'), drop: $('#dropzone'),
    start: $('#start-input'), end: $('#end-input'), analyze: $('#analyze-btn'),
    alert: $('#global-alert'), results: $('#results'), board: $('#leaderboard tbody'),
    cards: $('#cards'), rangeLabel: $('#range-label'), toast: $('#toast'),
  };

  const RESERVED = new Set(['problems', 'problemset', 'contest', 'discuss', 'explore', 'u', 'accounts', 'study-plan', 'tag', 'company', 'submissions', 'profile']);

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function toast(msg, ms = 2800) {
    els.toast.textContent = msg;
    els.toast.hidden = false;
    clearTimeout(toast.t);
    toast.t = setTimeout(() => (els.toast.hidden = true), ms);
  }

  function parseUsername(raw) {
    const s = raw.trim();
    if (!s) return null;
    const m = s.match(/leetcode\.(?:com|cn)\/(?:u\/)?([A-Za-z0-9_-]+)/i);
    const name = m ? m[1] : s.replace(/^@/, '').replace(/\/+$/, '');
    if (!/^[A-Za-z0-9_-]{1,40}$/.test(name) || RESERVED.has(name.toLowerCase())) return null;
    return name;
  }

  function addUsers(names) {
    let added = 0;
    for (const n of names) {
      if (!state.users.some((u) => u.toLowerCase() === n.toLowerCase())) {
        state.users.push(n);
        added++;
      }
    }
    renderChips();
    return added;
  }

  function renderChips() {
    els.chips.innerHTML = state.users
      .map((u, i) => `<li class="chip">${esc(u)}<button type="button" data-i="${i}" aria-label="Remove ${esc(u)}">✕</button></li>`)
      .join('');
    const n = state.users.length;
    els.count.textContent = n ? `${n} user${n > 1 ? 's' : ''}` : 'No users added';
    els.clear.hidden = !n;
    els.analyze.disabled = !n;
  }

  els.chips.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-i]');
    if (!b) return;
    state.users.splice(Number(b.dataset.i), 1);
    renderChips();
  });
  els.clear.addEventListener('click', () => { state.users = []; renderChips(); });

  els.form.addEventListener('submit', (e) => {
    e.preventDefault();
    // Allow comma / whitespace separated input.
    const parts = els.input.value.split(/[\s,]+/).filter(Boolean);
    const valid = parts.map(parseUsername).filter(Boolean);
    if (!valid.length) return toast('Enter a valid LeetCode username or profile URL');
    const added = addUsers(valid);
    if (!added) toast('Already in the list');
    els.input.value = '';
    els.input.focus();
  });

  // PDF upload
  async function uploadPdf(file) {
    if (!file) return;
    if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') return toast('Please choose a PDF file');
    const fd = new FormData();
    fd.append('file', file);
    els.drop.classList.add('loading');
    const txt = els.drop.querySelector('.dz-text');
    const old = txt.innerHTML;
    txt.textContent = `Parsing ${file.name}…`;
    try {
      const r = await fetch('/api/parse-pdf', { method: 'POST', body: fd });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Upload failed');
      const added = addUsers(data.usernames);
      toast(data.count ? `Found ${data.count} username(s), ${added} new` : 'No LeetCode profile links found in PDF');
    } catch (e) {
      toast('⚠ ' + e.message, 4000);
    } finally {
      els.drop.classList.remove('loading');
      txt.innerHTML = old;
      els.pdf.value = '';
    }
  }
  els.pdf.addEventListener('change', () => uploadPdf(els.pdf.files[0]));
  ['dragenter', 'dragover'].forEach((ev) => els.drop.addEventListener(ev, (e) => { e.preventDefault(); els.drop.classList.add('drag'); }));
  ['dragleave', 'drop'].forEach((ev) => els.drop.addEventListener(ev, (e) => { e.preventDefault(); els.drop.classList.remove('drag'); }));
  els.drop.addEventListener('drop', (e) => uploadPdf(e.dataTransfer.files[0]));

  // Time range
  const toLocalInput = (d) => {
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
  };
  function setPreset(days) {
    const end = new Date();
    const start = new Date(end.getTime() - days * 86400000);
    els.start.value = toLocalInput(start);
    els.end.value = toLocalInput(end);
    document.querySelectorAll('.preset').forEach((b) => b.classList.toggle('active', Number(b.dataset.days) === days));
  }
  document.querySelectorAll('.preset').forEach((b) => b.addEventListener('click', () => setPreset(Number(b.dataset.days))));
  [els.start, els.end].forEach((i) => i.addEventListener('input', () => document.querySelectorAll('.preset').forEach((b) => b.classList.remove('active'))));
  setPreset(7);

  // Analyze
  const fmtDate = (sec) => new Date(sec * 1000).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  const fmtRange = (s, e) => `${new Date(s).toLocaleString()} → ${new Date(e).toLocaleString()}`;

  function setLoading(on) {
    els.analyze.disabled = on || !state.users.length;
    els.analyze.querySelector('.spinner').hidden = !on;
    els.analyze.querySelector('.btn-label').textContent = on ? `Analyzing ${state.users.length} user(s)…` : 'Analyze';
  }

  function showSkeleton() {
    els.results.hidden = false;
    els.board.innerHTML = state.users.map(() => `<tr><td colspan="5"><div class="skeleton" style="height:22px"></div></td></tr>`).join('');
    els.cards.innerHTML = state.users
      .map(() => `<div class="panel card"><div class="skeleton" style="height:48px;margin-bottom:16px"></div><div class="skeleton" style="height:60px;margin-bottom:12px"></div><div class="skeleton" style="height:120px"></div></div>`)
      .join('');
  }

  function showAlert(msg) {
    els.alert.innerHTML = `<span>⚠</span><span>${esc(msg)}</span>`;
    els.alert.hidden = !msg;
  }

  els.analyze.addEventListener('click', async () => {
    const start = new Date(els.start.value);
    const end = new Date(els.end.value);
    if (isNaN(start) || isNaN(end)) return toast('Please choose a valid start and end');
    if (start >= end) return toast('Start must be before end');

    showAlert('');
    setLoading(true);
    showSkeleton();
    state.rangeText = fmtRange(start, end);
    els.rangeLabel.textContent = state.rangeText;
    try {
      const r = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ usernames: state.users, start: start.toISOString(), end: end.toISOString() }),
      });
      let data;
      try { data = await r.json(); } catch { throw new Error(`Server returned an invalid response (HTTP ${r.status}).`); }
      if (!r.ok) throw new Error(data.error || `Request failed (HTTP ${r.status})`);
      if (data.globalError) showAlert(data.globalError.message);
      render(data.results);
    } catch (e) {
      showAlert(e.message || 'Something went wrong');
      els.results.hidden = true;
    } finally {
      setLoading(false);
    }
  });

  const effectiveCount = (u) => (u.incomplete ? Math.max(u.solvedInRange, u.calendarCount) : u.solvedInRange);

  // Ranking metrics. Ties share a rank (1,1,3…); inside a tie we sort by hard solved.
  const METRICS = {
    total: { label: 'Total solved', val: effectiveCount, tie: (u) => u.difficultyCounts.Hard },
    hard: { label: 'Hard solved', val: (u) => u.difficultyCounts.Hard, tie: effectiveCount },
    topics: { label: 'Topics covered', val: (u) => u.topics.length, tie: (u) => u.difficultyCounts.Hard },
  };

  function rankedRows() {
    if (!state.results) return [];
    const m = METRICS[state.sort];
    const ok = state.results.filter((u) => !u.error).sort((a, b) =>
      m.val(b) - m.val(a) || m.tie(b) - m.tie(a) || effectiveCount(b) - effectiveCount(a) || a.username.localeCompare(b.username));
    let prev = null, rank = 0;
    return ok.map((u, i) => {
      const v = m.val(u);
      if (v !== prev) { rank = i + 1; prev = v; }
      return { u, rank, tied: false, value: v, topTopic: u.topics[0]?.name || '' };
    }).map((r, _, arr) => ({ ...r, tied: arr.filter((x) => x.rank === r.rank).length > 1 }));
  }

  function renderLeaderboard() {
    const rows = rankedRows();
    const bad = (state.results || []).filter((u) => u.error);
    const col = { total: 2, hard: 3, topics: 4 }[state.sort];
    els.board.innerHTML =
      rows.map(({ u, rank, tied, topTopic }) => `
        <tr class="${rank <= 3 ? 'podium-' + rank : ''}">
          <td><span class="rank-badge" title="${tied ? 'Tied' : ''}">${tied ? 'T' : ''}${rank}</span></td>
          <td><div class="user-cell">${avatar(u)}<a href="https://leetcode.com/u/${encodeURIComponent(u.username)}/" target="_blank" rel="noopener">${esc(u.username)}</a></div></td>
          <td class="${col === 2 ? 'metric-hl' : ''}"><span class="big-num">${u.solvedInRange}</span>
            ${u.incomplete ? `<span class="approx">≈ ${u.calendarCount} submissions (calendar)</span>` : ''}</td>
          <td class="split ${col === 3 ? 'metric-hl' : ''}"><span class="easy">${u.difficultyCounts.Easy}</span> / <span class="medium">${u.difficultyCounts.Medium}</span> / <span class="hard"><b>${u.difficultyCounts.Hard}</b></span></td>
          <td class="hide-sm ${col === 4 ? 'metric-hl' : ''}">${topTopic ? `<span class="tag">${esc(topTopic)}</span>` : '<span class="muted">—</span>'}
            ${state.sort === 'topics' ? `<span class="muted"> · ${u.topics.length} topics</span>` : ''}</td>
        </tr>`).join('') +
      bad.map((u) => `
        <tr><td><span class="rank-badge">—</span></td><td>${esc(u.username)}</td><td colspan="3" class="err-text">${esc(u.error)}</td></tr>`).join('');
  }

  document.querySelectorAll('.seg').forEach((b) => b.addEventListener('click', () => {
    state.sort = b.dataset.sort;
    document.querySelectorAll('.seg').forEach((x) => x.classList.toggle('active', x === b));
    renderLeaderboard();
  }));

  // CSV export
  $('#csv-btn').addEventListener('click', () => {
    const rows = rankedRows();
    if (!rows.length) return toast('Nothing to export yet');
    const q = (v) => `"${String(v).replace(/"/g, '""')}"`;
    const lines = [
      ['Rank', 'Username', 'Solved in range', 'Calendar submissions (if incomplete)', 'Easy', 'Medium', 'Hard', 'Topics covered', 'Top topic'],
      ...rows.map(({ u, rank, tied, topTopic }) => [
        (tied ? 'T' : '') + rank, u.username, u.solvedInRange, u.incomplete ? u.calendarCount : '',
        u.difficultyCounts.Easy, u.difficultyCounts.Medium, u.difficultyCounts.Hard, u.topics.length, topTopic]),
    ];
    const csv = `# Leaderboard (${METRICS[state.sort].label}) — ${state.rangeText}\n` + lines.map((l) => l.map(q).join(',')).join('\n');
    download(new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' }), `leetcode-leaderboard-${stamp()}.csv`);
  });

  // Image export (drawn on canvas: no external deps, no CORS-tainting avatars)
  $('#img-btn').addEventListener('click', async () => {
    const rows = rankedRows();
    if (!rows.length) return toast('Nothing to export yet');
    await document.fonts?.ready;
    const W = 960, rowH = 56, headH = 150, pad = 36;
    const H = headH + 44 + rows.length * rowH + 60;
    const dpr = 2;
    const c = document.createElement('canvas');
    c.width = W * dpr; c.height = H * dpr;
    const x = c.getContext('2d');
    x.scale(dpr, dpr);
    const F = (w, s) => `${w} ${s}px Inter, system-ui, sans-serif`;

    const bg = x.createLinearGradient(0, 0, W, H);
    bg.addColorStop(0, '#11131c'); bg.addColorStop(1, '#1a1530');
    x.fillStyle = bg; x.fillRect(0, 0, W, H);
    const glow = x.createRadialGradient(120, 0, 0, 120, 0, 420);
    glow.addColorStop(0, 'rgba(255,170,40,0.22)'); glow.addColorStop(1, 'rgba(255,170,40,0)');
    x.fillStyle = glow; x.fillRect(0, 0, W, H);

    x.fillStyle = '#f2f3f8'; x.font = F(800, 34); x.fillText('🏆 LeetCode Leaderboard', pad, 66);
    x.fillStyle = '#9aa0b4'; x.font = F(500, 15);
    x.fillText(state.rangeText, pad, 96);
    x.fillText(`Ranked by ${METRICS[state.sort].label.toLowerCase()}`, pad, 120);

    const cols = [pad, pad + 80, pad + 380, pad + 540, pad + 700];
    x.fillStyle = '#7d8399'; x.font = F(600, 12);
    ['RANK', 'USERNAME', 'SOLVED', 'EASY / MED / HARD', 'TOP TOPIC'].forEach((t, i) => x.fillText(t, cols[i], headH + 20));

    const medal = { 1: ['#ffe27a', '#e6a817'], 2: ['#f1f4f8', '#a9b2c0'], 3: ['#f0b27a', '#b8682e'] };
    rows.forEach(({ u, rank, tied, topTopic }, i) => {
      const y = headH + 44 + i * rowH;
      if (medal[rank]) {
        const g = x.createLinearGradient(pad - 12, 0, W - pad, 0);
        g.addColorStop(0, medal[rank][1] + '40'); g.addColorStop(0.7, 'rgba(0,0,0,0)');
        x.fillStyle = g; roundRect(x, pad - 12, y, W - 2 * pad + 24, rowH - 8, 12); x.fill();
      } else if (i % 2) {
        x.fillStyle = 'rgba(255,255,255,0.03)'; roundRect(x, pad - 12, y, W - 2 * pad + 24, rowH - 8, 12); x.fill();
      }
      const cy = y + (rowH - 8) / 2;
      // rank circle
      x.beginPath(); x.arc(cols[0] + 16, cy, 17, 0, Math.PI * 2);
      if (medal[rank]) {
        const g = x.createLinearGradient(cols[0], cy - 17, cols[0] + 32, cy + 17);
        g.addColorStop(0, medal[rank][0]); g.addColorStop(1, medal[rank][1]); x.fillStyle = g;
      } else x.fillStyle = '#23263a';
      x.fill();
      x.fillStyle = medal[rank] ? '#2a1d00' : '#e6e8f0'; x.font = F(800, 14); x.textAlign = 'center';
      x.fillText((tied ? 'T' : '') + rank, cols[0] + 16, cy + 5); x.textAlign = 'left';

      x.fillStyle = rank === 1 ? '#ffd45c' : '#f2f3f8'; x.font = F(700, 17);
      x.fillText(clip(x, u.username, 280), cols[1], cy + 6);
      x.fillStyle = '#ffb547'; x.font = F(800, 20);
      x.fillText(String(u.solvedInRange) + (u.incomplete ? '*' : ''), cols[2], cy + 7);
      x.font = F(700, 16);
      let cx = cols[3];
      [[u.difficultyCounts.Easy, '#2fd4a7'], [' / ', '#6b7088'], [u.difficultyCounts.Medium, '#fbbf24'], [' / ', '#6b7088'], [u.difficultyCounts.Hard, '#f4566e']]
        .forEach(([t, color]) => { x.fillStyle = color; x.fillText(String(t), cx, cy + 6); cx += x.measureText(String(t)).width; });
      x.fillStyle = '#c9b5ff'; x.font = F(500, 14);
      x.fillText(clip(x, topTopic || '—', W - pad - cols[4]), cols[4], cy + 5);
    });

    x.fillStyle = '#6b7088'; x.font = F(500, 12);
    const foot = rows.some((r) => r.u.incomplete) ? '* list may be incomplete (beyond 20 most recent submissions)  ·  ' : '';
    x.fillText(foot + 'Generated with LCPulse', pad, H - 24);

    c.toBlob((b) => download(b, `leetcode-leaderboard-${stamp()}.png`), 'image/png');
  });

  function roundRect(x, X, Y, w, h, r) {
    x.beginPath(); x.moveTo(X + r, Y); x.arcTo(X + w, Y, X + w, Y + h, r); x.arcTo(X + w, Y + h, X, Y + h, r);
    x.arcTo(X, Y + h, X, Y, r); x.arcTo(X, Y, X + w, Y, r); x.closePath();
  }
  function clip(x, s, max) {
    if (x.measureText(s).width <= max) return s;
    while (s.length && x.measureText(s + '…').width > max) s = s.slice(0, -1);
    return s + '…';
  }
  const stamp = () => new Date().toISOString().slice(0, 10);
  function download(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  function render(results) {
    state.results = results;
    renderLeaderboard();
    const ok = rankedRows().map((r) => r.u);
    const bad = results.filter((u) => u.error);

    els.cards.innerHTML = [...ok.map(card), ...bad.map(errorCard)].join('');
    requestAnimationFrame(() => document.querySelectorAll('.bar > span[data-w]').forEach((s) => (s.style.width = s.dataset.w)));
  }

  function avatar(u, cls = 'avatar') {
    const fallback = `https://ui-avatars.com/api/?background=1e2233&color=f5a524&name=${encodeURIComponent(u.username)}`;
    return `<img class="${cls}" src="${esc(u.avatar || fallback)}" alt="" loading="lazy" onerror="this.src='${fallback}'" />`;
  }

  function card(u) {
    const t = u.totals;
    const all = t.all || 1;
    const total = (k, label) => `
      <div class="total"><div class="label ${k}">${label}</div><div class="val">${t[k] ?? 0}</div>
      <div class="bar"><span class="bg-${k}" style="width:0" data-w="${Math.round(((t[k] || 0) / all) * 100)}%"></span></div></div>`;

    const notice = u.incomplete
      ? `<div class="alert alert-warn" style="margin:0 0 14px"><span>ℹ</span><span>The selected range starts before the 20 most recent accepted submissions (oldest: ${fmtDate(u.recentCoverageFrom)}). The problem list may be incomplete. The calendar shows <b>≈ ${u.calendarCount} submissions</b> in range (UTC days).</span></div>`
      : '';

    return `
      <article class="panel card">
        <div class="card-head">
          ${avatar(u)}
          <div>
            <h3><a href="https://leetcode.com/u/${encodeURIComponent(u.username)}/" target="_blank" rel="noopener">${esc(u.username)}</a></h3>
            <div class="sub">${esc(u.realName || '')}${u.ranking ? ` · Rank ${Number(u.ranking).toLocaleString()}` : ''}</div>
          </div>
          <div class="count"><div class="n">${u.solvedInRange}</div><div class="l">solved in range${u.incomplete ? `<br/><span class="approx">≈ ${u.calendarCount} submissions (calendar)</span>` : ''}</div></div>
        </div>
        ${notice}
        <h4>All-time · ${t.all ?? 0} solved</h4>
        <div class="totals">${total('easy', 'Easy')}${total('medium', 'Medium')}${total('hard', 'Hard')}</div>
        <h4>Topics covered</h4>
        ${u.topics.length ? `<div class="tags">${u.topics.map((x) => `<span class="tag">${esc(x.name)}<b>${x.count}</b></span>`).join('')}</div>` : '<div class="empty">No topics in this range</div>'}
        <h4>Problems solved</h4>
        ${u.problems.length ? `<table class="problems"><tbody>${u.problems.map((p) => `
          <tr>
            <td><a href="${esc(p.link)}" target="_blank" rel="noopener">${p.id ? esc(p.id) + '. ' : ''}${esc(p.title)}</a></td>
            <td><span class="badge ${esc(p.difficulty)}">${esc(p.difficulty)}</span></td>
            <td class="time">${fmtDate(p.solvedAt)}</td>
          </tr>`).join('')}</tbody></table>` : '<div class="empty">No accepted submissions found in this range</div>'}
      </article>`;
  }

  function errorCard(u) {
    const icon = { NOT_FOUND: '🔍', BLOCKED: '🚫', RATE_LIMITED: '⏳', INVALID: '✏️' }[u.errorCode] || '⚠';
    return `
      <article class="panel card error-card">
        <div class="card-head"><div class="avatar" style="display:grid;place-items:center;font-size:1.4rem">${icon}</div>
          <div><h3>${esc(u.username)}</h3><div class="sub err-text">${esc(u.error)}</div></div></div>
      </article>`;
  }

  renderChips();
})();
