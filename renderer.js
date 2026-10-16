const SVG = 'http://www.w3.org/2000/svg';
const fmt = (n) => (n >= 1e9 ? (n / 1e9).toFixed(1) + 'B' : n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'k' : String(n));
const windowName = (mins) => mins % 1440 === 0 ? `${mins / 1440}d` : mins % 60 === 0 ? `${mins / 60}h` : `${mins}m`;
// 0% = green (hue 120) → 100% = red (hue 0).
const color = (pct) => `hsl(${Math.round(120 * (1 - Math.min(pct, 100) / 100))}, 75%, 50%)`;

function until(resetsAt, now) {
  if (!resetsAt) return '';
  const m = Math.max(0, Math.round((resetsAt * 1000 - now) / 60000));
  return ` · resets ${m >= 1440 ? Math.round(m / 1440) + 'd' : m >= 60 ? Math.round(m / 60) + 'h' : m + 'm'}`;
}

function el(tag, attrs = {}, text) {
  const e = tag === 'div' ? document.createElement(tag) : document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (text !== undefined) e.textContent = text; // textContent only: log data is never parsed as HTML
  return e;
}

// Simplified brand marks drawn in a 24x24 box. Trademarks belong to their owners.
const LOGOS = {
  'Claude Code': (g) => {
    for (let i = 0; i < 12; i++) {
      const a = (i * Math.PI) / 6, len = i % 2 ? 7 : 10;
      g.append(el('line', { x1: 12, y1: 12, x2: 12 + len * Math.cos(a), y2: 12 + len * Math.sin(a), stroke: '#D97757', 'stroke-width': 2.6, 'stroke-linecap': 'round' }));
    }
  },
  Codex: (g) => {
    g.append(el('rect', { x: 1, y: 1, width: 22, height: 22, rx: 6, fill: '#0d0d0d', stroke: '#ffffff40' }));
    g.append(el('path', { d: 'M6.5 8.5 L10.5 12 L6.5 15.5 M12.5 16 H17.5', fill: 'none', stroke: '#fff', 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
  },
  Cursor: (g) => {
    g.append(el('path', { d: 'M12 2 L21 7 L12 12 L3 7 Z', fill: '#e8e8ea' }));
    g.append(el('path', { d: 'M3 7 L12 12 L12 22 L3 17 Z', fill: '#8a8a92' }));
    g.append(el('path', { d: 'M21 7 L12 12 L12 22 L21 17 Z', fill: '#4a4a52' }));
  },
  Antigravity: (g) => {
    g.append(el('path', { d: 'M3.5 20 L12 3.5 L20.5 20', fill: 'none', stroke: '#4f8cff', 'stroke-width': 3.2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
    g.append(el('path', { d: 'M7.5 15.5 Q12 11 16.5 15.5', fill: 'none', stroke: '#34a853', 'stroke-width': 2.4, 'stroke-linecap': 'round' }));
  },
};

// Two concentric rings with the tool's logo in the middle: outer = weekly limit, inner = 5-hour session limit.
// Drawn in a fixed 76-unit box and scaled to `size` px.
function rings(t, size) {
  const svg = el('svg', { width: size, height: size, viewBox: '0 0 76 76', role: 'img', 'aria-label': t.name });
  const arcs = [];
  const windows = [...(t.windows || [])].sort((a, b) => a.minutes - b.minutes);
  const displayed = windows.length > 1 ? [windows[windows.length - 1], windows[0]]
    : windows.length === 1 ? (windows[0].minutes <= 300 ? [null, windows[0]] : [windows[0], null])
      : [null, null];
  for (const [r, lim] of [[33, displayed[0]], [22, displayed[1]]]) {
    const c = 2 * Math.PI * r;
    svg.append(el('circle', { class: 'track', cx: 38, cy: 38, r, 'stroke-width': 8 }));
    if (!lim) continue;
    const arc = el('circle', { class: 'arc', cx: 38, cy: 38, r, 'stroke-width': 8, 'stroke-dasharray': c, 'stroke-dashoffset': c, stroke: color(0), transform: 'rotate(-90 38 38)' });
    svg.append(arc);
    arcs.push([arc, c * (1 - Math.min(lim.pct, 100) / 100), color(lim.pct)]);
  }
  const logo = el('g', { transform: 'translate(26 26)' });
  LOGOS[t.name](logo);
  svg.append(logo);
  // Start empty and green, then sweep to the real value so the rings animate on every open.
  requestAnimationFrame(() => requestAnimationFrame(() => {
    for (const [arc, offset, stroke] of arcs) { arc.setAttribute('stroke-dashoffset', offset); arc.setAttribute('stroke', stroke); }
  }));
  return svg;
}

const used = (t) => t.found && (t.sessions > 0 || (t.windows && t.windows.length));
const COLLAPSED_KEY = 'agent-usage-hud-collapsed';
let collapsedAgents = new Set();
try {
  const saved = JSON.parse(localStorage.getItem(COLLAPSED_KEY) || '[]');
  if (Array.isArray(saved)) collapsedAgents = new Set(saved.filter((name) => typeof name === 'string'));
} catch { /* use expanded rows if saved state is unavailable */ }

async function refresh() {
  const { tools, now, hotkey } = await window.hud.usage();
  const list = document.getElementById('tools');
  list.replaceChildren();
  // Only tools used this week; fall back to installed ones so the panel is never empty.
  let shown = tools.filter(used);
  if (!shown.length) shown = tools.filter((t) => t.found);
  // One tool gets a big ring; more tools stack and shrink.
  const size = shown.length <= 1 ? 120 : shown.length === 2 ? 96 : 76;
  for (const t of shown) {
    const row = el('div', { class: 'tool' });
    if (collapsedAgents.has(t.name)) row.classList.add('collapsed');
    const info = el('div', { class: 'info' });
    const heading = el('div', { class: 'agent-heading' });
    heading.append(el('div', { class: 'name' }, t.name));
    const collapse = document.createElement('button');
    collapse.type = 'button';
    collapse.className = 'collapse-button';
    collapse.textContent = row.classList.contains('collapsed') ? '+' : '−';
    collapse.title = row.classList.contains('collapsed') ? 'Show usage details' : 'Hide usage details';
    collapse.setAttribute('aria-label', `${collapse.title} for ${t.name}`);
    heading.append(collapse);
    info.append(heading);
    const details = el('div', { class: 'details' });
    for (const w of [...(t.windows || [])].sort((a, b) => a.minutes - b.minutes)) {
      details.append(el('div', { style: `color:${color(w.pct)}` }, `${windowName(w.minutes)} ${Math.round(w.pct)}%${until(w.resetsAt, now)}`));
    }
    const tokens = t.input + t.output;
    const plural = (n, w) => `${fmt(n)} ${w}${n === 1 ? '' : 's'}`;
    details.append(el('div', { class: 'muted' }, '7d: ' + [plural(t.sessions, 'session'), t.messages && plural(t.messages, 'msg'), tokens && `${fmt(tokens)} tok`].filter(Boolean).join(' · ')));
    if (t.note) details.append(el('div', { class: 'muted' }, t.note));
    info.append(details);
    row.append(rings(t, size), info);
    collapse.onclick = () => {
      const isCollapsed = row.classList.toggle('collapsed');
      if (isCollapsed) collapsedAgents.add(t.name);
      else collapsedAgents.delete(t.name);
      localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...collapsedAgents]));
      collapse.textContent = isCollapsed ? '+' : '−';
      collapse.title = isCollapsed ? 'Show usage details' : 'Hide usage details';
      collapse.setAttribute('aria-label', `${collapse.title} for ${t.name}`);
      window.hud.resize(document.querySelector('.panel').offsetHeight);
    };
    list.append(row);
  }
  if (!shown.length) list.append(el('div', { class: 'muted' }, 'No supported agent found on this machine.'));
  showKey(hotkey);
  window.hud.resize(document.querySelector('.panel').offsetHeight);
}

const keyBtn = document.getElementById('key');
const showKey = (k) => { keyBtn.textContent = `key: ${(k || 'none').replace('CommandOrControl', window.hud.isMac ? 'Cmd' : 'Ctrl')}`; keyBtn.dataset.key = k || ''; };

// Turn a keydown into an Electron accelerator like "Control+Alt+K" or "F9".
function accelerator(e) {
  const named = {
    Space: 'Space', Tab: 'Tab', Enter: 'Enter', NumpadEnter: 'Enter', Escape: 'Escape',
    Backspace: 'Backspace', Delete: 'Delete', Insert: 'Insert', Home: 'Home', End: 'End',
    PageUp: 'PageUp', PageDown: 'PageDown', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right',
    CapsLock: 'Capslock', NumLock: 'Numlock', ScrollLock: 'Scrolllock', PrintScreen: 'PrintScreen',
    Backquote: '`', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Backslash: '\\',
    Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/',
    NumpadAdd: 'numadd', NumpadSubtract: 'numsub', NumpadMultiply: 'nummult', NumpadDivide: 'numdiv', NumpadDecimal: 'numdec',
    AudioVolumeUp: 'VolumeUp', AudioVolumeDown: 'VolumeDown', AudioVolumeMute: 'VolumeMute',
    MediaTrackNext: 'MediaNextTrack', MediaTrackPrevious: 'MediaPreviousTrack', MediaStop: 'MediaStop', MediaPlayPause: 'MediaPlayPause',
  };
  const key = /^Key[A-Z]$/.test(e.code) ? e.code.slice(3)
    : /^Digit\d$/.test(e.code) ? e.code.slice(5)
      : /^Numpad\d$/.test(e.code) ? `num${e.code.slice(6)}`
        : /^F(?:[1-9]|1\d|2[0-4])$/.test(e.code) ? e.code : named[e.code];
  if (!key) return null;
  const altGr = e.getModifierState && e.getModifierState('AltGraph');
  const mods = altGr ? ['AltGr'] : [e.ctrlKey && 'Control', e.altKey && 'Alt', e.shiftKey && 'Shift', e.metaKey && (window.hud.isMac ? 'Command' : 'Super')].filter(Boolean);
  return [...mods, key].join('+');
}

let cancelKeyCapture;
keyBtn.onclick = async () => {
  if (keyBtn.classList.contains('capturing')) { if (cancelKeyCapture) cancelKeyCapture(); return; }
  await window.hud.beginKeyCapture();
  const previous = keyBtn.dataset.key;
  keyBtn.classList.add('capturing');
  keyBtn.textContent = 'press any key or combo… (click to cancel)';
  const onKey = async (e) => {
    e.preventDefault();
    const acc = accelerator(e);
    if (!acc) return; // still waiting for a usable combo
    done((await window.hud.setHotkey(acc)) ? acc : previous);
  };
  const done = async (k, canceled = false) => {
    document.removeEventListener('keydown', onKey, true);
    keyBtn.classList.remove('capturing');
    cancelKeyCapture = null;
    if (canceled) await window.hud.cancelKeyCapture();
    showKey(k);
  };
  cancelKeyCapture = () => done(previous, true);
  document.addEventListener('keydown', onKey, true);
};
document.getElementById('close').onclick = () => window.hud.hide();
document.getElementById('quit').onclick = () => window.hud.quit();
window.hud.onRefresh(refresh); // main sends 'refresh' every time the overlay opens, including at start
