// Reads local session logs of AI coding agents and sums the last 7 days.
// Read-only: files are opened for reading only and nothing leaves the machine.
const fs = require('fs');
const path = require('path');
const os = require('os');

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
// Written by claude-statusline.js, since Claude Code only exposes its limits to the status line.
const CLAUDE_LIMITS = path.join(os.homedir(), '.agent-usage-hud', 'claude-limits.json');

function row(name) {
  return { name, sessions: 0, messages: 0, input: 0, output: 0, cached: 0, found: false, note: '', limits: { session: null, weekly: null } };
}

// Recursively list *.jsonl files modified since `since` (older files cannot hold new entries).
function jsonlFiles(dir, since, out = []) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) jsonlFiles(p, since, out);
    else if (e.name.endsWith('.jsonl') && fs.statSync(p).mtimeMs >= since) out.push(p);
  }
  return out;
}

function lines(file) {
  const out = [];
  for (const l of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!l) continue;
    try { out.push(JSON.parse(l)); } catch { /* partial line while the agent is writing */ }
  }
  return out;
}

function claudeCode(home, since, now, limitsFile) {
  const r = row('Claude Code');
  const roots = [process.env.CLAUDE_CONFIG_DIR, path.join(home, '.claude'), path.join(home, '.config', 'claude')]
    .filter(Boolean).map((d) => path.join(d, 'projects')).filter((d) => fs.existsSync(d));
  r.found = roots.length > 0;
  const seen = new Set();
  const sessions = new Set();
  for (const root of roots) {
    for (const f of jsonlFiles(root, since)) {
      for (const e of lines(f)) {
        const u = e.message && e.message.usage;
        if (!u || Date.parse(e.timestamp) < since) continue;
        // One API response is logged once per content block; count it once.
        const id = `${e.message.id}:${e.requestId}`;
        if (seen.has(id)) continue;
        seen.add(id);
        sessions.add(e.sessionId || f);
        r.messages++;
        r.input += (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0);
        r.output += u.output_tokens || 0;
        r.cached += u.cache_read_input_tokens || 0;
      }
    }
  }
  r.sessions = sessions.size;
  try {
    const l = JSON.parse(fs.readFileSync(limitsFile, 'utf8'));
    r.limits.session = limit(l.five_hour && l.five_hour.used_percentage, l.five_hour && l.five_hour.resets_at, now);
    r.limits.weekly = limit(l.seven_day && l.seven_day.used_percentage, l.seven_day && l.seven_day.resets_at, now);
  } catch { r.note = 'add the status line script to see limits'; }
  return r;
}

// A window whose reset time has passed is back at 0%.
function limit(pct, resetsAt, now) {
  if (typeof pct !== 'number') return null;
  return resetsAt && resetsAt * 1000 < now ? { pct: 0, resetsAt: null } : { pct, resetsAt: resetsAt || null };
}

function codex(home, since, now) {
  const r = row('Codex');
  const root = path.join(process.env.CODEX_HOME || path.join(home, '.codex'), 'sessions');
  r.found = fs.existsSync(root);
  const latest = { session: null, weekly: null };
  for (const f of jsonlFiles(root, since)) {
    let prev = null;
    let active = false;
    for (const e of lines(f)) {
      const p = e.payload;
      if (e.type !== 'event_msg' || !p || p.type !== 'token_count') continue;
      const t = Date.parse(e.timestamp);
      for (const lim of [p.rate_limits && p.rate_limits.primary, p.rate_limits && p.rate_limits.secondary]) {
        if (!lim) continue;
        const kind = lim.window_minutes >= 10080 ? 'weekly' : lim.window_minutes <= 300 ? 'session' : null;
        if (kind && (!latest[kind] || t > latest[kind].t)) latest[kind] = { t, ...lim };
      }
      const tot = p.info && p.info.total_token_usage;
      if (!tot) continue;
      // total_token_usage is cumulative per session, so add the growth since the previous event.
      const d = (k) => (tot[k] || 0) - ((prev && prev[k]) || 0);
      if (t >= since && d('total_tokens') > 0) {
        active = true;
        r.messages++;
        r.input += d('input_tokens') - d('cached_input_tokens');
        r.output += d('output_tokens');
        r.cached += d('cached_input_tokens');
      }
      prev = tot;
    }
    if (active) r.sessions++;
  }
  for (const k of ['session', 'weekly']) if (latest[k]) r.limits[k] = limit(latest[k].used_percent, latest[k].resets_at, now);
  return r;
}

function appDataDir(home) {
  if (process.platform === 'win32') return process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
  if (process.platform === 'darwin') return path.join(home, 'Library', 'Application Support');
  return process.env.XDG_CONFIG_HOME || path.join(home, '.config');
}

function cursor(home, since, appData = appDataDir(home)) {
  const r = row('Cursor');
  const db = path.join(appData, 'Cursor', 'User', 'globalStorage', 'state.vscdb');
  r.found = fs.existsSync(db);
  if (!r.found) return r;
  const { DatabaseSync } = require('node:sqlite');
  let conn;
  try {
    conn = new DatabaseSync(db, { readOnly: true });
    const sessions = new Set();
    for (const { key, value } of conn.prepare("SELECT key, value FROM cursorDiskKV WHERE key LIKE 'bubbleId:%'").all()) {
      let b;
      try { b = JSON.parse(value); } catch { continue; }
      if (!b || Date.parse(b.createdAt) < since) continue;
      sessions.add(key.split(':')[1]);
      r.messages++;
      r.input += (b.tokenCount && b.tokenCount.inputTokens) || 0;
      r.output += (b.tokenCount && b.tokenCount.outputTokens) || 0;
    }
    r.sessions = sessions.size;
    r.note = 'no limit data stored locally';
  // Cursor bills on its servers and usually stores 0 tokens locally.
    if (r.messages && !r.input && !r.output) r.note = 'limits and tokens not stored locally';
  } catch (err) {
    r.note = `could not read (${err.code || err.message})`;
  } finally {
    if (conn) conn.close();
  }
  return r;
}

function antigravity(home, since) {
  const r = row('Antigravity');
  const dir = path.join(home, '.gemini', 'antigravity', 'conversations');
  r.found = fs.existsSync(dir);
  if (!r.found) return r;
  for (const name of fs.readdirSync(dir)) {
    if (name.endsWith('.pb') && fs.statSync(path.join(dir, name)).mtimeMs >= since) r.sessions++;
  }
  // Conversation files are binary/encrypted; only activity per session is visible.
  r.note = 'limits and tokens not stored locally';
  return r;
}

function collect({ home = os.homedir(), now = Date.now(), appData, claudeLimits = path.join(home, '.agent-usage-hud', 'claude-limits.json') } = {}) {
  const since = now - WEEK_MS;
  const safe = (fn, name) => { try { return fn(); } catch (e) { return { ...row(name), found: true, note: `error: ${e.message}` }; } };
  return {
    since,
    now,
    tools: [
      safe(() => claudeCode(home, since, now, claudeLimits), 'Claude Code'),
      safe(() => codex(home, since, now), 'Codex'),
      safe(() => cursor(home, since, appData), 'Cursor'),
      safe(() => antigravity(home, since), 'Antigravity'),
    ],
  };
}

module.exports = { collect, CLAUDE_LIMITS };

if (require.main === module) console.log(JSON.stringify(collect(), null, 2));
