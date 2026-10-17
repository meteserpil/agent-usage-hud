#!/usr/bin/env node
// Claude Code status line: saves your 5-hour and weekly limit % for the overlay, then prints them.
// Claude Code pipes session JSON on stdin. Only the two rate_limits windows are written to disk.
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

// Installed and updated by agent-usage-hud; keep this script standalone.
const CLAUDE_LIMITS = path.join(os.homedir(), '.agent-usage-hud', 'claude-limits.json');

let input = '';
process.stdin.on('data', (c) => (input += c));
process.stdin.on('end', () => {
  const sessionData = input;
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
  const hudOutput = `5h ${pct(rl.five_hour)} · 7d ${pct(rl.seven_day)}`;
  const wrapperFile = path.join(__dirname, 'agent-usage-hud-statusline.json');
  let existingCommand = '';
  try {
    const wrapper = JSON.parse(fs.readFileSync(wrapperFile, 'utf8'));
    if (wrapper.installedBy === 'agent-usage-hud' && typeof wrapper.existingCommand === 'string') {
      existingCommand = wrapper.existingCommand;
    }
  } catch { /* regular non-wrapper setup: show only HUD usage */ }

  if (!existingCommand) {
    process.stdout.write(hudOutput);
    return;
  }

  // Preserve an existing user-configured command and append HUD limits to its output.
  let child;
  try {
    const gitBashCandidates = [
      process.env.CLAUDE_CODE_GIT_BASH_PATH,
      process.env['ProgramFiles'] && path.join(process.env['ProgramFiles'], 'Git', 'bin', 'bash.exe'),
      process.env['ProgramFiles(x86)'] && path.join(process.env['ProgramFiles(x86)'], 'Git', 'bin', 'bash.exe'),
      process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs', 'Git', 'bin', 'bash.exe'),
    ].filter(Boolean);
    const windowsShell = gitBashCandidates.find((candidate) => fs.existsSync(candidate)) || 'powershell.exe';
    const shell = process.env.CLAUDE_CODE_SHELL || process.env.SHELL || (process.platform === 'win32' ? windowsShell : true);
    child = spawn(existingCommand, { shell, windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
  } catch {
    process.stdout.write(hudOutput);
    return;
  }
  let previousOutput = '';
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    clearTimeout(timeout);
    process.stdout.write([previousOutput, hudOutput].filter(Boolean).join(' · '));
  };
  const timeout = setTimeout(() => child.kill(), 5000);
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    if (previousOutput.length + chunk.length > 1024 * 1024) {
      child.kill();
      return;
    }
    previousOutput += chunk;
  });
  child.on('error', finish);
  child.on('close', finish);
  child.stdin.on('error', () => {});
  child.stdin.end(sessionData);
});
