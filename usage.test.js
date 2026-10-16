// Run with: npm test  (uses fake log folders, never your real data)
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const { collect } = require('./usage');

const now = Date.parse('2026-10-10T12:00:00Z');
const recent = '2026-10-09T10:00:00Z';
const old = '2026-09-01T10:00:00Z';

function write(file, rows) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, rows.map((r) => JSON.stringify(r)).join('\n') + '\n{"broken');
}

test('sums the last 7 days for every tool', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'hud-'));
  delete process.env.CLAUDE_CONFIG_DIR;
  delete process.env.CODEX_HOME;

  const usage = { input_tokens: 10, cache_creation_input_tokens: 5, output_tokens: 20, cache_read_input_tokens: 100 };
  write(path.join(home, '.claude/projects/p/s1.jsonl'), [
    { sessionId: 's1', timestamp: recent, requestId: 'r1', message: { id: 'm1', usage } },
    { sessionId: 's1', timestamp: recent, requestId: 'r1', message: { id: 'm1', usage } }, // same response, second block
    { sessionId: 's1', timestamp: old, requestId: 'r0', message: { id: 'm0', usage } },
  ]);

  const tc = (ts, total) => ({ timestamp: ts, type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: total }, rate_limits: { primary: { used_percent: 42.4, window_minutes: 10080 } } } });
  write(path.join(home, '.codex/sessions/2026/10/09/rollout.jsonl'), [
    tc(old, { input_tokens: 100, cached_input_tokens: 50, output_tokens: 10, total_tokens: 110 }),
    tc(recent, { input_tokens: 300, cached_input_tokens: 150, output_tokens: 30, total_tokens: 330 }),
    tc(recent, { input_tokens: 300, cached_input_tokens: 150, output_tokens: 30, total_tokens: 330 }), // repeat, no growth
  ]);

  const appData = path.join(home, 'appdata');
  const dbFile = path.join(appData, 'Cursor/User/globalStorage/state.vscdb');
  fs.mkdirSync(path.dirname(dbFile), { recursive: true });
  const db = new DatabaseSync(dbFile);
  db.exec('CREATE TABLE cursorDiskKV (key TEXT PRIMARY KEY, value BLOB)');
  const ins = db.prepare('INSERT INTO cursorDiskKV VALUES (?, ?)');
  ins.run('bubbleId:c1:b1', JSON.stringify({ createdAt: recent, tokenCount: { inputTokens: 0, outputTokens: 0 } }));
  ins.run('bubbleId:c1:b2', JSON.stringify({ createdAt: recent }));
  ins.run('bubbleId:c2:b3', JSON.stringify({ createdAt: old }));
  db.close();

  const conv = path.join(home, '.gemini/antigravity/conversations');
  fs.mkdirSync(conv, { recursive: true });
  fs.writeFileSync(path.join(conv, 'a.pb'), '');
  fs.writeFileSync(path.join(conv, 'b.pb'), '');
  fs.utimesSync(path.join(conv, 'b.pb'), new Date(old), new Date(old));
  fs.utimesSync(path.join(conv, 'a.pb'), new Date(recent), new Date(recent));

  const [claude, codex, cursor, ag] = collect({ home, now, appData }).tools;
  assert.deepStrictEqual([claude.sessions, claude.messages, claude.input, claude.output], [1, 1, 15, 20]);
  assert.deepStrictEqual([codex.sessions, codex.messages, codex.input, codex.output], [1, 1, 100, 20]);
  assert.strictEqual(codex.limits.weekly.pct, 42.4);
  assert.deepStrictEqual([cursor.sessions, cursor.messages], [1, 2]);
  assert.strictEqual(cursor.note, 'limits and tokens not stored locally');
  assert.strictEqual(ag.sessions, 1);
});

test('a changed log file is read again, an unchanged one comes from cache', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'hud-cache-'));
  const file = path.join(home, '.claude/projects/p/s.jsonl');
  const entry = (id) => ({ sessionId: 's', timestamp: recent, requestId: id, message: { id, usage: { output_tokens: 1 } } });
  write(file, [entry('a')]);
  assert.strictEqual(collect({ home, now, appData: home }).tools[0].messages, 1);
  assert.strictEqual(collect({ home, now, appData: home }).tools[0].messages, 1);
  write(file, [entry('a'), entry('b')]);
  assert.strictEqual(collect({ home, now, appData: home }).tools[0].messages, 2);
});

test('missing tools are reported as not found', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'hud-empty-'));
  for (const t of collect({ home, now, appData: home }).tools) assert.strictEqual(t.found, false, t.name);
});

test('reads limits and treats passed reset times as 0%', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'hud-lim-'));
  const claudeLimits = path.join(home, 'claude-limits.json');
  fs.mkdirSync(path.join(home, '.claude/projects'), { recursive: true });
  fs.writeFileSync(claudeLimits, JSON.stringify({ five_hour: { used_percentage: 23.5, resets_at: now / 1000 + 3600 }, seven_day: { used_percentage: 80, resets_at: now / 1000 - 1 } }));
  const lim = (pct, mins, resets) => ({ used_percent: pct, window_minutes: mins, resets_at: resets });
  write(path.join(home, '.codex/sessions/r.jsonl'), [
    { timestamp: recent, type: 'event_msg', payload: { type: 'token_count', info: null, rate_limits: { primary: lim(10, 300, now / 1000 + 60), secondary: lim(55, 10080, now / 1000 + 9999) } } },
  ]);
  const [claude, codex] = collect({ home, now, appData: home, claudeLimits }).tools;
  assert.deepStrictEqual(claude.limits, { session: { pct: 23.5, resetsAt: now / 1000 + 3600 }, weekly: { pct: 0, resetsAt: null } });
  assert.deepStrictEqual([codex.limits.session.pct, codex.limits.weekly.pct], [10, 55]);
});

test('status line script saves only the limit windows', () => {
  const { execFileSync } = require('child_process');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'hud-sl-'));
  const out = execFileSync(process.execPath, [path.join(__dirname, 'claude-statusline.js')], {
    input: JSON.stringify({ session_id: 'secret', rate_limits: { five_hour: { used_percentage: 12.4, resets_at: 1 }, seven_day: { used_percentage: 50, resets_at: 2 } } }),
    env: { ...process.env, HOME: home, USERPROFILE: home },
  }).toString();
  assert.strictEqual(out, '5h 12% · 7d 50%');
  const saved = fs.readFileSync(path.join(home, '.agent-usage-hud/claude-limits.json'), 'utf8');
  assert.deepStrictEqual(JSON.parse(saved), { five_hour: { used_percentage: 12.4, resets_at: 1 }, seven_day: { used_percentage: 50, resets_at: 2 } });
});

test('status line still prints when the save fails', () => {
  const { execFileSync } = require('child_process');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'hud-sl-fail-'));
  // A folder in the file's place makes the rename fail, like a file locked by another process on Windows.
  fs.mkdirSync(path.join(home, '.agent-usage-hud/claude-limits.json'), { recursive: true });
  const out = execFileSync(process.execPath, [path.join(__dirname, 'claude-statusline.js')], {
    input: JSON.stringify({ rate_limits: { five_hour: { used_percentage: 7, resets_at: 1 } } }),
    env: { ...process.env, HOME: home, USERPROFILE: home },
  }).toString();
  assert.strictEqual(out, '5h 7% · 7d –');
  assert.deepStrictEqual(fs.readdirSync(path.join(home, '.agent-usage-hud')), ['claude-limits.json']); // no leftover temp file
});
