(() => {
  const $ = (s) => document.querySelector(s);
  const STORE_KEY = 'lcpulse.leetcode.people.v1';
  const state = { people: [], results: null, sort: 'total', rangeText: '', range: null };

  const els = {
    form: $('#add-form'), nameInput: $('#name-input'), input: $('#user-input'), chips: $('#chips'), count: $('#user-count'),
    clear: $('#clear-btn'), pdf: $('#pdf-input'), drop: $('#dropzone'),
    start: $('#start-input'), end: $('#end-input'), analyze: $('#analyze-btn'),
    alert: $('#global-alert'), results: $('#results'), board: $('#leaderboard tbody'),
    cards: $('#cards'), rangeLabel: $('#range-label'), toast: $('#toast'),
    modal: $('#review-modal'), modalTitle: $('#review-title'), modalHint: $('#review-hint'),
    modalBody: $('#review-rows'), modalAdd: $('#review-add'), modalOk: $('#review-confirm'), modalCancel: $('#review-cancel'),
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
    const s = String(raw || '').trim();
    if (!s) return null;
    const m = s.match(/leetcode\.(?:com|cn)\/(?:u\/)?([A-Za-z0-9_-]+)/i);
    const name = m ? m[1] : s.replace(/^@/, '').replace(/\/+$/, '');
    if (!/^[A-Za-z0-9_-]{1,40}$/.test(name) || RESERVED.has(name.toLowerCase())) return null;
    return name;
  }

  // ---------- People list (name ↔ username), persisted ----------
  function load() {
    try {
      const data = JSON.parse(localStorage.getItem(STORE_KEY) || '[]');
      if (Array.isArray(data)) state.people = data.filter((p) => p && typeof p.username === 'string').map((p) => ({ name: String(p.name || ''), username: p.username }));
    } catch { state.people = []; }
  }
  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state.people)); } catch { /* storage full / disabled */ }
  }
  const findIdx = (username) => state.people.findIndex((p) => p.username.toLowerCase() === String(username).toLowerCase());
  const nameFor = (username) => state.people[findIdx(username)]?.name || '';
  /** On-screen label: name, falling back to the username. */
  const labelFor = (username) => nameFor(username) || username;

  /** Merge pairs into the list. Existing usernames get their name updated if a new one is given. */
  function upsert(pairs) {
    let added = 0, updated = 0;
    for (const { name, username } of pairs) {
      const i = findIdx(username);
      if (i === -1) { state.people.push({ name: name.trim(), username }); added++; }
      else if (name.trim() && state.people[i].name !== name.trim()) { state.people[i].name = name.trim(); updated++; }
    }
    save();
    renderChips();
    return { added, updated };
  }

  function renderChips() {
    els.chips.innerHTML = state.people
      .map((p, i) => `<li class="chip chip-person">
          <button type="button" class="chip-edit" data-edit="${i}" title="Edit">${p.name ? `${esc(p.name)} <span class="muted">(${esc(p.username)})</span>` : `<span class="muted">Unnamed</span> (${esc(p.username)})`}</button>
          <button type="button" data-i="${i}" aria-label="Remove ${esc(p.name || p.username)}">✕</button></li>`)
      .join('');
    const n = state.people.length;
    els.count.textContent = n ? `${n} ${n > 1 ? 'people' : 'person'}` : 'No users added';
    els.clear.hidden = !n;
    els.analyze.disabled = !n;
  }

  els.chips.addEventListener('click', (e) => {
    const rm = e.target.closest('button[data-i]');
    if (rm) {
      state.people.splice(Number(rm.dataset.i), 1);
      save();
      return renderChips();
    }
    const ed = e.target.closest('button[data-edit]');
    if (ed) {
      const i = Number(ed.dataset.edit);
      openReview([state.people[i]], {
        title: 'Edit person', hint: 'Change the name or LeetCode username.', allowAdd: false,
        onConfirm: (pairs) => {
          if (!pairs.length) { state.people.splice(i, 1); }
          else {
            const p = pairs[0];
            const dup = findIdx(p.username);
            if (dup !== -1 && dup !== i) { toast('That username is already in the list'); return false; }
            state.people[i] = { name: p.name.trim(), username: p.username };
          }
          save(); renderChips();
        },
      });
    }
  });
  els.clear.addEventListener('click', () => {
    if (state.people.length && !confirm(`Remove all ${state.people.length} people from the list?`)) return;
    state.people = []; save(); renderChips();
  });

  els.form.addEventListener('submit', (e) => {
    e.preventDefault();
    const username = parseUsername(els.input.value);
    if (!username) return toast('Enter a valid LeetCode username or profile link');
    const { added, updated } = upsert([{ name: els.nameInput.value, username }]);
    if (!added && !updated) toast('Already in the list');
    else if (updated) toast('Name updated');
    els.input.value = '';
    els.nameInput.value = '';
    els.nameInput.focus();
  });

  // ---------- Review modal ----------
  let reviewOpts = null;
  function rowHtml(p = { name: '', username: '' }) {
    return `<tr>
      <td><input type="text" class="rv-name" value="${esc(p.name)}" placeholder="Name (optional)" aria-label="Name" /></td>
      <td><input type="text" class="rv-user" value="${esc(p.username)}" placeholder="username or profile link" aria-label="LeetCode username" /></td>
      <td><button type="button" class="icon-btn rv-del" aria-label="Delete row">✕</button></td></tr>`;
  }
  function openReview(pairs, opts) {
    reviewOpts = opts;
    els.modalTitle.textContent = opts.title;
    els.modalHint.textContent = opts.hint || '';
    els.modalAdd.hidden = opts.allowAdd === false;
    els.modalBody.innerHTML = (pairs.length ? pairs : [{ name: '', username: '' }]).map(rowHtml).join('');
    els.modal.hidden = false;
    document.body.classList.add('modal-open');
    (els.modalBody.querySelector('.rv-name:placeholder-shown') || els.modalBody.querySelector('input'))?.focus();
  }
  function closeReview() {
    els.modal.hidden = true;
    document.body.classList.remove('modal-open');
    reviewOpts = null;
  }
  els.modalBody.addEventListener('click', (e) => {
    const del = e.target.closest('.rv-del');
    if (del) del.closest('tr').remove();
  });
  els.modalAdd.addEventListener('click', () => {
    els.modalBody.insertAdjacentHTML('beforeend', rowHtml());
    els.modalBody.querySelector('tr:last-child .rv-name').focus();
  });
  els.modalCancel.addEventListener('click', closeReview);
  els.modal.addEventListener('click', (e) => { if (e.target === els.modal) closeReview(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !els.modal.hidden) closeReview(); });
  els.modalOk.addEventListener('click', () => {
    const pairs = [];
    let bad = 0;
    const seen = new Set();
    for (const tr of els.modalBody.querySelectorAll('tr')) {
      const name = tr.querySelector('.rv-name').value.trim();
      const rawUser = tr.querySelector('.rv-user').value.trim();
      tr.classList.remove('rv-invalid');
      if (!name && !rawUser) continue; // empty row
      const username = parseUsername(rawUser);
      if (!username) { tr.classList.add('rv-invalid'); bad++; continue; }
      if (seen.has(username.toLowerCase())) continue;
      seen.add(username.toLowerCase());
      pairs.push({ name, username });
    }
    if (bad) return toast(`${bad} row(s) have an invalid username. Fix or delete them.`);
    if (reviewOpts.onConfirm(pairs) === false) return;
    closeReview();
  });

  // ---------- File import (PDF via server, CSV in browser) ----------
  function parseCsv(text) {
    const rows = [];
    let row = [], cell = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) {
        if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
        else if (c === '"') q = false;
        else cell += c;
      } else if (c === '"') q = true;
      else if (c === ',' || c === ';' || c === '\t') { row.push(cell); cell = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(cell); rows.push(row); row = []; cell = '';
      } else cell += c;
    }
    if (cell || row.length) { row.push(cell); rows.push(row); }
    return rows.map((r) => r.map((c) => c.trim())).filter((r) => r.some(Boolean));
  }
  function pairsFromCsv(text) {
    const rows = parseCsv(text.replace(/^\ufeff/, ''));
    if (!rows.length) return [];
    const header = rows[0].map((h) => h.toLowerCase());
    let ni = header.findIndex((h) => /^(name|full ?name|student|person)$/.test(h));
    let ui = header.findIndex((h) => /(user ?name|leetcode|profile|link|url|handle)/.test(h));
    let body = rows.slice(1);
    if (ni === -1 && ui === -1) { ni = 0; ui = 1; body = rows; } // no header row
    if (ui === -1) ui = ni === 0 ? 1 : 0;
    return body.map((r) => ({ name: ni === -1 ? '' : r[ni] || '', username: r[ui] || '' }))
      .filter((p) => p.username || p.name)
      .map((p) => ({ name: p.name, username: parseUsername(p.username) || p.username }));
  }

  async function importFile(file) {
    if (!file) return;
    const isCsv = /\.csv$/i.test(file.name) || /csv/.test(file.type);
    const isPdf = /\.pdf$/i.test(file.name) || file.type === 'application/pdf';
    if (!isCsv && !isPdf) return toast('Please choose a PDF or CSV file');
    els.drop.classList.add('loading');
    const txt = els.drop.querySelector('.dz-text');
    const old = txt.innerHTML;
    txt.textContent = `Reading ${file.name}…`;
    try {
      let pairs;
      if (isCsv) {
        pairs = pairsFromCsv(await file.text());
      } else {
        const fd = new FormData();
        fd.append('file', file);
        const r = await fetch('/api/parse-pdf', { method: 'POST', body: fd });
        const data = await r.json();
        if (!r.ok) throw new Error(data.error || 'Upload failed');
        pairs = data.pairs || (data.usernames || []).map((u) => ({ name: '', username: u }));
      }
      if (!pairs.length) return toast(`No LeetCode profiles found in ${file.name}`, 4000);
      const unnamed = pairs.filter((p) => !p.name).length;
      openReview(pairs, {
        title: `Review ${pairs.length} detected ${pairs.length === 1 ? 'person' : 'people'}`,
        hint: `From ${file.name}. Edit names or usernames, delete wrong rows, or add missing ones.${unnamed ? ` ${unnamed} without a name.` : ''}`,
        onConfirm: (ok) => {
          const { added, updated } = upsert(ok);
          toast(`Added ${added}${updated ? `, updated ${updated}` : ''}`);
        },
      });
    } catch (e) {
      toast('⚠ ' + e.message, 4000);
    } finally {
      els.drop.classList.remove('loading');
      txt.innerHTML = old;
      els.pdf.value = '';
    }
  }
  els.pdf.addEventListener('change', () => importFile(els.pdf.files[0]));
  ['dragenter', 'dragover'].forEach((ev) => els.drop.addEventListener(ev, (e) => { e.preventDefault(); els.drop.classList.add('drag'); }));
  ['dragleave', 'drop'].forEach((ev) => els.drop.addEventListener(ev, (e) => { e.preventDefault(); els.drop.classList.remove('drag'); }));
  els.drop.addEventListener('drop', (e) => importFile(e.dataTransfer.files[0]));

  // ---------- Time range ----------
  const toLocalInput = (d) => {
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
  };
  const presets = () => document.querySelectorAll('#tab-leetcode .preset');
  function setPreset(days) {
    const end = new Date();
    const start = new Date(end.getTime() - days * 86400000);
    els.start.value = toLocalInput(start);
    els.end.value = toLocalInput(end);
    presets().forEach((b) => b.classList.toggle('active', Number(b.dataset.days) === days));
  }
  presets().forEach((b) => b.addEventListener('click', () => setPreset(Number(b.dataset.days))));
  [els.start, els.end].forEach((i) => i.addEventListener('input', () => presets().forEach((b) => b.classList.remove('active'))));
  setPreset(7);

  // ---------- Analyze ----------
  const fmtDate = (sec) => new Date(sec * 1000).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  const fmtRange = (s, e) => {
    const o = { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' };
    return `${s.toLocaleString(undefined, o)} → ${e.toLocaleString(undefined, o)}`;
  };
  const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const rangeSlug = () => (state.range ? `${ymd(state.range.start)}_to_${ymd(state.range.end)}` : ymd(new Date()));

  function setLoading(on) {
    els.analyze.disabled = on || !state.people.length;
    els.analyze.querySelector('.spinner').hidden = !on;
    els.analyze.querySelector('.btn-label').textContent = on ? `Analyzing ${state.people.length} ${state.people.length === 1 ? 'person' : 'people'}…` : 'Analyze';
  }

  function showSkeleton() {
    els.results.hidden = false;
    els.board.innerHTML = state.people.map(() => `<tr><td colspan="5"><div class="skeleton" style="height:22px"></div></td></tr>`).join('');
    els.cards.innerHTML = state.people
      .map(() => `<div class="panel card"><div class="skeleton" style="height:48px;margin-bottom:16px"></div><div class="skeleton" style="height:60px;margin-bottom:12px"></div><div class="skeleton" style="height:120px"></div></div>`)
      .join('');
  }

  /** Error banner: only visible when there is at least one real message. */
  function showAlert(messages) {
    const list = (Array.isArray(messages) ? messages : [messages]).filter((m) => m && String(m).trim());
    if (!list.length) {
      els.alert.hidden = true;
      els.alert.innerHTML = '';
      return;
    }
    els.alert.innerHTML = `<span>⚠</span><div>${list.map((m) => `<div>${esc(m)}</div>`).join('')}</div>`;
    els.alert.hidden = false;
  }

  els.analyze.addEventListener('click', async () => {
    const start = new Date(els.start.value);
    const end = new Date(els.end.value);
    if (isNaN(start) || isNaN(end)) return toast('Please choose a valid start and end');
    if (start >= end) return toast('Start must be before end');
    if (!state.people.length) return toast('Add at least one person');

    showAlert(null);
    setLoading(true);
    showSkeleton();
    state.range = { start, end };
    state.rangeText = fmtRange(start, end);
    els.rangeLabel.textContent = state.rangeText;
    try {
      const r = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ usernames: state.people.map((p) => p.username), start: start.toISOString(), end: end.toISOString() }),
      });
      let data;
      try { data = await r.json(); } catch { throw new Error(`Server returned an invalid response (HTTP ${r.status}).`); }
      if (!r.ok) throw new Error(data.error || `Request failed (HTTP ${r.status})`);
      render(data.results);
      const failed = data.results.filter((u) => u.error);
      const msgs = [];
      if (data.globalError) msgs.push(data.globalError.message);
      for (const u of failed) {
        if (data.globalError && u.error === data.globalError.message) continue; // already summarised
        msgs.push(`${labelFor(u.username)}: ${u.error}`);
      }
      if (data.globalError && failed.length) msgs.push(`Affected: ${failed.filter((u) => u.error === data.globalError.message).map((u) => labelFor(u.username)).join(', ')}`);
      showAlert(msgs);
    } catch (e) {
      showAlert(e.message || 'Something went wrong');
      els.results.hidden = true;
    } finally {
      setLoading(false);
    }
  });


  // Ranking metrics. Ties share a rank (1,1,3…); inside a tie we sort by hard solved.
  // "Problems solved" ranks by the unique count shown in the table/exports (not the calendar estimate).
  const METRICS = {
    total: { label: 'Problems solved', val: (u) => u.solvedInRange, tie: (u) => u.difficultyCounts.Hard },
    hard: { label: 'Hard solved', val: (u) => u.difficultyCounts.Hard, tie: (u) => u.solvedInRange },
    topics: { label: 'Topics covered', val: (u) => u.topics.length, tie: (u) => u.difficultyCounts.Hard },
  };

  function rankedRows() {
    if (!state.results) return [];
    const m = METRICS[state.sort];
    const ok = state.results.filter((u) => !u.error).sort((a, b) =>
      m.val(b) - m.val(a) || m.tie(b) - m.tie(a) || labelFor(a.username).localeCompare(labelFor(b.username)));
    let prev = null, rank = 0;
    return ok.map((u, i) => {
      const v = m.val(u);
      if (v !== prev) { rank = i + 1; prev = v; }
      return { u, rank, value: v, name: nameFor(u.username), topTopic: u.topics[0]?.name || '' };
    }).map((r, _, arr) => ({ ...r, tied: arr.filter((x) => x.rank === r.rank).length > 1 }));
  }

  const profileUrl = (username) => `https://leetcode.com/u/${encodeURIComponent(username)}/`;
  function nameCell(username) {
    const name = nameFor(username);
    return `<div class="name-cell">
      <span class="person-name">${name ? esc(name) : '<span class="muted">Unnamed</span>'}</span>
      <a class="person-user" href="${profileUrl(username)}" target="_blank" rel="noopener">@${esc(username)}</a></div>`;
  }

  function renderLeaderboard() {
    const rows = rankedRows();
    const bad = (state.results || []).filter((u) => u.error);
    const col = { total: 2, hard: 3, topics: 4 }[state.sort];
    els.board.innerHTML =
      rows.map(({ u, rank, tied, topTopic }) => `
        <tr class="${rank <= 3 ? 'podium-' + rank : ''}">
          <td><span class="rank-badge" title="${tied ? 'Tied' : ''}">${tied ? 'T' : ''}${rank}</span></td>
          <td><div class="user-cell">${avatar(u)}${nameCell(u.username)}</div></td>
          <td class="${col === 2 ? 'metric-hl' : ''}"><span class="big-num">${u.solvedInRange}</span>
            ${u.incomplete ? `<span class="approx">≈ ${u.calendarCount} submissions (calendar)</span>` : ''}</td>
          <td class="split ${col === 3 ? 'metric-hl' : ''}"><span class="easy">${u.difficultyCounts.Easy}</span> / <span class="medium">${u.difficultyCounts.Medium}</span> / <span class="hard"><b>${u.difficultyCounts.Hard}</b></span></td>
          <td class="hide-sm ${col === 4 ? 'metric-hl' : ''}">${topTopic ? `<span class="tag">${esc(topTopic)}</span>` : '<span class="muted">—</span>'}
            ${state.sort === 'topics' ? `<span class="muted"> · ${u.topics.length} topics</span>` : ''}</td>
        </tr>`).join('') +
      bad.map((u) => `
        <tr><td><span class="rank-badge">—</span></td><td>${nameCell(u.username)}</td><td colspan="3" class="err-text">${esc(u.error)}</td></tr>`).join('');
  }

  document.querySelectorAll('#tab-leetcode .seg').forEach((b) => b.addEventListener('click', () => {
    state.sort = b.dataset.sort;
    document.querySelectorAll('#tab-leetcode .seg').forEach((x) => x.classList.toggle('active', x === b));
    renderLeaderboard();
  }));

  // ---------- Exports (names only, never usernames/links) ----------
  const exportName = (r) => r.name || 'Unnamed';

  $('#csv-btn').addEventListener('click', () => {
    const rows = rankedRows();
    if (!rows.length) return toast('Nothing to export yet');
    const q = (v) => `"${String(v).replace(/"/g, '""')}"`;
    const lines = [
      ['Rank', 'Name', 'Solved in range', 'Easy', 'Medium', 'Hard', 'Top topic'],
      ...rows.map((r) => [
        (r.tied ? 'T' : '') + r.rank, exportName(r), r.u.solvedInRange,
        r.u.difficultyCounts.Easy, r.u.difficultyCounts.Medium, r.u.difficultyCounts.Hard, r.topTopic]),
    ];
    const csv = lines.map((l) => l.map(q).join(',')).join('\r\n');
    download(new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' }), `leetcode-leaderboard_${rangeSlug()}.csv`);
  });

  // Image export (drawn on canvas: no external deps, no avatars or usernames)
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

    x.fillStyle = '#f2f3f8'; x.font = F(800, 30);
    x.fillText('🏆 LeetCode Leaderboard', pad, 62);
    x.fillStyle = '#ffb547'; x.font = F(700, 17);
    x.fillText(clip(x, state.rangeText, W - 2 * pad), pad, 94);
    x.fillStyle = '#9aa0b4'; x.font = F(500, 14);
    x.fillText(`Ranked by ${METRICS[state.sort].label.toLowerCase()}`, pad, 120);

    const cols = [pad, pad + 80, pad + 400, pad + 540, pad + 710];
    x.fillStyle = '#7d8399'; x.font = F(600, 12);
    ['RANK', 'NAME', 'SOLVED', 'EASY / MED / HARD', 'TOP TOPIC'].forEach((t, i) => x.fillText(t, cols[i], headH + 20));

    const medal = { 1: ['#ffe27a', '#e6a817'], 2: ['#f1f4f8', '#a9b2c0'], 3: ['#f0b27a', '#b8682e'] };
    rows.forEach((r, i) => {
      const { u, rank, tied, topTopic } = r;
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

      x.fillStyle = !r.name ? '#7d8399' : rank === 1 ? '#ffd45c' : '#f2f3f8'; x.font = F(700, 17);
      x.fillText(clip(x, exportName(r), cols[2] - cols[1] - 20), cols[1], cy + 6);
      x.fillStyle = '#ffb547'; x.font = F(800, 20);
      x.fillText(String(u.solvedInRange) + (u.incomplete ? '*' : ''), cols[2], cy + 7);
      x.font = F(700, 16);
      let cx = cols[3];
      [[u.difficultyCounts.Easy, '#2fd4a7'], [' / ', '#6b7088'], [u.difficultyCounts.Medium, '#fbbf24'], [' / ', '#6b7088'], [u.difficultyCounts.Hard, '#f4566e']]
        .forEach(([t, color]) => { x.fillStyle = color; x.fillText(String(t), cx, cy + 6); cx += x.measureText(String(t)).width; });
      x.fillStyle = '#c9b5ff'; x.font = F(500, 14);
      x.fillText(clip(x, topTopic || '—', W - pad - cols[4]), cols[4], cy + 5);
    });

    if (rows.some((r) => r.u.incomplete)) {
      x.fillStyle = '#6b7088'; x.font = F(500, 12);
      x.fillText('* list may be incomplete (range goes beyond the 20 most recent accepted submissions)', pad, H - 24);
    }

    c.toBlob((b) => download(b, `leetcode-leaderboard_${rangeSlug()}.png`), 'image/png');
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
  function download(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  // ---------- Cards ----------
  function render(results) {
    state.results = results;
    renderLeaderboard();
    const ok = rankedRows().map((r) => r.u);
    const bad = results.filter((u) => u.error);

    els.cards.innerHTML = [...ok.map(card), ...bad.map(errorCard)].join('');
    requestAnimationFrame(() => document.querySelectorAll('#tab-leetcode .bar > span[data-w]').forEach((s) => (s.style.width = s.dataset.w)));
  }

  function avatar(u, cls = 'avatar') {
    const fallback = `https://ui-avatars.com/api/?background=1e2233&color=f5a524&name=${encodeURIComponent(labelFor(u.username))}`;
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
    const name = nameFor(u.username);

    return `
      <article class="panel card">
        <div class="card-head">
          ${avatar(u)}
          <div>
            <h3>${name ? esc(name) : '<span class="muted">Unnamed</span>'}</h3>
            <div class="sub"><a href="${profileUrl(u.username)}" target="_blank" rel="noopener">@${esc(u.username)}</a>${u.ranking ? ` · Rank ${Number(u.ranking).toLocaleString()}` : ''}</div>
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
    const name = nameFor(u.username);
    return `
      <article class="panel card error-card">
        <div class="card-head"><div class="avatar" style="display:grid;place-items:center;font-size:1.4rem">${icon}</div>
          <div><h3>${name ? esc(name) : '<span class="muted">Unnamed</span>'}</h3>
          <div class="sub"><a href="${profileUrl(u.username)}" target="_blank" rel="noopener">@${esc(u.username)}</a></div>
          <div class="sub err-text">${esc(u.error)}</div></div></div>
      </article>`;
  }

  // Tabs (shared by both panes)
  document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((x) => {
      const on = x === t;
      x.classList.toggle('active', on);
      x.setAttribute('aria-selected', on);
      document.getElementById('tab-' + x.dataset.tab).hidden = !on;
    });
    history.replaceState(null, '', '#' + t.dataset.tab);
  }));
  if (location.hash === '#github') document.getElementById('tab-btn-github')?.click();

  load();
  renderChips();
})();
