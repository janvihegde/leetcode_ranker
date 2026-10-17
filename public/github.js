(() => {
  const $ = (s) => document.querySelector(s);
  const pane = '#tab-github';
  const state = { users: [], results: null, sort: 'commits', rangeText: '', range: null, repo: null };

  const els = {
    form: $('#gh-add-form'), input: $('#gh-user-input'), chips: $('#gh-chips'), count: $('#gh-user-count'),
    clear: $('#gh-clear-btn'), pdf: $('#gh-pdf-input'), drop: $('#gh-dropzone'),
    start: $('#gh-start-input'), end: $('#gh-end-input'), repo: $('#gh-repo-input'), analyze: $('#gh-analyze-btn'),
    alert: $('#gh-global-alert'), tokenAlert: $('#gh-token-alert'), results: $('#gh-results'),
    board: $('#gh-leaderboard tbody'), cards: $('#gh-cards'), rangeLabel: $('#gh-range-label'), toast: $('#toast'),
  };

  const RESERVED = new Set(['orgs', 'topics', 'features', 'settings', 'about', 'pricing', 'marketplace', 'explore', 'login',
    'join', 'sponsors', 'notifications', 'issues', 'pulls', 'search', 'trending', 'collections', 'enterprise', 'apps', 'new']);
  const USER_RE = /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/;
  let tokenOk = true;

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = (n) => (n == null ? '—' : Number(n).toLocaleString());

  function toast(msg, ms = 2800) {
    els.toast.textContent = msg;
    els.toast.hidden = false;
    clearTimeout(toast.t);
    toast.t = setTimeout(() => (els.toast.hidden = true), ms);
  }

  // ---------- Token status ----------
  fetch('/api/github/status').then((r) => r.json()).then((d) => {
    tokenOk = d.tokenConfigured;
    els.tokenAlert.hidden = tokenOk;
    renderChips();
  }).catch(() => {});

  // ---------- Users ----------
  function parseUsername(raw) {
    const s = raw.trim();
    if (!s) return null;
    const m = s.match(/github\.com\/([A-Za-z0-9-]{1,39})(?![A-Za-z0-9-])/i);
    const name = m ? m[1] : s.replace(/^@/, '').replace(/\/+$/, '');
    if (!USER_RE.test(name) || RESERVED.has(name.toLowerCase())) return null;
    return name;
  }
  function addUsers(names) {
    let added = 0;
    for (const n of names) {
      if (!state.users.some((u) => u.toLowerCase() === n.toLowerCase())) { state.users.push(n); added++; }
    }
    renderChips();
    return added;
  }
  function renderChips() {
    els.chips.innerHTML = state.users
      .map((u, i) => `<li class="chip">${esc(u)}<button type="button" data-i="${i}" aria-label="Remove ${esc(u)}">✕</button></li>`).join('');
    const n = state.users.length;
    els.count.textContent = n ? `${n} user${n > 1 ? 's' : ''}` : 'No users added';
    els.clear.hidden = !n;
    els.analyze.disabled = !n || !tokenOk;
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
    const valid = els.input.value.split(/[\s,]+/).filter(Boolean).map(parseUsername).filter(Boolean);
    if (!valid.length) return toast('Enter a valid GitHub username or profile URL');
    if (!addUsers(valid)) toast('Already in the list');
    els.input.value = '';
    els.input.focus();
  });

  // ---------- PDF ----------
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
      const r = await fetch('/api/parse-pdf?type=github', { method: 'POST', body: fd });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Upload failed');
      const added = addUsers(data.usernames);
      toast(data.count ? `Found ${data.count} username(s), ${added} new` : 'No GitHub profile links found in PDF');
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

  // ---------- Range ----------
  const toLocalInput = (d) => {
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
  };
  const presets = () => document.querySelectorAll(`${pane} .preset`);
  function setPreset(days) {
    const end = new Date();
    els.start.value = toLocalInput(new Date(end.getTime() - days * 86400000));
    els.end.value = toLocalInput(end);
    presets().forEach((b) => b.classList.toggle('active', Number(b.dataset.days) === days));
  }
  presets().forEach((b) => b.addEventListener('click', () => setPreset(Number(b.dataset.days))));
  [els.start, els.end].forEach((i) => i.addEventListener('input', () => presets().forEach((b) => b.classList.remove('active'))));
  setPreset(7);

  // ---------- Analyze ----------
  const fmtRange = (s, e) => `${s.toLocaleString()} → ${e.toLocaleString()}`;
  function setLoading(on) {
    els.analyze.disabled = on || !state.users.length || !tokenOk;
    els.analyze.querySelector('.spinner').hidden = !on;
    els.analyze.querySelector('.btn-label').textContent = on ? `Analyzing ${state.users.length} user(s)…` : 'Analyze';
  }
  function showAlert(msg) {
    els.alert.innerHTML = `<span>⚠</span><span>${esc(msg)}</span>`;
    els.alert.hidden = !msg;
  }
  function showSkeleton() {
    els.results.hidden = false;
    els.board.innerHTML = state.users.map(() => `<tr><td colspan="7"><div class="skeleton" style="height:22px"></div></td></tr>`).join('');
    els.cards.innerHTML = state.users.map(() =>
      `<div class="panel card"><div class="skeleton" style="height:48px;margin-bottom:16px"></div><div class="skeleton" style="height:60px;margin-bottom:12px"></div><div class="skeleton" style="height:120px"></div></div>`).join('');
  }

  els.analyze.addEventListener('click', async () => {
    const start = new Date(els.start.value), end = new Date(els.end.value);
    if (isNaN(start) || isNaN(end)) return toast('Please choose a valid start and end');
    if (start >= end) return toast('Start must be before end');
    showAlert('');
    setLoading(true);
    showSkeleton();
    state.range = { start, end };
    try {
      const r = await fetch('/api/github/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ usernames: state.users, start: start.toISOString(), end: end.toISOString(), repo: els.repo.value.trim() }),
      });
      let data;
      try { data = await r.json(); } catch { throw new Error(`Server returned an invalid response (HTTP ${r.status}).`); }
      if (!r.ok) {
        if (data.code === 'NO_TOKEN') { tokenOk = false; els.tokenAlert.hidden = false; }
        throw new Error(data.error || `Request failed (HTTP ${r.status})`);
      }
      state.repo = data.repo;
      state.rangeText = fmtRange(start, end) + (data.repo ? `  ·  repo: ${data.repo}` : '');
      els.rangeLabel.textContent = state.rangeText;
      if (data.globalError) showAlert(data.globalError.message);
      render(data.results);
    } catch (e) {
      showAlert(e.message || 'Something went wrong');
      els.results.hidden = true;
    } finally {
      setLoading(false);
    }
  });

  // ---------- Ranking ----------
  const METRICS = {
    commits: { label: 'Commits', val: (u) => u.commits, tie: (u) => u.additions },
    additions: { label: 'Lines added', val: (u) => u.additions, tie: (u) => u.commits },
    prs: { label: 'Pull requests', val: (u) => u.prs, tie: (u) => u.commits },
  };
  function rankedRows() {
    if (!state.results) return [];
    const m = METRICS[state.sort];
    const ok = state.results.filter((u) => !u.error)
      .sort((a, b) => m.val(b) - m.val(a) || m.tie(b) - m.tie(a) || a.username.localeCompare(b.username));
    let prev = null, rank = 0;
    const rows = ok.map((u, i) => {
      const v = m.val(u);
      if (v !== prev) { rank = i + 1; prev = v; }
      return { u, rank };
    });
    return rows.map((r) => ({ ...r, tied: rows.filter((x) => x.rank === r.rank).length > 1 }));
  }

  function renderLeaderboard() {
    const rows = rankedRows();
    const bad = (state.results || []).filter((u) => u.error);
    const hl = (k) => (state.sort === k ? 'metric-hl' : '');
    els.board.innerHTML =
      rows.map(({ u, rank, tied }) => `
        <tr class="${rank <= 3 ? 'podium-' + rank : ''}">
          <td><span class="rank-badge">${tied ? 'T' : ''}${rank}</span></td>
          <td><div class="user-cell"><img class="avatar" src="${esc(u.avatar)}" alt="" loading="lazy" /><a href="${esc(u.url)}" target="_blank" rel="noopener">${esc(u.username)}</a></div></td>
          <td class="${hl('commits')}"><span class="big-num">${num(u.commits)}</span></td>
          <td class="add ${hl('additions')}">+${num(u.additions)}</td>
          <td class="del">−${num(u.deletions)}</td>
          <td class="hide-sm ${hl('prs')}">${num(u.prs)}</td>
          <td class="hide-sm">${u.topRepo ? `<span class="tag">${esc(u.topRepo)}</span>` : '<span class="muted">—</span>'}</td>
        </tr>`).join('') +
      bad.map((u) => `<tr><td><span class="rank-badge">—</span></td><td>${esc(u.username)}</td><td colspan="5" class="err-text">${esc(u.error)}</td></tr>`).join('');
  }

  document.querySelectorAll(`${pane} .seg`).forEach((b) => b.addEventListener('click', () => {
    state.sort = b.dataset.sort;
    document.querySelectorAll(`${pane} .seg`).forEach((x) => x.classList.toggle('active', x === b));
    renderLeaderboard();
  }));

  // ---------- Cards ----------
  function chart(days) {
    if (!state.range) return '';
    const s = new Date(Date.UTC(state.range.start.getUTCFullYear(), state.range.start.getUTCMonth(), state.range.start.getUTCDate()));
    const e = state.range.end;
    const list = [];
    for (let d = new Date(s); d <= e; d.setUTCDate(d.getUTCDate() + 1)) {
      const k = d.toISOString().slice(0, 10);
      list.push({ k, v: days[k] || 0 });
    }
    // Bucket by week if the range is long
    let bars = list, unit = 'day';
    if (list.length > 62) {
      unit = 'week';
      bars = [];
      for (let i = 0; i < list.length; i += 7) {
        const chunk = list.slice(i, i + 7);
        bars.push({ k: chunk[0].k, v: chunk.reduce((a, b) => a + b.v, 0) });
      }
    }
    const max = Math.max(1, ...bars.map((b) => b.v));
    const W = 500, H = 90, gap = bars.length > 40 ? 1 : 3, bw = (W - gap * (bars.length - 1)) / bars.length;
    const rects = bars.map((b, i) => {
      const h = b.v ? Math.max(3, (b.v / max) * (H - 4)) : 2;
      return `<rect x="${(i * (bw + gap)).toFixed(2)}" y="${(H - h).toFixed(2)}" width="${bw.toFixed(2)}" height="${h.toFixed(2)}" rx="${Math.min(3, bw / 2).toFixed(1)}" fill="${b.v ? 'hsl(36 100% 58%)' : 'hsla(230,30%,60%,0.18)'}"><title>${unit === 'week' ? 'Week of ' : ''}${b.k}: ${b.v} commit${b.v === 1 ? '' : 's'}</title></rect>`;
    }).join('');
    return `<svg class="chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Commits per ${unit}">${rects}</svg>
      <div class="chart-axis"><span>${bars[0]?.k || ''}</span><span>max ${max}/${unit}</span><span>${bars[bars.length - 1]?.k || ''}</span></div>`;
  }

  function card(u) {
    const net = u.net;
    const stat = (label, val, cls = '') => `<div class="stat"><div class="label">${label}</div><div class="val ${cls}">${val}</div></div>`;
    const repoRows = u.repos.map((r) => `
      <tr>
        <td><a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.repo)}</a>${r.error ? `<div class="err-text" style="font-size:.75rem">${esc(r.error)}</div>` : ''}</td>
        <td class="num">${num(r.commits)}</td>
        <td class="num add">${r.additions == null ? '<span class="muted">—</span>' : '+' + num(r.additions)}</td>
        <td class="num del">${r.deletions == null ? '<span class="muted">—</span>' : '−' + num(r.deletions)}</td>
      </tr>`).join('');
    return `
      <article class="panel card">
        <div class="card-head">
          <img class="avatar" src="${esc(u.avatar)}" alt="" loading="lazy" />
          <div>
            <h3><a href="${esc(u.url)}" target="_blank" rel="noopener">${esc(u.username)}</a></h3>
            <div class="sub">${esc(u.name)}${u.issues ? ` · ${u.issues} issues` : ''}${u.reviews ? ` · ${u.reviews} reviews` : ''}</div>
          </div>
          <div class="count"><div class="n">${num(u.commits)}</div><div class="l">commits${u.repoFilter ? ' in repo' : ' in range'}</div></div>
        </div>
        <div class="stat-grid">
          ${stat('Commits', num(u.commits))}
          ${stat('Added', '+' + num(u.additions), 'add')}
          ${stat('Removed', '−' + num(u.deletions), 'del')}
          ${stat('Net', (net >= 0 ? '+' : '−') + num(Math.abs(net)), net >= 0 ? 'add' : 'del')}
          ${stat('PRs opened', num(u.prs))}
        </div>
        <h4>Commits per day</h4>
        ${chart(u.days)}
        <h4>Repositories</h4>
        ${u.repos.length ? `<table class="problems"><thead><tr><td class="muted">Repo</td><td class="num muted">Commits</td><td class="num muted">Added</td><td class="num muted">Removed</td></tr></thead><tbody>${repoRows}</tbody></table>`
          : '<div class="empty">No commit activity in this range</div>'}
        ${u.restricted ? `<div class="note">🔒 ${num(u.restricted)} private contributions not shown.</div>` : ''}
        ${u.notes.map((n) => `<div class="note">ℹ ${esc(n)}</div>`).join('')}
      </article>`;
  }

  function errorCard(u) {
    const icon = { NOT_FOUND: '🔍', RATE_LIMITED: '⏳', TOKEN_INVALID: '🔑', NO_TOKEN: '🔑', REPO_NOT_FOUND: '📁', INVALID: '✏️' }[u.errorCode] || '⚠';
    return `<article class="panel card error-card"><div class="card-head"><div class="avatar" style="display:grid;place-items:center;font-size:1.4rem">${icon}</div>
      <div><h3>${esc(u.username)}</h3><div class="sub err-text">${esc(u.error)}</div></div></div></article>`;
  }

  function render(results) {
    state.results = results;
    renderLeaderboard();
    els.cards.innerHTML = [...rankedRows().map((r) => card(r.u)), ...results.filter((u) => u.error).map(errorCard)].join('');
  }

  // ---------- Exports ----------
  const stamp = () => new Date().toISOString().slice(0, 10);
  function download(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  $('#gh-csv-btn').addEventListener('click', () => {
    const rows = rankedRows();
    if (!rows.length) return toast('Nothing to export yet');
    const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = [
      ['Rank', 'Username', 'Commits', 'Lines added', 'Lines removed', 'Net lines', 'PRs opened', 'Issues', 'Top repo'],
      ...rows.map(({ u, rank, tied }) => [(tied ? 'T' : '') + rank, u.username, u.commits, u.additions, u.deletions, u.net, u.prs, u.issues, u.topRepo]),
    ];
    const csv = `# GitHub leaderboard (${METRICS[state.sort].label}) — ${state.rangeText}\n` + lines.map((l) => l.map(q).join(',')).join('\n');
    download(new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' }), `github-leaderboard-${stamp()}.csv`);
  });

  $('#gh-img-btn').addEventListener('click', async () => {
    const rows = rankedRows();
    if (!rows.length) return toast('Nothing to export yet');
    await document.fonts?.ready;
    const W = 1000, rowH = 56, headH = 150, pad = 36;
    const H = headH + 44 + rows.length * rowH + 60;
    const c = document.createElement('canvas');
    c.width = W * 2; c.height = H * 2;
    const x = c.getContext('2d');
    x.scale(2, 2);
    const F = (w, s) => `${w} ${s}px Inter, system-ui, sans-serif`;
    const bg = x.createLinearGradient(0, 0, W, H);
    bg.addColorStop(0, '#11131c'); bg.addColorStop(1, '#1a1530');
    x.fillStyle = bg; x.fillRect(0, 0, W, H);
    const glow = x.createRadialGradient(120, 0, 0, 120, 0, 420);
    glow.addColorStop(0, 'rgba(255,170,40,0.22)'); glow.addColorStop(1, 'rgba(255,170,40,0)');
    x.fillStyle = glow; x.fillRect(0, 0, W, H);

    x.fillStyle = '#f2f3f8'; x.font = F(800, 34); x.fillText('🏆 GitHub Leaderboard', pad, 66);
    x.fillStyle = '#9aa0b4'; x.font = F(500, 15);
    x.fillText(clip(x, state.rangeText, W - 2 * pad), pad, 96);
    x.fillText(`Ranked by ${METRICS[state.sort].label.toLowerCase()}`, pad, 120);

    const cols = [pad, pad + 70, pad + 330, pad + 440, pad + 570, pad + 700];
    x.fillStyle = '#7d8399'; x.font = F(600, 12);
    ['RANK', 'USERNAME', 'COMMITS', '+LINES', '−LINES', 'TOP REPO'].forEach((t, i) => x.fillText(t, cols[i], headH + 20));

    const medal = { 1: ['#ffe27a', '#e6a817'], 2: ['#f1f4f8', '#a9b2c0'], 3: ['#f0b27a', '#b8682e'] };
    rows.forEach(({ u, rank, tied }, i) => {
      const y = headH + 44 + i * rowH;
      if (medal[rank]) {
        const g = x.createLinearGradient(pad - 12, 0, W - pad, 0);
        g.addColorStop(0, medal[rank][1] + '40'); g.addColorStop(0.7, 'rgba(0,0,0,0)');
        x.fillStyle = g; roundRect(x, pad - 12, y, W - 2 * pad + 24, rowH - 8, 12); x.fill();
      } else if (i % 2) {
        x.fillStyle = 'rgba(255,255,255,0.03)'; roundRect(x, pad - 12, y, W - 2 * pad + 24, rowH - 8, 12); x.fill();
      }
      const cy = y + (rowH - 8) / 2;
      x.beginPath(); x.arc(cols[0] + 16, cy, 17, 0, Math.PI * 2);
      if (medal[rank]) {
        const g = x.createLinearGradient(cols[0], cy - 17, cols[0] + 32, cy + 17);
        g.addColorStop(0, medal[rank][0]); g.addColorStop(1, medal[rank][1]); x.fillStyle = g;
      } else x.fillStyle = '#23263a';
      x.fill();
      x.fillStyle = medal[rank] ? '#2a1d00' : '#e6e8f0'; x.font = F(800, 14); x.textAlign = 'center';
      x.fillText((tied ? 'T' : '') + rank, cols[0] + 16, cy + 5); x.textAlign = 'left';
      x.fillStyle = rank === 1 ? '#ffd45c' : '#f2f3f8'; x.font = F(700, 17);
      x.fillText(clip(x, u.username, 240), cols[1], cy + 6);
      x.fillStyle = '#ffb547'; x.font = F(800, 20); x.fillText(num(u.commits), cols[2], cy + 7);
      x.font = F(700, 16);
      x.fillStyle = '#2fd4a7'; x.fillText('+' + num(u.additions), cols[3], cy + 6);
      x.fillStyle = '#f4566e'; x.fillText('−' + num(u.deletions), cols[4], cy + 6);
      x.fillStyle = '#c9b5ff'; x.font = F(500, 14);
      x.fillText(clip(x, u.topRepo || '—', W - pad - cols[5]), cols[5], cy + 5);
    });
    x.fillStyle = '#6b7088'; x.font = F(500, 12);
    x.fillText('Lines counted on default branches of each user\'s top repos  ·  Generated with LCPulse', pad, H - 24);
    c.toBlob((b) => download(b, `github-leaderboard-${stamp()}.png`), 'image/png');
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

  renderChips();
})();
