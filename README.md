# agent-usage-hud

A small always-on-top overlay for **Windows and macOS** that shows how much of your AI coding agent limits you have used. Press a hotkey, it slides in on the right edge of your screen; press it again and it's gone.

![agent-usage-hud overlay](docs/screenshot.png)

- **Rings:** shortest detected limit window on the inner ring and longest on the outer ring; each window is labeled with its actual duration
- Rings go from **green to red** as you approach the limit, and animate every time you open the overlay
- Every agent you used this week is stacked on top of each other; the more agents, the smaller the rings
- Below each ring: sessions, messages and tokens over the last 7 days

Supported agents:

| Agent | Locally available limit windows | Sessions / messages / tokens (7 days) |
|---|---|---|
| Claude Code | ✅ 5-hour and 7-day limits via one-click HUD setup | ✅ from `~/.claude/projects` |
| Codex CLI | ✅ windows reported by Codex are read from its logs and labeled by duration | ✅ from `~/.codex/sessions` |
| Cursor | ❌ not stored on your machine | sessions + messages from Cursor's local database (tokens usually not stored) |
| Antigravity | ❌ not stored on your machine | sessions only (conversation files are not readable) |

If an agent doesn't store a number or limit window locally, the overlay says so instead of guessing. Codex's available local windows can vary by plan and may not include a 5-hour limit.

## Install

### Windows: download the installer

1. Open [the latest release](https://github.com/meteserpil/agent-usage-hud/releases/latest).
2. Download `Agent-Usage-HUD-<version>-Setup.exe`. The installer selects the right build for standard x64 PCs or Windows on ARM.
3. Run the installer. It installs for your Windows account and adds a Start menu and desktop shortcut; Node.js is not required.

The Windows installers are unsigned community builds. If Microsoft Defender SmartScreen warns you, verify that you downloaded the installer from this repository before choosing **More info** and **Run anyway**.

### macOS: download the app

1. Open [the latest release](https://github.com/meteserpil/agent-usage-hud/releases/latest).
2. macOS 12 Monterey or newer is required. Download `Agent-Usage-HUD-<version>-arm64.dmg` for Apple Silicon (M1/M2/M3/M4) or `Agent-Usage-HUD-<version>-x64.dmg` for an Intel Mac.
3. Open the downloaded DMG and drag **Agent Usage HUD** into **Applications**.
4. Eject the DMG, then open the app from Applications. The first launch may be blocked because these community builds are not signed or notarized. If you trust the source, try opening it once, then go to **System Settings → Privacy & Security → Open Anyway** and confirm. See [Apple's instructions](https://support.apple.com/en-sg/102445).

The release workflow builds separate installers for Intel and Apple Silicon Macs, plus one Windows installer for x64 and ARM64 PCs. Electron 43 supports macOS 12 Monterey and newer. Mac builds are unsigned because this project does not have an Apple Developer ID certificate.

### Build from source (Windows, macOS, or Linux)

Install [Node.js 22.12 or newer](https://nodejs.org), then run:

```bash
git clone https://github.com/meteserpil/agent-usage-hud.git
cd agent-usage-hud
npm ci
npm start
```

The overlay appears once at start, then runs in the background. You can also build a DMG on macOS with `npm run dist:mac`, or a Windows installer with `npm run dist:win -- --x64 --arm64`.

## Use it

- **Toggle:** `Ctrl+Shift+U` on Windows, `Cmd+Shift+U` on macOS
- **Move:** drag the header to place the overlay anywhere on a screen; its position is saved
- **Collapse details:** click the `−` beside an agent's name to hide its usage details; click `+` to show them again. Each agent's preference is saved.
- **Live updates:** usage refreshes every 60 seconds while the overlay is visible.
- **Change the key:** click `key: …` at the bottom of the overlay and press any supported key or combination (for example `Ctrl+Alt+K`, `F9`, or a single letter). Click the button again to cancel. Your choice is saved.
- **hide** hides it, **quit** closes the app.

The overlay doesn't steal focus, so you can keep typing in your editor while it's open.

## Claude Code limits

Claude Code only shares its 5-hour and weekly limit with its [status line](https://code.claude.com/docs/en/statusline). When Claude Code is detected, click **Set up Claude limits** in the HUD. The app installs its helper in `~/.claude` and adds the status line entry to your Claude settings. It preserves other settings and makes a timestamped backup before changing an existing `settings.json`.

For manual setup, first copy `claude-statusline.js` to `~/.claude/agent-usage-hud-statusline.js`, then add this to `~/.claude/settings.json`:

```json
{
  "statusLine": {
    "type": "command",
    "command": "node ~/.claude/agent-usage-hud-statusline.js"
  }
}
```

Notes:
- The app does not replace a different status line you already configured; merge the HUD command yourself if you want to keep both.
- Limits are only available on Claude Pro and Max plans, and appear after the first reply in a session.
- The percentages update whenever Claude Code refreshes its status line, so start a Claude Code session to see fresh numbers.

## Is it safe?

This app was written to be easy to audit. It's a few hundred lines of plain JavaScript with no runtime dependencies (only Electron itself).

- **Usage data is read-only.** It only reads the agents' log files. Cursor's database is opened in read-only mode. It never changes, moves or deletes anything those tools own. When you set up Claude limits, it adds the status line entry to Claude's settings and backs up an existing settings file first.
- **Offline.** It makes no network requests: no telemetry, no analytics, no update checks, no accounts, no API keys.
- **Nothing sensitive leaves the log files.** Only numbers (counts, token totals, percentages) are passed to the window. Your prompts and code are never displayed or stored.
- **It writes only a few small local files:**
  - `~/.agent-usage-hud/claude-limits.json`: the two Claude limit percentages and their reset times (written by the status line script)
  - `~/.claude/agent-usage-hud-statusline.js`: the helper Claude Code runs to provide limit percentages
  - `~/.claude/settings.json`: the Claude status line command (only added when you click **Set up Claude limits**)
  - `config.json` in the app's data folder: your hotkey and overlay position
  - renderer state in the app's data folder: which agents have their usage details collapsed
- **No keylogging.** The hotkey uses the operating system's global shortcut API (the same one media keys use). It only learns when *your* chosen combination is pressed. On macOS it needs no Accessibility or Input Monitoring permission.
- **Locked-down window.** Sandboxed renderer, context isolation, no Node in the page, a strict Content Security Policy, navigation and pop-ups blocked, and all permission requests (camera, mic, etc.) denied.

Don't take my word for it: the whole app is [`usage.js`](usage.js) (reading the logs), [`main.js`](main.js) (window and hotkey), [`renderer.js`](renderer.js) (drawing) and [`claude-statusline.js`](claude-statusline.js).

## Where the data comes from

| Agent | Path |
|---|---|
| Claude Code | `~/.claude/projects/**/*.jsonl` (or `$CLAUDE_CONFIG_DIR/projects`) |
| Codex | `~/.codex/sessions/**/*.jsonl` (or `$CODEX_HOME/sessions`) |
| Cursor | Windows `%APPDATA%\Cursor\User\globalStorage\state.vscdb`, macOS `~/Library/Application Support/Cursor/User/globalStorage/state.vscdb` |
| Antigravity | `~/.gemini/antigravity/conversations/*.pb` |

"Last 7 days" is a rolling window. Claude Code tokens are input + cache writes + output; cache reads are left out of the token count because they would dwarf everything else.

## Tests

```bash
npm test
```

The tests use made-up log folders, never your real data. They need Node.js 22 or newer (for the built-in SQLite module).

## Limitations

- Not tested on Linux, but it should work there.
- These agents' log formats aren't official APIs, so an agent update can break a reader. If a number looks wrong, open an issue.
- The logos are simplified marks drawn in SVG. The names and trademarks belong to their owners; this project isn't affiliated with Anthropic, OpenAI, Anysphere or Google.

## License

MIT
