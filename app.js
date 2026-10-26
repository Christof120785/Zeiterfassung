'use strict';

// ---------- Version ----------
// Bei jeder Änderung: APP_VERSION, version.json und CHANGES aktualisieren.
const APP_VERSION = '1.6.1';
const CHANGES = [
  ['1.6.1', '26.10.2026', 'Schnellwahl um 8,5 h ergänzt'],
  ['1.6.0', '26.10.2026', 'Schnellwahl auf der Startseite: heute 6, 8, 9 oder 10 Stunden ohne Uhrzeit'],
  ['1.5.0', '20.10.2026', 'Versionsnummer und Hinweis bei neuer Version'],
  ['1.4.0', '20.10.2026', 'Urlaub und Krankheit als Zeitraum (von bis) eintragen'],
  ['1.3.0', '15.10.2026', 'Uhrzeiten direkt eintippen (0830 → 08:30)'],
  ['1.2.0', '15.10.2026', 'Abgleich über OneDrive'],
  ['1.1.0', '15.10.2026', 'Feiertage Niedersachsen, Heiligabend und Silvester halber Tag'],
  ['1.0.0', '15.10.2026', 'Erste Version: Stempeln, Uhrzeiten, Stunden, Pause, Übersichten'],
];

// ---------- Daten ----------
const KEY = 'zeiterfassung.v1';
const TYPES = { work: 'Arbeit', urlaub: 'Urlaub', krank: 'Krank', feiertag: 'Feiertag' };
const WD = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
const WDL = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
const PAUSES = [0, 15, 30, 45, 60];

function defaultSettings() {
  return {
    daily: [0, 8, 8, 8, 8, 8, 0], // Sollstunden je Wochentag, Index wie Date.getDay() (0 = Sonntag)
    vacationDays: 30,
    startDate: null,              // Beginn Überstundenkonto; null = erster Eintrag
    carryover: 0,                 // Übertrag Überstunden in Stunden
    format: 'dec',                // 'dec' = 8,50 h, 'hm' = 8:30 h
    quickHours: [6, 8, 8.5, 9, 10], // Schnellwahl auf der Startseite
    holidays: true,               // gesetzliche Feiertage Niedersachsen: Soll entfällt
    halfDays: true,               // Heiligabend und Silvester: halbes Soll (von der Firma geschenkt)
  };
}

function load() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY));
    if (s && s.days) return { ...s, settings: { ...defaultSettings(), ...s.settings } };
  } catch (e) { /* leer starten */ }
  return { version: 1, settings: defaultSettings(), days: {}, updatedAt: 0 };
}

let state = load();
// 1.6.1: bisherige Standard-Schnellwahl um 8,5 h ergänzen
if (String(state.settings.quickHours) === '6,8,9,10') state.settings.quickHours = [6, 8, 8.5, 9, 10];

// Früher manuell als „Feiertag“ eingetragene gesetzliche Feiertage werden jetzt automatisch erkannt
function migrate() {
  if (state.settings.holidaysMigrated) return;
  for (const [k, d] of Object.entries(state.days)) {
    if (d.type === 'feiertag' && holidayInfo(k)?.factor === 0) { delete state.days[k]; tombstone(k); }
  }
  state.settings.holidaysMigrated = true;
  localStorage.setItem(KEY, JSON.stringify(state));
}

function save() {
  state.updatedAt = Date.now();
  try { localStorage.setItem(KEY, JSON.stringify(state)); }
  catch (e) { toast('Speichern fehlgeschlagen'); }
  if (typeof Sync !== 'undefined') Sync.schedule();
}

// Gelöschte Tage merken, damit der Abgleich sie auch auf den anderen Geräten löscht
function tombstone(key) { (state.deleted ||= {})[key] = Date.now(); }

function setDay(key, day) {
  if (day) { state.days[key] = { ...day, updatedAt: Date.now() }; if (state.deleted) delete state.deleted[key]; }
  else { delete state.days[key]; tombstone(key); }
  save();
}

function settingsChanged() { state.settingsAt = Date.now(); save(); }

// ---------- Datum & Zeit ----------
const pad = n => String(n).padStart(2, '0');
const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parse = k => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const todayKey = () => iso(new Date());
const mondayOf = d => addDays(d, -((d.getDay() + 6) % 7));
const nowHM = () => { const d = new Date(); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const toMin = t => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
const nowMin = () => toMin(nowHM());
const shortDate = d => `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.`;
const longDate = d => `${WDL[d.getDay()]}, ${d.getDate()}. ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;

function isoWeek(d) {
  const t = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  t.setDate(t.getDate() + 3 - ((t.getDay() + 6) % 7));
  const w1 = new Date(t.getFullYear(), 0, 4);
  return 1 + Math.round(((t - w1) / 864e5 - 3 + ((w1.getDay() + 6) % 7)) / 7);
}

function fmt(min, signed = false) {
  const sign = min < 0 ? '−' : (signed && min > 0 ? '+' : '');
  const a = Math.abs(Math.round(min));
  const s = state.settings.format === 'hm'
    ? `${Math.floor(a / 60)}:${pad(a % 60)}`
    : (a / 60).toFixed(2).replace('.', ',');
  return `${sign}${s} h`;
}
const cls = m => (m > 0 ? 'plus' : m < 0 ? 'minus' : '');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---------- Berechnung ----------
// ---------- Feiertage Niedersachsen ----------
function easter(y) { // Gaußsche Osterformel (Meeus/Jones/Butcher)
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(y, month - 1, day);
}

const holidayCache = {};
function holidaysOf(y) {
  if (holidayCache[y]) return holidayCache[y];
  const e = easter(y), h = {};
  const add = (d, name, factor = 0) => { h[iso(d)] = { name, factor }; };
  add(new Date(y, 0, 1), 'Neujahr');
  add(addDays(e, -2), 'Karfreitag');
  add(addDays(e, 1), 'Ostermontag');
  add(new Date(y, 4, 1), 'Tag der Arbeit');
  add(addDays(e, 39), 'Christi Himmelfahrt');
  add(addDays(e, 50), 'Pfingstmontag');
  add(new Date(y, 9, 3), 'Tag der Deutschen Einheit');
  add(new Date(y, 9, 31), 'Reformationstag');
  add(new Date(y, 11, 25), '1. Weihnachtstag');
  add(new Date(y, 11, 26), '2. Weihnachtstag');
  add(new Date(y, 11, 24), 'Heiligabend (½ Tag frei)', 0.5);
  add(new Date(y, 11, 31), 'Silvester (½ Tag frei)', 0.5);
  return (holidayCache[y] = h);
}

function holidayInfo(key) {
  const h = holidaysOf(+key.slice(0, 4))[key];
  if (!h) return null;
  if (h.factor === 0 && state.settings.holidays === false) return null;
  if (h.factor > 0 && state.settings.halfDays === false) return null;
  return h;
}

const fullTargetMin = key => Math.round((state.settings.daily[parse(key).getDay()] || 0) * 60);
const targetMin = key => { const h = holidayInfo(key); return Math.round(fullTargetMin(key) * (h ? h.factor : 1)); };

function segMinutes(seg, key) {
  if (!seg.s) return 0;
  let end;
  if (seg.e) end = toMin(seg.e);
  else if (key === todayKey()) end = nowMin();
  else return 0;
  let start = toMin(seg.s);
  if (end < start) end += 1440; // über Mitternacht
  return end - start;
}

// Gutgeschriebene Minuten eines Tages
function credited(key, day = state.days[key]) {
  if (!day) return 0;
  if (day.type !== 'work') return day.hours != null ? Math.round(day.hours * 60) : targetMin(key);
  if (day.hours != null) return Math.round(day.hours * 60);
  const gross = (day.segs || []).reduce((s, g) => s + segMinutes(g, key), 0);
  return Math.max(0, gross - (day.pause || 0));
}

const hasOpen = day => !!day && day.type === 'work' && day.hours == null && (day.segs || []).some(s => s.s && !s.e);

// Soll zählt ab Beginn des Kontos für vergangene Tage immer, für heute erst wenn der Tag abgeschlossen ist
function countsTarget(key) {
  const t = todayKey();
  if (key < accountStart()) return false; // vor Beginn der Erfassung kein Soll
  if (key < t) return true;
  if (key > t) return false;
  const d = state.days[key];
  return !!d && !hasOpen(d);
}

function range(fromKey, toKey) {
  let ist = 0, soll = 0, sollFull = 0, urlaub = 0, krank = 0;
  for (let d = parse(fromKey); iso(d) <= toKey; d = addDays(d, 1)) {
    const k = iso(d);
    ist += credited(k);
    sollFull += targetMin(k);
    if (countsTarget(k)) soll += targetMin(k);
    const day = state.days[k];
    if (day && day.type === 'urlaub') urlaub += dayFraction(k, day);
    if (day && day.type === 'krank') krank += 1;
  }
  return { ist, soll, sollFull, saldo: ist - soll, urlaub, krank };
}

function dayFraction(key, day) {
  const full = fullTargetMin(key);
  if (!full) return 0;
  const mins = day.hours != null ? day.hours * 60 : targetMin(key);
  return Math.min(1, Math.round((mins / full) * 2) / 2);
}

function accountStart() {
  if (state.settings.startDate) return state.settings.startDate;
  const keys = Object.keys(state.days).sort();
  return keys[0] || todayKey();
}

function balance() {
  const r = range(accountStart(), todayKey());
  return Math.round(state.settings.carryover * 60) + r.saldo;
}

function findOpen() {
  const keys = Object.keys(state.days).sort().reverse();
  for (const k of keys) {
    const d = state.days[k];
    if (hasOpen(d)) return { key: k, seg: d.segs.find(s => s.s && !s.e) };
  }
  return null;
}

function describe(key, day) {
  if (!day) return '';
  if (day.type !== 'work') return `<span class="badge ${day.type}">${TYPES[day.type]}</span>${day.note ? esc(day.note) : ''}`;
  const parts = [];
  if (day.hours != null) parts.push('Stunden direkt');
  else {
    parts.push((day.segs || []).map(s => `${s.s || '?'}–${s.e || (key === todayKey() ? 'läuft' : '?')}`).join(', '));
    if (day.pause) parts.push(`P ${day.pause} min`);
  }
  if (day.note) parts.push(esc(day.note));
  const warn = hasOpen(day) && key !== todayKey() ? '<span class="badge warn">Ende fehlt</span>' : '';
  return warn + parts.join(' · ');
}

// ---------- Stempeln ----------
function stampStart() {
  const open = findOpen();
  if (open) { toast(`Läuft bereits seit ${open.seg.s} Uhr`); return; }
  const k = todayKey();
  const d = state.days[k] ? structuredClone(state.days[k]) : { type: 'work', segs: [], pause: 0, hours: null, note: '' };
  if (d.type !== 'work') {
    if (!confirm(`Heute ist als ${TYPES[d.type]} eingetragen. Trotzdem Arbeit starten?`)) return;
    d.type = 'work'; d.hours = null; d.segs = [];
  }
  if (d.hours != null) {
    if (!confirm('Für heute sind Stunden direkt eingetragen. Durch Stempeln ersetzen?')) return;
    d.hours = null;
  }
  d.segs = [...(d.segs || []), { s: nowHM(), e: null }];
  setDay(k, d);
  toast(`Gestartet um ${nowHM()} Uhr`);
  render();
}

function stampStop() {
  const open = findOpen();
  if (!open) { toast('Es läuft gerade keine Arbeitszeit'); return; }
  if (open.key !== todayKey()) {
    toast('Bitte Ende für den offenen Tag eintragen');
    openEditor(open.key);
    return;
  }
  const d = structuredClone(state.days[open.key]);
  d.segs.find(s => s.s && !s.e).e = nowHM();
  d.segs = d.segs.filter(s => s.e !== s.s); // Start und Ende in derselben Minute verwerfen
  setDay(open.key, d);
  toast(`Beendet um ${nowHM()} Uhr · heute ${fmt(credited(open.key))}`);
  render();
}

// Schnellwahl: heute X Stunden ohne Uhrzeiten eintragen
function setTodayHours(h) {
  const k = todayKey();
  const old = state.days[k];
  if (old && old.type === 'work' && old.hours === h) return;
  if (old && (old.type !== 'work' || (old.segs || []).some(x => x.s))) {
    const what = old.type !== 'work' ? TYPES[old.type] : 'Uhrzeiten';
    if (!confirm(`Heute sind ${what} eingetragen. Durch ${fmtNum(h)} Stunden ersetzen?`)) return;
  }
  setDay(k, { type: 'work', hours: h, segs: [], pause: 0, note: old?.note || '' });
  toast(`Heute ${fmtNum(h)} Stunden eingetragen`);
  render();
}
const fmtNum = n => String(n).replace('.', ',');

function setTodayPause(min) {
  const k = todayKey();
  const d = state.days[k] ? structuredClone(state.days[k]) : { type: 'work', segs: [], pause: 0, hours: null, note: '' };
  d.pause = min;
  setDay(k, d);
  render();
}

// ---------- Ansichten ----------
let view = 'today';
let weekAnchor = mondayOf(new Date());
let monthAnchor = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
const $ = s => document.querySelector(s);

function setTitle(t, sub = '') { $('#title').textContent = t; $('#subtitle').textContent = sub; }

function render() {
  document.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  ({ today: renderToday, week: renderWeek, month: renderMonth, settings: renderSettings })[view]();
}

function statsHtml(items) {
  return `<div class="stats">${items.map(([k, v, c = '']) => `<div class="stat"><div class="k">${k}</div><div class="v num ${c}">${v}</div></div>`).join('')}</div>`;
}

function renderToday() {
  const k = todayKey();
  const now = new Date();
  setTitle('Heute', longDate(now));
  const day = state.days[k];
  const open = findOpen();
  const mins = credited(k);

  let clock;
  if (open && open.key === k) {
    clock = `<div class="state">Läuft seit ${open.seg.s} Uhr</div>
      <div class="big num">${fmt(mins)}</div>
      <button class="stamp stop" data-act="stop">Ende stempeln</button>`;
  } else if (open) {
    clock = `<div class="state"><span class="badge warn">Ende fehlt</span> ${longDate(parse(open.key))}, seit ${open.seg.s} Uhr</div>
      <div class="big num">${fmt(mins)}</div>
      <button class="stamp stop" data-act="stop">Ende nachtragen</button>`;
  } else if (day && day.type !== 'work') {
    clock = `<div class="state"><span class="badge ${day.type}">${TYPES[day.type]}</span></div>
      <div class="big num">${fmt(mins)}</div>
      <button class="stamp" data-act="start">Trotzdem Start stempeln</button>`;
  } else {
    clock = `<div class="state">${!day ? 'Noch nicht gestartet' : day.hours != null ? 'Heute eingetragen' : 'Heute bisher'}</div>
      <div class="big num">${fmt(mins)}</div>
      <button class="stamp" data-act="start">Start stempeln</button>`;
  }

  const holToday = holidayInfo(k);
  if (holToday) clock = clock.replace('<div class="state">', `<div class="state"><span class="badge feiertag">${holToday.name}</span> `);
  const showPause = !day || (day.type === 'work' && day.hours == null);
  const pause = day?.pause || 0;
  const wk = range(iso(mondayOf(now)), iso(addDays(mondayOf(now), 6)));
  const bal = balance();

  const importCard = seedAvailable && !Object.keys(state.days).some(x => x < k)
    ? `<section class="card"><h2>Excel-Daten</h2><p style="margin:0 0 10px">Deine Zeiten aus der Excel 2026 sind bereit zur Übernahme.</p>
        <button class="btn primary block" data-act="seed">Excel-Daten 2026 übernehmen</button></section>` : '';
  $('#view').innerHTML = `
    ${importCard}
    <section class="card clock">${clock}</section>
    <section class="card">
      <h2>Heute ohne Uhrzeit</h2>
      <div class="chips">${(state.settings.quickHours || []).map(h => `<button class="chip ${day && day.type === 'work' && day.hours === h ? 'on' : ''}" data-quickhours="${h}">${fmtNum(h)} h</button>`).join('')}</div>
    </section>
    ${showPause ? `<section class="card">
      <div class="row" style="margin-bottom:10px"><h2 style="margin:0">Pause heute</h2><span class="muted num">${pause} min</span></div>
      <div class="chips">${PAUSES.map(p => `<button class="chip ${p === pause ? 'on' : ''}" data-pause="${p}">${p ? p + ' min' : 'keine'}</button>`).join('')}</div>
    </section>` : ''}
    <section class="card">
      ${day ? `<p class="muted" style="margin:0 0 10px">${describe(k, day)}</p>` : ''}
      <div class="btn-row">
        <button class="btn" data-edit="${k}">Heute bearbeiten</button>
        <button class="btn" data-act="other">Anderer Tag / Urlaub</button>
      </div>
    </section>
    <section class="card">
      <h2>Diese Woche · KW ${isoWeek(now)}</h2>
      ${statsHtml([['Ist', fmt(wk.ist)], ['Soll Woche', fmt(wk.sollFull)], ['Überstunden', fmt(bal, true), cls(bal)]])}
      <p class="hint">Überstunden = Kontostand gesamt seit ${shortDate(parse(accountStart()))}${parse(accountStart()).getFullYear()}</p>
    </section>`;
}

function renderWeek() {
  const mon = weekAnchor;
  const sun = addDays(mon, 6);
  setTitle('Woche', `KW ${isoWeek(mon)} · ${shortDate(mon)} – ${shortDate(sun)}${sun.getFullYear()}`);
  const t = todayKey();
  const r = range(iso(mon), iso(sun));
  let rows = '';
  for (let i = 0; i < 7; i++) {
    const d = addDays(mon, i), k = iso(d), day = state.days[k];
    const we = !targetMin(k);
    const hol = holidayInfo(k);
    const c = [we ? 'weekend' : '', k === t ? 'today' : '', k > t && !day ? 'future' : ''].join(' ');
    rows += `<button class="item ${c}" data-edit="${k}">
      <span class="date"><b>${WD[d.getDay()]}</b><small>${shortDate(d)}</small></span>
      <span class="info">${hol ? `<span class="badge feiertag">${hol.name}</span>` : ''}${day ? describe(k, day) : (we || hol ? '' : '—')}</span>
      <span class="h num">${day ? fmt(credited(k)) : ''}</span>
    </button>`;
  }
  $('#view').innerHTML = `
    <div class="nav"><button data-week="-1" aria-label="Vorherige Woche">‹</button>
      <button class="label" data-week="0" style="width:auto;padding:0 14px">Diese Woche</button>
      <button data-week="1" aria-label="Nächste Woche">›</button></div>
    <section class="card list">${rows}
      <div class="sum-row"><span>Summe</span><span class="num">${fmt(r.ist)} / ${fmt(r.sollFull)}</span></div>
    </section>
    <section class="card">${statsHtml([['Ist', fmt(r.ist)], ['Soll bis heute', fmt(r.soll)], ['Saldo', fmt(r.saldo, true), cls(r.saldo)]])}</section>`;
}

function renderMonth() {
  const first = monthAnchor;
  const last = new Date(first.getFullYear(), first.getMonth() + 1, 0);
  setTitle('Monat', `${MONTHS[first.getMonth()]} ${first.getFullYear()}`);
  const r = range(iso(first), iso(last));
  const year = first.getFullYear();
  const yr = range(`${year}-01-01`, `${year}-12-31`);
  let rows = '';
  for (let m = mondayOf(first); m <= last; m = addDays(m, 7)) {
    const from = m < first ? first : m;
    const s = addDays(m, 6), to = s > last ? last : s;
    const w = range(iso(from), iso(to));
    rows += `<button class="item" data-gotoweek="${iso(m)}">
      <span class="date"><b>KW ${isoWeek(m)}</b><small>${shortDate(from)}–${shortDate(to)}</small></span>
      <span class="info">${w.urlaub ? `<span class="badge urlaub">${String(w.urlaub).replace('.', ',')} U</span>` : ''}${w.krank ? `<span class="badge krank">${w.krank} K</span>` : ''}</span>
      <span class="h num">${fmt(w.ist)} <small class="${cls(w.saldo)}">${w.soll ? fmt(w.saldo, true) : ''}</small></span>
    </button>`;
  }
  $('#view').innerHTML = `
    <div class="nav"><button data-month="-1" aria-label="Vorheriger Monat">‹</button>
      <button class="label" data-month="0" style="width:auto;padding:0 14px">Aktueller Monat</button>
      <button data-month="1" aria-label="Nächster Monat">›</button></div>
    <section class="card">${statsHtml([['Ist', fmt(r.ist)], ['Soll bis heute', fmt(r.soll)], ['Saldo', fmt(r.saldo, true), cls(r.saldo)]])}</section>
    <section class="card list">${rows}</section>
    <section class="card"><h2>Jahr ${year}</h2>
      ${statsHtml([['Urlaub genommen', `${String(yr.urlaub).replace('.', ',')} T`], ['Resturlaub', `${String(state.settings.vacationDays - yr.urlaub).replace('.', ',')} T`], ['Krankheitstage', `${yr.krank} T`]])}
      <div style="height:8px"></div>
      ${statsHtml([['Ist Jahr', fmt(yr.ist)], ['Soll bis heute', fmt(yr.soll)], ['Überstunden­konto', fmt(balance(), true), cls(balance())]])}
    </section>`;
}

function renderSettings() {
  setTitle('Einstellungen');
  const s = state.settings;
  const order = [1, 2, 3, 4, 5, 6, 0];
  $('#view').innerHTML = `
    <section class="card"><h2>Sollstunden pro Tag</h2>
      <div class="grid7">${order.map(i => `<label>${WD[i]}<input type="number" inputmode="decimal" min="0" max="24" step="0.25" data-daily="${i}" value="${s.daily[i]}"></label>`).join('')}</div>
      <p class="hint">Wochensoll: ${fmt(s.daily.reduce((a, b) => a + b, 0) * 60)}. An gesetzlichen Feiertagen entfällt das Soll automatisch. Urlaub und Krank zählen mit dem Soll des Tages.</p>
    </section>
    <section class="card"><h2>Konto & Urlaub</h2>
      <label class="field"><span>Urlaubsanspruch pro Jahr (Tage)</span><input type="number" min="0" step="0.5" data-set="vacationDays" value="${s.vacationDays}"></label>
      <label class="field"><span>Überstundenkonto zählt ab</span><input type="date" data-set="startDate" value="${s.startDate || ''}"></label>
      <label class="field" style="display:flex;gap:10px;align-items:center"><input type="checkbox" data-set="holidays" ${s.holidays ? 'checked' : ''} style="width:auto;min-height:0"><span style="margin:0">Gesetzliche Feiertage Niedersachsen (kein Soll)</span></label>
      <label class="field" style="display:flex;gap:10px;align-items:center"><input type="checkbox" data-set="halfDays" ${s.halfDays ? 'checked' : ''} style="width:auto;min-height:0"><span style="margin:0">Heiligabend und Silvester halber Tag frei</span></label>
      <label class="field"><span>Übertrag Überstunden (Stunden, z. B. 12,5 oder −3)</span><input type="text" inputmode="decimal" data-set="carryover" value="${String(s.carryover).replace('.', ',')}"></label>
      <label class="field"><span>Schnellwahl Stunden auf der Startseite (mit Leerzeichen getrennt)</span><input type="text" inputmode="decimal" data-set="quickHours" placeholder="6 8 9 10" value="${(s.quickHours || []).map(fmtNum).join(' ')}"></label>
      <label class="field"><span>Anzeige der Stunden</span>
        <select data-set="format"><option value="dec" ${s.format === 'dec' ? 'selected' : ''}>Dezimal (8,50 h)</option><option value="hm" ${s.format === 'hm' ? 'selected' : ''}>Stunden:Minuten (8:30 h)</option></select></label>
    </section>
    <section class="card"><h2>OneDrive-Abgleich</h2>${typeof Sync !== 'undefined' ? Sync.statusHtml() : ''}</section>
    <section class="card"><h2>Datensicherung</h2>
      ${seedAvailable ? '<button class="btn block" data-act="seed" style="margin-bottom:8px">Excel-Daten 2026 übernehmen</button>' : ''}
      <div class="btn-row">
        <button class="btn" data-act="backup">Sicherung speichern</button>
        <button class="btn" data-act="restore">Sicherung laden</button>
      </div>
      <input type="file" id="restoreFile" accept="application/json,.json" hidden>
      <div style="height:8px"></div>
      <button class="btn danger block" data-act="wipe">Alle Daten löschen</button>
    </section>
    <section class="card"><h2>Version</h2>
      <div class="row" style="margin-bottom:8px"><b>Version ${APP_VERSION}</b><button class="btn" data-act="checkupdate">Nach Update suchen</button></div>
      ${CHANGES.map(([v, d, t]) => `<p class="hint" style="margin:6px 0"><b>${v}</b> · ${d} · ${t}</p>`).join('')}
    </section>
    <p class="hint" style="text-align:center">${Object.keys(state.days).length} Tage gespeichert</p>`;
}

// ---------- Tag bearbeiten ----------
let draft = null;

function openEditor(key) {
  const day = state.days[key];
  draft = day ? structuredClone(day) : { type: 'work', segs: [{ s: '', e: '' }], pause: 0, hours: null, note: '' };
  draft.key = key;
  draft.mode = draft.hours != null ? 'hours' : 'times';
  draft.exists = !!day;
  draft.altHours = draft.type !== 'work' && draft.hours != null;
  if (!draft.segs || !draft.segs.length) draft.segs = [{ s: '', e: '' }];
  renderEditor();
  const dlg = $('#editor');
  if (!dlg.open) dlg.showModal();
}

function draftDay() {
  const d = { type: draft.type, note: (draft.note || '').trim() };
  if (draft.type === 'work') {
    if (draft.mode === 'hours') { d.hours = draft.hours; d.segs = []; d.pause = 0; }
    else {
      d.hours = null;
      d.segs = draft.segs.filter(s => s.s).map(s => ({ s: s.s, e: s.e || null }));
      d.pause = draft.pause || 0;
    }
  } else {
    d.hours = draft.altHours ? draft.hours : null;
    d.segs = []; d.pause = 0;
  }
  return d;
}

function renderEditor() {
  const k = draft.key, d = parse(k);
  const isWork = draft.type === 'work';
  const hol = holidayInfo(k);
  let body = `
    ${hol ? `<p style="margin:0 0 12px"><span class="badge feiertag">${hol.name}</span> <span class="muted">Soll an diesem Tag: ${fmt(targetMin(k))}</span></p>` : ''}
    <label class="field"><span>Datum</span><input type="date" id="edDate" value="${k}"></label>
    <div class="segmented" role="tablist">${Object.entries(TYPES).map(([t, l]) => `<button type="button" data-type="${t}" class="${draft.type === t ? 'on' : ''}">${l}</button>`).join('')}</div>`;

  if (isWork) {
    body += `<div class="segmented"><button type="button" data-mode="times" class="${draft.mode === 'times' ? 'on' : ''}">Uhrzeiten</button><button type="button" data-mode="hours" class="${draft.mode === 'hours' ? 'on' : ''}">Stunden</button></div>`;
    if (draft.mode === 'times') {
      body += draft.segs.map((s, i) => `<div class="seg">
          <input type="text" inputmode="numeric" autocomplete="off" maxlength="5" placeholder="08:00" data-seg="${i}" data-f="s" value="${s.s || ''}" aria-label="Beginn">
          <span class="muted">bis</span>
          <input type="text" inputmode="numeric" autocomplete="off" maxlength="5" placeholder="17:00" data-seg="${i}" data-f="e" value="${s.e || ''}" aria-label="Ende">
          <button type="button" class="x" data-delseg="${i}" aria-label="Zeitraum entfernen">×</button>
        </div>`).join('') +
        `<button type="button" class="btn" data-addseg style="margin-bottom:14px">+ weiterer Zeitraum</button>
        <label class="field"><span>Pause (Minuten)</span><input type="number" inputmode="numeric" min="0" step="5" id="edPause" value="${draft.pause || 0}"></label>
        <div class="chips" style="margin:-4px 0 12px">${PAUSES.map(p => `<button type="button" class="chip ${p === (draft.pause || 0) ? 'on' : ''}" data-edpause="${p}">${p ? p + ' min' : 'keine'}</button>`).join('')}</div>`;
    } else {
      body += `<label class="field"><span>Arbeitsstunden (netto)</span><input type="text" inputmode="decimal" id="edHours" placeholder="z. B. 8,5 oder 8:30" value="${draft.hours != null ? String(draft.hours).replace('.', ',') : ''}"></label>`;
    }
  } else {
    body += `<label class="field"><span>Bis einschließlich (für mehrere Tage, optional)</span><input type="date" id="edUntil" min="${k}" value="${draft.until || ''}"></label>
      <p class="hint" id="edRangeInfo" style="margin:-4px 0 12px">${rangeInfo()}</p>
      <label class="field" style="display:flex;gap:10px;align-items:center"><input type="checkbox" id="edAlt" ${draft.altHours ? 'checked' : ''} style="width:auto;min-height:0">
        <span style="margin:0">Abweichende Stunden (z. B. halber Tag)</span></label>
      ${draft.altHours ? `<label class="field"><span>Stunden</span><input type="text" inputmode="decimal" id="edHours" placeholder="z. B. 4" value="${draft.hours != null ? String(draft.hours).replace('.', ',') : ''}"></label>` : `<p class="hint" style="margin:-4px 0 12px">Zählt mit dem Tagessoll von ${fmt(targetMin(k))}.</p>`}`;
  }
  body += `<label class="field"><span>Notiz (Kunde, Ort …)</span><input type="text" id="edNote" value="${esc(draft.note)}"></label>
    <div class="result"><span class="muted">Arbeitszeit</span><b class="num" id="edResult">${fmt(credited(k, draftDay()))}</b></div>`;

  $('#editor').innerHTML = `
    <form method="dialog" id="edForm">
      <div class="dlg-head"><h3>${longDate(d)}</h3><button type="button" class="btn" data-close aria-label="Schließen">✕</button></div>
      <div class="dlg-body">${body}</div>
      <div class="dlg-foot">
        ${draft.exists ? '<button type="button" class="btn danger" data-delday>Löschen</button>' : ''}
        <button type="submit" class="btn primary">Speichern</button>
      </div>
    </form>`;
}

// Eingetippte Uhrzeit in HH:MM umwandeln; ungültig → ''
function normTime(v) {
  const m = String(v).trim().match(/^(\d{1,2})(?::(\d{1,2}))?$/);
  if (!m) return '';
  const h = +m[1], min = m[2] == null ? 0 : +m[2];
  if (h > 23 || min > 59 || (m[2] != null && m[2].length < 2)) return '';
  return `${pad(h)}:${pad(min)}`;
}

// Arbeitstage (mit Soll) im gewählten Zeitraum; Wochenenden und Feiertage zählen nicht
function rangeDays(from, to) {
  const out = [];
  for (let d = parse(from); iso(d) <= to && out.length < 400; d = addDays(d, 1)) if (targetMin(iso(d)) > 0) out.push(iso(d));
  return out;
}

function rangeInfo() {
  if (!draft.until || draft.until <= draft.key) return '';
  const n = rangeDays(draft.key, draft.until).length;
  return `${shortDate(parse(draft.key))} bis ${shortDate(parse(draft.until))}: ${n} Arbeitstag${n === 1 ? '' : 'e'} (Wochenenden und Feiertage werden übersprungen)`;
}

function parseHours(v) {
  v = String(v).trim();
  if (!v) return null;
  if (v.includes(':')) { const [h, m] = v.split(':').map(Number); return isNaN(h) ? NaN : h + (m || 0) / 60; }
  return Number(v.replace(',', '.'));
}

function updateResult() {
  const el = $('#edResult');
  if (el) el.textContent = fmt(credited(draft.key, draftDay()));
}

$('#editor').addEventListener('input', e => {
  const t = e.target;
  if (t.dataset.seg != null) {
    // Doppelpunkt automatisch setzen: 830 → 8:30, 1745 → 17:45
    const digits = t.value.replace(/\D/g, '').slice(0, 4);
    t.value = digits.length >= 3 ? `${digits.slice(0, -2)}:${digits.slice(-2)}` : digits;
    draft.segs[+t.dataset.seg][t.dataset.f] = normTime(t.value);
  }
  else if (t.id === 'edPause') {
    draft.pause = Math.max(0, parseInt(t.value, 10) || 0);
    document.querySelectorAll('[data-edpause]').forEach(c => c.classList.toggle('on', +c.dataset.edpause === draft.pause));
  }
  else if (t.id === 'edHours') { const h = parseHours(t.value); draft.hours = h == null || isNaN(h) ? null : Math.round(h * 100) / 100; }
  else if (t.id === 'edNote') draft.note = t.value;
  else if (t.id === 'edUntil') { draft.until = t.value; $('#edRangeInfo').textContent = rangeInfo(); }
  updateResult();
});

$('#editor').addEventListener('change', e => {
  const t = e.target;
  if (t.dataset.seg != null) { const n = normTime(t.value); if (n) t.value = n; }
  if (t.id === 'edDate' && t.value && t.value !== draft.key) {
    // Bei leerem Zieltag gewählte Art (z. B. Urlaub) und Zeitraum behalten
    const keep = !state.days[t.value] && draft.type !== 'work' ? { type: draft.type, until: draft.until > t.value ? draft.until : '', altHours: draft.altHours, hours: draft.hours } : null;
    openEditor(t.value);
    if (keep) { Object.assign(draft, keep); renderEditor(); }
  } else if (t.id === 'edAlt') {
    draft.altHours = t.checked;
    if (!t.checked) draft.hours = null;
    renderEditor();
  }
});

$('#editor').addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.type) {
    if (draft.type === 'work' && b.dataset.type !== 'work') { draft.hours = null; draft.altHours = false; }
    if (draft.type !== 'work' && b.dataset.type === 'work') { draft.hours = null; draft.mode = 'times'; }
    draft.type = b.dataset.type; renderEditor();
  }
  else if (b.dataset.mode) { draft.mode = b.dataset.mode; renderEditor(); }
  else if (b.dataset.edpause != null) { draft.pause = +b.dataset.edpause; renderEditor(); }
  else if (b.hasAttribute('data-addseg')) { draft.segs.push({ s: '', e: '' }); renderEditor(); }
  else if (b.dataset.delseg != null) { draft.segs.splice(+b.dataset.delseg, 1); if (!draft.segs.length) draft.segs.push({ s: '', e: '' }); renderEditor(); }
  else if (b.hasAttribute('data-close')) $('#editor').close();
  else if (b.hasAttribute('data-delday')) {
    if (confirm('Eintrag für diesen Tag löschen?')) { setDay(draft.key, null); $('#editor').close(); toast('Gelöscht'); render(); }
  }
});

$('#editor').addEventListener('submit', e => {
  e.preventDefault();
  const d = draftDay();
  if (d.type === 'work') {
    if (draft.mode === 'hours' && (d.hours == null || isNaN(d.hours) || d.hours < 0 || d.hours > 24)) { toast('Bitte gültige Stunden eingeben'); return; }
    if (draft.mode === 'times') {
      if (!d.segs.length) { toast('Bitte mindestens eine Startzeit eingeben'); return; }
      const openSegs = d.segs.filter(s => !s.e);
      if (openSegs.length > 1 || (openSegs.length && draft.key !== todayKey())) { toast('Bitte Endzeit eingeben'); return; }
      const gross = d.segs.reduce((s, g) => s + segMinutes(g, draft.key), 0);
      if (d.pause > gross && !openSegs.length) { toast('Pause ist länger als die Arbeitszeit'); return; }
    }
  } else if (draft.altHours && (d.hours == null || isNaN(d.hours) || d.hours < 0 || d.hours > 24)) { toast('Bitte gültige Stunden eingeben'); return; }

  // Zeitraum (Urlaub, Krank, Feiertag über mehrere Tage)
  if (d.type !== 'work' && draft.until && draft.until !== draft.key) {
    if (draft.until < draft.key) { toast('„Bis“ liegt vor dem Startdatum'); return; }
    const keys = rangeDays(draft.key, draft.until);
    if (!keys.length) { toast('Im Zeitraum liegen keine Arbeitstage'); return; }
    const taken = keys.filter(k => state.days[k] && !(state.days[k].type === d.type && state.days[k].hours === d.hours));
    if (taken.length && !confirm(`${taken.length} Tag${taken.length === 1 ? ' hat' : 'e haben'} schon Einträge (z. B. ${shortDate(parse(taken[0]))}). Überschreiben?`)) return;
    const now = Date.now();
    for (const k of keys) { state.days[k] = { ...d, updatedAt: now }; if (state.deleted) delete state.deleted[k]; }
    save();
    $('#editor').close();
    toast(`${TYPES[d.type]} für ${keys.length} Tag${keys.length === 1 ? '' : 'e'} eingetragen`);
    render();
    return;
  }
  setDay(draft.key, d);
  $('#editor').close();
  toast('Gespeichert');
  render();
});

// ---------- Globale Aktionen ----------
document.addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b || b.closest('#editor')) return;
  if (b.dataset.view) { view = b.dataset.view; render(); window.scrollTo(0, 0); return; }
  if (b.dataset.edit) { openEditor(b.dataset.edit); return; }
  if (b.dataset.pause != null) { setTodayPause(+b.dataset.pause); return; }
  if (b.dataset.quickhours != null) { setTodayHours(+b.dataset.quickhours); return; }
  if (b.dataset.week != null) { weekAnchor = +b.dataset.week ? addDays(weekAnchor, 7 * b.dataset.week) : mondayOf(new Date()); render(); return; }
  if (b.dataset.month != null) {
    monthAnchor = +b.dataset.month ? new Date(monthAnchor.getFullYear(), monthAnchor.getMonth() + +b.dataset.month, 1) : new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    render(); return;
  }
  if (b.dataset.gotoweek) { weekAnchor = parse(b.dataset.gotoweek); view = 'week'; render(); return; }
  switch (b.dataset.act) {
    case 'start': stampStart(); break;
    case 'stop': stampStop(); break;
    case 'other': openEditor(iso(addDays(new Date(), -1))); break;
    case 'seed': importSeed(); break;
    case 'checkupdate': checkUpdate(true); break;
    case 'doupdate': doUpdate(); break;
    case 'backup': backup(); break;
    case 'restore': $('#restoreFile').click(); break;
    case 'wipe':
      if (confirm('Wirklich alle Einträge und Einstellungen löschen? Bei OneDrive-Abgleich auch auf allen anderen Geräten.') && confirm('Sicher? Das lässt sich nicht rückgängig machen.')) {
        const keys = Object.keys(state.days);
        state = { ...load(), days: {}, settings: defaultSettings(), settingsAt: Date.now(), deleted: {} };
        for (const k of keys) tombstone(k);
        save(); render(); toast('Alle Daten gelöscht');
      }
      break;
  }
});

document.addEventListener('change', e => {
  const t = e.target;
  if (t.closest('#editor')) return;
  if (t.dataset.daily != null) {
    const v = parseFloat(String(t.value).replace(',', '.'));
    state.settings.daily[+t.dataset.daily] = isNaN(v) ? 0 : Math.min(24, Math.max(0, v));
  } else if (t.dataset.set) {
    const k = t.dataset.set;
    if (k === 'vacationDays') state.settings.vacationDays = Math.max(0, parseFloat(t.value) || 0);
    else if (k === 'startDate') state.settings.startDate = t.value || null;
    else if (k === 'carryover') state.settings.carryover = parseFloat(t.value.replace('−', '-').replace(',', '.')) || 0;
    else if (k === 'format') state.settings.format = t.value;
    else if (k === 'quickHours') state.settings.quickHours = t.value.split(/[\s;]+/).map(v => parseFloat(v.replace(',', '.'))).filter(v => v > 0 && v <= 24).slice(0, 8);
    else if (k === 'holidays' || k === 'halfDays') state.settings[k] = t.checked;
  } else if (t.id === 'restoreFile' && t.files[0]) {
    restore(t.files[0]); return;
  } else return;
  settingsChanged(); render(); toast('Gespeichert');
});

function backup() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `zeiterfassung-sicherung-${todayKey()}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

async function restore(file) {
  try {
    const data = JSON.parse(await file.text());
    if (!data || typeof data.days !== 'object') throw new Error('format');
    if (!confirm(`Sicherung mit ${Object.keys(data.days).length} Tagen laden? Die aktuellen Daten werden ersetzt.`)) return;
    const now = Date.now();
    const removed = Object.keys(state.days).filter(k => !data.days[k]);
    state = { ...data, settings: { ...defaultSettings(), ...data.settings }, settingsAt: now, deleted: {} };
    for (const k of Object.keys(state.days)) state.days[k] = { ...state.days[k], updatedAt: now };
    for (const k of removed) state.deleted[k] = now;
    save(); render(); toast('Sicherung geladen');
  } catch (e) { toast('Datei ist keine gültige Sicherung'); }
}

// Einmalige Übernahme der umgewandelten Excel (import-2026.json liegt nur in der privaten Vorschau)
let seedAvailable = false;
fetch('import-2026.json', { cache: 'no-store' })
  .then(r => r.ok ? r.json() : null)
  .then(d => { if (d && d.days) { seedAvailable = d; render(); } })
  .catch(() => {});

function importSeed() {
  const seed = seedAvailable;
  const keys = Object.keys(seed.days);
  const fresh = keys.filter(k => !state.days[k]);
  if (!confirm(`${fresh.length} Tage aus der Excel übernehmen? Bereits in der App eingetragene Tage bleiben unverändert.`)) return;
  for (const k of fresh) state.days[k] = { ...seed.days[k], updatedAt: Date.now() };
  if (!state.settings.startDate && seed.settings && seed.settings.startDate) { state.settings.startDate = seed.settings.startDate; state.settingsAt = Date.now(); }
  for (const k of fresh) if (state.deleted) delete state.deleted[k];
  save(); render();
  toast(`${fresh.length} Tage übernommen`);
}

let toastTimer;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

// ---------- Updates ----------
// version.json liegt neben der App; ist dort eine neuere Version, erscheint ein Hinweis
let newVersion = null;
const newer = (a, b) => { const x = a.split('.').map(Number), y = b.split('.').map(Number); for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); return false; };

async function checkUpdate(manual = false) {
  try {
    const r = await fetch(`version.json?t=${Date.now()}`, { cache: 'no-store' });
    const { version } = await r.json();
    if (newer(version, APP_VERSION)) { newVersion = version; showUpdateBanner(); }
    else if (manual) toast(`Du hast die neueste Version (${APP_VERSION})`);
  } catch (e) { if (manual) toast('Keine Verbindung, Update-Prüfung nicht möglich'); }
}

function showUpdateBanner() {
  let el = $('#updateBanner');
  if (!el) {
    el = document.createElement('div');
    el.id = 'updateBanner';
    document.body.insertBefore(el, $('#view'));
  }
  el.innerHTML = `<span>Neue Version ${newVersion} verfügbar (du hast ${APP_VERSION})</span><button class="btn primary" data-act="doupdate">Aktualisieren</button>`;
}

async function doUpdate() {
  try {
    const regs = await navigator.serviceWorker?.getRegistrations() || [];
    await Promise.all(regs.map(r => r.unregister()));
    const keys = await caches.keys();
    await Promise.all(keys.map(k => caches.delete(k)));
  } catch (e) { /* trotzdem neu laden */ }
  location.replace(`${location.pathname}?v=${newVersion || Date.now()}`);
}

// ---------- Start ----------
// Schnellaktionen vom Homescreen-Icon (lange drücken): ?action=start | ?action=stop
const params = new URLSearchParams(location.search);
const action = params.get('action');
migrate();
if (action || params.has('v')) history.replaceState(null, '', location.pathname);
render();
if (action === 'start') stampStart();
if (action === 'stop') stampStop();

// Laufende Zeit jede halbe Minute aktualisieren (nicht während der Bearbeitung)
setInterval(() => { if (view === 'today' && !$('#editor').open) render(); }, 30000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) { checkUpdate(); if (!$('#editor').open) render(); } });
checkUpdate();
window.addEventListener('storage', e => { if (e.key === KEY) { state = load(); render(); } });

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
