#!/usr/bin/env node
// Claude Code status line: saves your 5-hour and weekly limit % for the overlay, then prints them.
// Claude Code pipes session JSON on stdin. Only the two rate_limits windows are written to disk.
const fs = require('fs');
const path = require('path');
const os = require('os');

// Installed and updated by agent-usage-hud; keep this script standalone.
const CLAUDE_LIMITS = path.join(os.homedir(), '.agent-usage-hud', 'claude-limits.json');

let input = '';
process.stdin.on('data', (c) => (input += c));
process.stdin.on('end', () => {
  let rl = {};
  try { rl = JSON.parse(input).rate_limits || {}; } catch { /* not JSON: print nothing useful, never crash the status line */ }
  const keep = (w) => w && { used_percentage: w.used_percentage, resets_at: w.resets_at };
  if (rl.five_hour || rl.seven_day) {
    // One temp file per process: several Claude sessions refresh their status lines at once.
    const tmp = `${CLAUDE_LIMITS}.${process.pid}.tmp`;
    try {
      fs.mkdirSync(path.dirname(CLAUDE_LIMITS), { recursive: true });
      fs.writeFileSync(tmp, JSON.stringify({ five_hour: keep(rl.five_hour), seven_day: keep(rl.seven_day) }));
      fs.renameSync(tmp, CLAUDE_LIMITS); // atomic, so the overlay never reads half a file
    } catch {
      // Windows refuses the rename while another process holds the file; the next refresh saves it.
      try { fs.unlinkSync(tmp); } catch { /* already gone */ }
    }
  }
  const pct = (w) => (w ? `${Math.round(w.used_percentage)}%` : '–');
  process.stdout.write(`5h ${pct(rl.five_hour)} · 7d ${pct(rl.seven_day)}`);
});
