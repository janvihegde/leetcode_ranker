const fs = require('fs');
const path = require('path');

const CACHE_DIR = path.join(__dirname, '..', 'cache');
const QUESTIONS_FILE = path.join(CACHE_DIR, 'questions.json');

function ensureCacheDir() {
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
  } catch (e) {
    console.warn('[cache] could not create cache dir:', e.message);
  }
}

/** Simple in-memory TTL cache. */
class TTLCache {
  constructor(ttlMs) {
    this.ttl = ttlMs;
    this.map = new Map();
  }
  get(key) {
    const e = this.map.get(key);
    if (!e) return undefined;
    if (Date.now() > e.exp) {
      this.map.delete(key);
      return undefined;
    }
    return e.val;
  }
  set(key, val) {
    this.map.set(key, { val, exp: Date.now() + this.ttl });
  }
}

const userCache = new TTLCache(5 * 60 * 1000); // 5 minutes
const questionCache = new TTLCache(24 * 60 * 60 * 1000); // 24 hours

// Load persisted questions (question metadata rarely changes).
ensureCacheDir();
try {
  if (fs.existsSync(QUESTIONS_FILE)) {
    const data = JSON.parse(fs.readFileSync(QUESTIONS_FILE, 'utf8'));
    for (const [k, v] of Object.entries(data)) questionCache.set(k, v);
    console.log(`[cache] loaded ${Object.keys(data).length} questions from disk`);
  }
} catch (e) {
  console.warn('[cache] failed to load questions cache:', e.message);
}

let saveTimer = null;
function persistQuestions() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    ensureCacheDir();
    const out = {};
    for (const [k, e] of questionCache.map) out[k] = e.val;
    fs.writeFile(QUESTIONS_FILE, JSON.stringify(out), (err) => {
      if (err) console.warn('[cache] failed to persist questions:', err.message);
    });
  }, 1000);
}

module.exports = { userCache, questionCache, persistQuestions, ensureCacheDir };
