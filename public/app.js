(() => {
  const $ = (s) => document.querySelector(s);
  const state = { users: [] };

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
    els.rangeLabel.textContent = fmtRange(start, end);
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

  function render(results) {
    const ok = results.filter((u) => !u.error).sort((a, b) => effectiveCount(b) - effectiveCount(a) || (b.totals.all || 0) - (a.totals.all || 0));
    const bad = results.filter((u) => u.error);

    els.board.innerHTML =
      ok.map((u, i) => `
        <tr>
          <td class="rank rank-${i + 1}">${i < 3 ? ['🥇', '🥈', '🥉'][i] : i + 1}</td>
          <td><div class="user-cell">${avatar(u)}<a href="https://leetcode.com/u/${encodeURIComponent(u.username)}/" target="_blank" rel="noopener">${esc(u.username)}</a></div></td>
          <td><span class="big-num">${u.solvedInRange}</span> unique
            ${u.incomplete ? `<span class="approx">≈ ${u.calendarCount} submissions (calendar)</span>` : ''}</td>
          <td class="hide-sm"><span class="easy">${u.difficultyCounts.Easy}</span> / <span class="medium">${u.difficultyCounts.Medium}</span> / <span class="hard">${u.difficultyCounts.Hard}</span></td>
          <td class="hide-sm">${u.totals.all ?? 0}</td>
        </tr>`).join('') +
      bad.map((u) => `
        <tr><td class="rank">—</td><td>${esc(u.username)}</td><td colspan="3" class="err-text">${esc(u.error)}</td></tr>`).join('');

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
