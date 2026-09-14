'use strict';
/* KAC タイムスケジュール作成ツール
 * 編集 / 閲覧 / 本番進行 の3モード。データはブラウザ(localStorage)に自動保存、
 * JSON・Excel書き出し、URL埋め込み共有に対応。サーバー不要。
 */

// ===== utilities =====
const STORAGE_KEY = 'kac_ts_v1';
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
const uid = () => Math.random().toString(36).slice(2, 9);
const toMin = t => { if (!t) return 0; const [h, m] = String(t).split(':').map(Number); return (h || 0) * 60 + (m || 0); };
const fmt = m => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const WD = ['日', '月', '火', '水', '木', '金', '土'];
const parseDate = iso => { if (!iso) return null; const d = new Date(iso + 'T00:00:00'); return isNaN(d) ? null : d; };
const isoOf = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const todayISO = () => isoOf(new Date());
const mdLabel = iso => { const d = parseDate(iso); return d ? `${d.getMonth() + 1}/${d.getDate()}` : (iso || ''); };
const wdLabel = iso => { const d = parseDate(iso); return d ? `(${WD[d.getDay()]})` : ''; };
const addDays = (iso, n) => { const d = parseDate(iso); if (!d) return iso; d.setDate(d.getDate() + n); return isoOf(d); };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }

const PALETTE = [
  { name: '白', bg: '#FFFFFF' }, { name: '黄', bg: '#FFF100' }, { name: '緑', bg: '#3DDC3D' }, { name: '赤', bg: '#E06666' },
  { name: '青', bg: '#8FC9F5' }, { name: '橙', bg: '#FFB347' }, { name: '桃', bg: '#F8B4D9' }, { name: '紫', bg: '#C9A7F0' },
  { name: '薄黄', bg: '#FFF4B3' }, { name: '薄緑', bg: '#C6EFCE' }, { name: '灰', bg: '#C8C8C8' }, { name: '濃灰', bg: '#8A8A8A' }
];

// ===== ベース（運営 / 設営） =====
// それぞれ独立した作業データとして保存される
const BASES = {
  // 運営：行＝事業（イベント）。フェーズのセルに担当スタッフ名を表示（チャットで作成した timeschedule_generator.py と同じ形）
  ops: {
    name: '運営', key: 'kac_ts_v1_ops', formStyle: 'byEvent', staffColumn: true,
    lanes: ['（事業名）\n（場所）'],
    settings: { startHour: 9, endHour: 23, slot: 30, openTime: '', closeTime: '' },
    // スタッフのひな形は空（使う人が定まったらここに入れる）
    form: { technical: [], personnel: [], events: [] },
    formSample: () => window.KAC_OPS_SAMPLE.form,
    sample: () => window.KAC_OPS_SAMPLE, sampleName: '9月イベント', generate: true
  },
  // 設営：行＝セクション（舞台/照明/音響…）。フォームからは事業行＋担当者行を生成
  setup: {
    name: '設営', key: 'kac_ts_v1_setup', formStyle: 'byStaff',
    lanes: ['舞台', '照明', '音響', '出演者', '制作', 'KAC'],
    settings: { startHour: 9, endHour: 23, slot: 30, openTime: '09:30', closeTime: '22:00' },
    form: { technical: [], personnel: [], events: [] },
    formSample: () => window.KAC_FORM_SAMPLE,
    sample: () => window.KAC_SAMPLE, sampleName: '空のひな形'
  }
};
// 「担当」列を表示するか（運営ベース、または担当が入力されている行があるとき）
function showStaffCol() { return !!(BASES[state.base].staffColumn || state.days.some(d => d.lanes.some(l => l.staff))); }
const normLane = l => typeof l === 'string' ? { id: uid(), name: l, staff: '', loc: '' } : { id: l.id || uid(), name: l.name || '', staff: l.staff || '', loc: l.loc || '', gen: !!l.gen, grp: l.grp || '' };
// 「場所」列：場所ごとに行を分けた日があるときだけ表示
function showLocCol() { return state.days.some(d => d.lanes.some(l => l.loc)); }
const cloneLanes = lanes => lanes.map(l => Object.assign({}, l, { id: uid() }));
// サンプルを state として読み込む（generate 付きのベースは入力フォームから表を生成）
function sampleState(kind) {
  const st = normalize(BASES[kind].sample());
  if (BASES[kind].generate) { const prev = state; state = st; applyForm(); state = prev; }
  return st;
}
const BASE_KEY = 'kac_ts_base';
let base = 'ops';

// ===== state =====
let state = null;
let mode = 'edit';          // edit | view | live
let undoStack = [];
let selectedId = null;      // 選択中ブロックid
let liveDayId = null;
let saveTimer = null;

function newState(kind = base) {
  const t = BASES[kind] || BASES.ops;
  return {
    version: 1, base: kind,
    meta: { program: '', title: '', dates: '', venue: '', updated: todayISO() },
    settings: Object.assign({}, t.settings),
    lanes: t.lanes.map(n => ({ id: uid(), name: n, staff: '' })),
    days: [{ id: uid(), date: todayISO(), label: '', notes: '', blocks: [], lanes: t.lanes.map(n => ({ id: uid(), name: n, staff: '' })) }],
    notes: '',
    form: JSON.parse(JSON.stringify(t.form))
  };
}

function normalize(d) {
  const kind = BASES[d && d.base] ? d.base : base;
  const base_ = newState(kind);
  const s = Object.assign({}, base_, d || {});
  s.base = kind;
  s.meta = Object.assign({}, base_.meta, s.meta || {});
  s.settings = Object.assign({}, base_.settings, s.settings || {});
  s.settings.startHour = clamp(+s.settings.startHour || 9, 0, 23);
  s.settings.endHour = clamp(+s.settings.endHour || 23, s.settings.startHour + 1, 24);
  s.settings.slot = [15, 30, 60].includes(+s.settings.slot) ? +s.settings.slot : 30;
  // s.lanes は「新しい日のひな形」。行の実体は日ごと（day.lanes）に持つ
  s.lanes = (s.lanes || []).map(normLane);
  if (!s.lanes.length) s.lanes = base_.lanes;
  s.days = (s.days || []).map(day => {
    const lanes = (day.lanes && day.lanes.length) ? day.lanes.map(normLane) : cloneLanes(s.lanes);
    return {
    id: day.id || uid(), date: day.date || '', label: day.label || '', notes: day.notes || '', gen: !!day.gen, genLabel: !!day.genLabel,
    open: day.open || '', close: day.close || '', // 日ごとの利用時間（空なら設定の共通値）
    lanes,
    blocks: (day.blocks || []).map(b => ({
      id: b.id || uid(), start: b.start || '09:00', end: b.end || '10:00',
      lane0: clamp(+b.lane0 || 0, 0, lanes.length - 1),
      lane1: clamp(+(b.lane1 ?? b.lane0) || 0, 0, lanes.length - 1),
      text: b.text || '', bg: b.bg || '#FFFFFF', fg: b.fg || '#000000',
      bold: b.bold !== false, size: b.size || 'm', vertical: !!b.vertical, gen: b.gen || null, half: !!b.half, ptype: PHASE_COLORS[b.ptype] ? b.ptype : null
    }))
  }; });
  if (!s.days.length) s.days = base_.days;
  s.notes = s.notes || '';
  s.form = normalizeForm(s.form);
  return s;
}
function normalizeForm(f) {
  f = f || {};
  const names = a => (Array.isArray(a) ? a : []).map(x => String(x).trim()).filter(Boolean);
  return {
    technical: names(f.technical), personnel: names(f.personnel),
    type: EVENT_TYPES[f.type] ? f.type : 'stage', // 設営：公演の種別（全日程共通）
    // 運営：テクニカルの行動（MT・休憩など）。日付ごとに「テクニカル」行を作って表示
    techActions: (f.techActions || []).map(a => ({
      id: a.id || uid(), date: a.date || '', type: TECH_ACTION_TYPES[a.type] ? a.type : 'mt', label: a.label || '',
      startTime: a.startTime || '09:30', endTime: a.endTime || '10:00', technical: names(a.technical), style: a.style && typeof a.style === 'object' ? a.style : null
    })),
    events: (f.events || []).map(e => ({
      id: e.id || uid(), date: e.date || '', name: e.name || '', type: EVENT_TYPES[e.type] ? e.type : 'stage', location: e.location || '',
      start: e.start || '', end: e.end || '', // その日の利用時間（入り〜退館）
      label: e.label || '', // 日程の名称（仕込み／本番① など）→ 表の日ラベル
      phases: (e.phases || []).map(p => ({
        id: p.id || uid(), type: PHASE_COLORS[p.type] ? p.type : 'setup', label: p.label || '',
        startTime: p.startTime || '10:00', endTime: p.endTime || '12:00',
        technical: names(p.technical), personnel: names(p.personnel),
        location: p.location || '', // 運営：フェーズごとの場所（空欄ならイベントの場所）
        style: p.style && typeof p.style === 'object' ? p.style : null // 表の上で変えた色などを保持
      }))
    }))
  };
}
// Python版と同じ定義：イベント種別ごとのフェーズ名、フェーズ種別ごとの色
const EVENT_TYPES = {
  stage: { name: '舞台', setup: '仕込み', performance: '本番', teardown: '撤収', break: '休憩' },
  exhibition: { name: '展覧会', setup: '搬入', performance: '開催', teardown: '搬出', break: '休憩' },
  workshop: { name: 'WS', setup: '準備', performance: '開催', teardown: '片付け', break: '休憩' },
  talk: { name: 'トーク', setup: '準備', performance: 'トーク', teardown: '片付け', break: '休憩' }
};
const PHASE_TYPES = ['setup', 'performance', 'teardown', 'break'];
const PHASE_COLORS = { setup: '#FFEB99', performance: '#C6EFCE', teardown: '#FFC7CE', break: '#DDDDDD' };
const TECH_ACTION_TYPES = { mt: { name: 'MT', bg: '#DCEBFA' }, break: { name: '休憩', bg: '#DDDDDD' }, other: { name: 'その他', bg: '#FFFFFF' } };
const LABEL_PRESETS = ['仕込み', '準備', '搬入', '朝MT', 'システムチェック', 'リハ準備', 'リハーサル', 'テクリハ', '通し', 'GP', 'プリセット', '開場', '本番', 'トーク', '休憩', '昼休憩', '撤収', 'バラシ', '搬出', '清掃', '退館'];
const PHASE_GENERIC = { setup: '仕込み・準備', performance: '本番・開催', teardown: '撤収・片付け', break: '休憩' };

function save() { try { localStorage.setItem(BASES[state.base].key, JSON.stringify(state)); } catch (e) { /* ignore */ } }
function saveSoon() { clearTimeout(saveTimer); saveTimer = setTimeout(save, 300); }
function load(kind) {
  try {
    let raw = localStorage.getItem(BASES[kind].key);
    if (!raw && kind === 'setup') raw = localStorage.getItem(STORAGE_KEY); // 旧バージョンのデータ
    if (raw) { const d = JSON.parse(raw); d.base = kind; return normalize(d); }
  } catch (e) { /* ignore */ }
  return null;
}
function switchBase(kind, opts = {}) {
  if (!BASES[kind]) return;
  const carryForm = state && opts.carryForm ? JSON.parse(JSON.stringify(state.form)) : null;
  if (state) save();
  base = kind;
  try { localStorage.setItem(BASE_KEY, kind); } catch (e) { /* ignore */ }
  if (opts.state) state = opts.state;
  else state = load(kind) || sampleState(kind);
  if (carryForm) state.form = carryForm;
  // フォーム由来のブロックは読み込み時に作り直す（生成ルールが更新されても古い表示が残らないように）
  if (state.form && (state.form.events.length || state.form.techActions.length)) {
    const u = state.meta.updated; applyForm(); state.meta.updated = u; save();
  }
  undoStack = []; $('#btnUndo').disabled = true;
  selectedId = null; liveDayId = null;
  closeEditor(); render(); renderForm();
}
function openSide(open) {
  document.body.classList.toggle('side-closed', !open);
  try { localStorage.setItem('kac_ts_side', open ? 'open' : 'closed'); } catch (e) { /* ignore */ }
}
function pushHistory(snapshot) {
  undoStack.push(snapshot || JSON.stringify(state));
  if (undoStack.length > 80) undoStack.shift();
  $('#btnUndo').disabled = false;
}
function undo() {
  if (!undoStack.length) return;
  state = normalize(JSON.parse(undoStack.pop()));
  $('#btnUndo').disabled = !undoStack.length;
  save(); closeEditor(); render(); renderForm(); toast('元に戻しました');
}
// 変更をまとめて行うヘルパー：履歴保存 → 変更 → 保存 → 再描画
function commit(fn) { pushHistory(); fn(); save(); render(); renderForm(); }

function toast(msg, ms = 1800) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(t._tm); t._tm = setTimeout(() => { t.hidden = true; }, ms);
}

// ===== geometry helpers =====
function gridInfo(day) {
  const s = state.settings;
  const start = s.startHour * 60, end = s.endHour * 60;
  return { start, end, total: end - start, slot: s.slot, slots: (end - start) / s.slot, hours: s.endHour - s.startHour, rows: day ? day.lanes.length : 0 };
}
function pct(min) { const g = gridInfo(); return clamp((min - g.start) / g.total * 100, 0, 100); }
function findBlock(id) {
  for (const day of state.days) { const b = day.blocks.find(x => x.id === id); if (b) return { day, block: b }; }
  return null;
}
function firstLine(t) { return (t || '').split('\n')[0] || '(無題)'; }
function laneRange(day, b) {
  const a = day.lanes[b.lane0]?.name || '', c = day.lanes[b.lane1]?.name || '';
  return b.lane0 === b.lane1 ? a : `${a}〜${c}`;
}

// ===== rendering =====
function render() {
  document.body.dataset.mode = mode;
  document.body.dataset.base = state.base;
  $('#baseBadge').textContent = BASES[state.base].name;
  document.body.classList.toggle('has-staff', showStaffCol());
  document.body.classList.toggle('has-loc', showLocCol());
  $$('#modeSeg button').forEach(b => b.classList.toggle('on', b.dataset.mode === mode));
  const sheet = $('#sheet');
  sheet.innerHTML = '';
  sheet.appendChild(renderMeta());
  state.days.forEach((day, di) => sheet.appendChild(renderDay(day, di)));
  sheet.appendChild(renderNotes());
  if (selectedId) $(`.block[data-id="${selectedId}"]`)?.classList.add('sel');
  $$('textarea.ed:not([data-fixed])', sheet).forEach(autoGrow);
  updateLive();
}

// 編集モードでは入力欄、それ以外はテキスト表示
function editable(tag, value, onInput, opt = {}) {
  if (mode !== 'edit') {
    const d = el('div', (opt.cls || '') + ' txt');
    d.textContent = value || '';
    if (!value) d.classList.add('empty');
    return d;
  }
  const i = el(tag, (opt.cls || '') + ' ed');
  if (opt.type) i.type = opt.type;
  i.value = value || '';
  if (opt.placeholder) i.placeholder = opt.placeholder;
  if (tag === 'textarea') { i.rows = opt.rows || 1; i.addEventListener('input', () => { if (!i.dataset.fixed) autoGrow(i); }); }
  i.addEventListener('focus', () => { i._snap = JSON.stringify(state); });
  i.addEventListener('input', () => { if (i._snap) { pushHistory(i._snap); i._snap = null; } onInput(i.value); saveSoon(); });
  if (opt.onChange) i.addEventListener('change', () => opt.onChange(i.value));
  return i;
}
function autoGrow(t) { t.style.height = 'auto'; t.style.height = (t.scrollHeight + 2) + 'px'; }

function renderMeta() {
  const m = state.meta;
  const box = el('div', 'meta');
  box.appendChild(editable('input', m.program, v => m.program = v, { cls: 'program', placeholder: 'プログラム名（例：Co-program カテゴリーA採択事業）' }));
  box.appendChild(editable('input', m.title, v => m.title = v, { cls: 'title', placeholder: '公演タイトル' }));
  box.appendChild(editable('input', m.dates, v => m.dates = v, { cls: 'dates', placeholder: '公演日程（例：2026年8月29日(土)ー30日(日)）' }));
  box.appendChild(editable('input', m.venue, v => m.venue = v, { cls: 'venue', placeholder: '会場（例：京都芸術センター講堂）' }));
  const up = editable('input', m.updated ? `最終更新：${m.updated}` : '', () => {}, { cls: 'updated' });
  if (mode === 'edit') { up.value = m.updated || ''; up.placeholder = '最終更新'; up.oninput = () => { m.updated = up.value; saveSoon(); }; }
  box.appendChild(up);
  return box;
}

function renderNotes() {
  const box = el('div', 'notes');
  if (mode === 'edit' || state.notes) box.appendChild(el('h4', null, 'NOTE'));
  box.appendChild(editable('textarea', state.notes, v => state.notes = v, { placeholder: '確認事項・連絡事項など', rows: 3 }));
  return box;
}

function renderDay(day, di) {
  const g = gridInfo(day);
  const sec = el('section', 'day');
  sec.dataset.id = day.id;

  // --- 日ごとのツール（編集モード）
  const tools = el('div', 'day-tools');
  const mk = (label, fn, cls = 'tb') => { const b = el('button', cls, label); b.addEventListener('click', fn); return b; };
  tools.appendChild(mk('＋ 日を追加', () => commit(() => {
    state.days.splice(di + 1, 0, { id: uid(), date: addDays(day.date, 1), label: '', notes: '', blocks: [], lanes: cloneLanes(day.lanes) });
  })));
  tools.appendChild(mk('複製', () => commit(() => {
    const copy = JSON.parse(JSON.stringify(day)); copy.id = uid(); copy.date = addDays(day.date, 1);
    copy.blocks.forEach(b => b.id = uid()); copy.lanes = cloneLanes(copy.lanes);
    state.days.splice(di + 1, 0, copy);
  })));
  tools.appendChild(mk('↑', () => { if (di > 0) commit(() => { state.days.splice(di - 1, 0, state.days.splice(di, 1)[0]); }); }));
  tools.appendChild(mk('↓', () => { if (di < state.days.length - 1) commit(() => { state.days.splice(di + 1, 0, state.days.splice(di, 1)[0]); }); }));
  tools.appendChild(mk('削除', () => {
    if (state.days.length <= 1) return toast('最後の1日は削除できません');
    if (confirm(`${mdLabel(day.date)} の日程を削除しますか？`)) commit(() => { state.days.splice(di, 1); });
  }, 'tb danger'));
  sec.appendChild(tools);

  const body = el('div', 'day-body');
  sec.appendChild(body);

  // --- 左：日付・ラベル
  const side = el('div', 'day-side');
  if (mode === 'edit') {
    side.appendChild(editable('input', day.date, v => day.date = v, { type: 'date', onChange: () => render() }));
    side.appendChild(el('div', 'md', wdLabel(day.date)));
    side.appendChild(editable('textarea', day.label, v => day.label = v, { cls: 'label', placeholder: '仕込み / 本番 など', rows: 2 }));
  } else {
    side.appendChild(el('div', 'md', mdLabel(day.date)));
    side.appendChild(el('div', 'md', wdLabel(day.date)));
    if (day.label) { side.appendChild(el('div', null, '・')); side.appendChild(el('div', 'label', day.label)); }
  }
  body.appendChild(side);

  // --- 右：時間軸
  const main = el('div', 'day-main');
  body.appendChild(main);

  const head = el('div', 'time-head');
  const lh = el('div', 'lane-head');
  if (showStaffCol() || showLocCol()) lh.appendChild(el('span', 'lh-name', BASES[state.base].formStyle === 'byEvent' ? '事業（場所）' : ''));
  if (showLocCol()) lh.appendChild(el('span', 'lh-loc', '場所'));
  if (showStaffCol()) lh.appendChild(el('span', 'lh-staff', '担当'));
  head.appendChild(lh);
  const hours = el('div', 'hours');
  hours.style.setProperty('--hours', g.hours);
  for (let h = state.settings.startHour; h < state.settings.endHour; h++) hours.appendChild(el('div', 'hour', `${h}:00`));
  head.appendChild(hours);
  main.appendChild(head);

  const grid = el('div', 'grid');
  main.appendChild(grid);

  // 行名
  const names = el('div', 'lane-names');
  day.lanes.forEach((lane, li) => names.appendChild(renderLane(day, lane, li)));
  if (mode === 'edit') {
    const add = el('div', 'lane-add', '＋ 行を追加');
    add.addEventListener('click', () => commit(() => { day.lanes.push({ id: uid(), name: '新しい行', staff: '' }); }));
    names.appendChild(add);
  }
  grid.appendChild(names);
  if (showLocCol()) {
    const locs = el('div', 'lane-locs');
    day.lanes.forEach(lane => {
      const row = el('div', 'lane');
      const e = editable('textarea', lane.loc, v => lane.loc = v, { placeholder: '場所', rows: 2 });
      if (mode === 'edit') e.dataset.fixed = '1';
      row.appendChild(e); locs.appendChild(row);
    });
    grid.appendChild(locs);
  }
  if (showStaffCol()) {
    const staffs = el('div', 'lane-staffs');
    day.lanes.forEach(lane => {
      const row = el('div', 'lane');
      row.appendChild(staffCell(lane));
      staffs.appendChild(row);
    });
    grid.appendChild(staffs);
  }

  // 時間エリア
  const area = el('div', 'time-area');
  area.style.setProperty('--cols', g.slots);
  const perHour = 60 / g.slot;
  for (let li = 0; li < g.rows; li++) {
    for (let si = 0; si < g.slots; si++) {
      const c = el('div', 'cell');
      if ((si + 1) % perHour === 0) c.classList.add('hr');
      if (si === g.slots - 1) c.classList.add('lc');
      if (li === g.rows - 1) c.classList.add('lr');
      c.dataset.li = li; c.dataset.si = si;
      area.appendChild(c);
    }
  }
  // 利用時間外（灰色）と終了赤線
  const s = state.settings;
  const openT = day.open || s.openTime, closeT = day.close || s.closeTime;
  if (openT && toMin(openT) > g.start) {
    const c = el('div', 'closed'); c.style.left = '0'; c.style.width = pct(toMin(openT)) + '%'; area.appendChild(c);
  }
  if (closeT && toMin(closeT) < g.end) {
    const c = el('div', 'closed'); c.style.left = pct(toMin(closeT)) + '%'; c.style.right = '0'; area.appendChild(c);
    const l = el('div', 'close-line'); l.style.left = pct(toMin(closeT)) + '%'; area.appendChild(l);
  }
  if (mode === 'edit') {
    // 入り／退館の境目をドラッグで動かすハンドル（フォームの「時間」にも反映）
    [['open', openT ? toMin(openT) : g.start, '入り時間をドラッグで変更'], ['close', closeT ? toMin(closeT) : g.end, '退館時間をドラッグで変更']].forEach(([key, min, title]) => {
      const h = el('div', 'cl-handle ' + key); h.style.left = pct(min) + '%'; h.title = title;
      h.appendChild(el('span', 'cl-tag', key === 'open' ? '入' : '退'));
      h.addEventListener('pointerdown', e => {
        if (e.button !== 0) return; e.stopPropagation(); e.preventDefault();
        const gm = areaGeom(area, day); const snap = JSON.stringify(state);
        drag(e, ev => {
          const slot = gm.slotAt(ev.clientX) + (key === 'open' ? 0 : 1);
          const m = clamp(gm.g.start + slot * gm.g.slot, gm.g.start, gm.g.end);
          day[key] = (key === 'open' ? m <= gm.g.start : m >= gm.g.end) ? '' : fmt(m);
          h.style.left = pct(m) + '%';
        }, (ev, moved) => {
          if (!moved) return;
          pushHistory(snap);
          if (syncDayTimesToForm(day)) { applyForm(); renderForm(); }
          save(); render();
        });
      });
      area.appendChild(h);
    });
  }
  // ブロック：長いものから描き、短いもの（休憩など）が前面に来るようにする
  sortedBlocks(day).forEach(b => area.appendChild(renderBlock(b, day)));
  if (mode === 'edit') attachCreate(area, day);
  grid.appendChild(area);

  // 日ごとのメモ（表の外側に置き、日付欄の高さが表とぴったり揃うようにする）
  const dn = el('div', 'day-notes');
  dn.appendChild(editable('textarea', day.notes, v => day.notes = v, { placeholder: '※この日の注意事項（任意）', rows: 1 }));
  sec.appendChild(dn);

  return sec;
}

// 「担当」列のセル：見出し行（担当／テクニカル）を太字で表示。編集モードでは直接書き換え可能
const STAFF_HEAD = /^(担当|テクニカル)$/;
function staffCell(lane) {
  const d = el('div', 'txt staff-txt');
  const paint = () => {
    d.innerHTML = '';
    (lane.staff || '').split('\n').forEach((line, i, arr) => {
      d.appendChild(STAFF_HEAD.test(line.trim()) ? el('b', null, line) : document.createTextNode(line));
      if (i < arr.length - 1) d.appendChild(document.createTextNode('\n'));
    });
    if (!lane.staff) d.classList.add('empty'); else d.classList.remove('empty');
  };
  paint();
  if (mode === 'edit') {
    d.contentEditable = 'plaintext-only'; d.classList.add('ed'); d.dataset.placeholder = '担当者';
    d.addEventListener('focus', () => { d._snap = JSON.stringify(state); });
    d.addEventListener('input', () => { if (d._snap) { pushHistory(d._snap); d._snap = null; } lane.staff = d.innerText.replace(/\n$/, ''); saveSoon(); });
    d.addEventListener('blur', paint);
  }
  return d;
}
function renderLane(day, lane, li) {
  const row = el('div', 'lane');
  const nameEl = editable('textarea', lane.name, v => lane.name = v, { placeholder: '行の名前', rows: 2 });
  if (mode === 'edit') { nameEl.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); nameEl.blur(); } }); nameEl.dataset.fixed = '1'; }
  row.appendChild(nameEl);
  if (mode === 'edit') {
    const t = el('span', 'lane-tools');
    const mk = (label, title, fn) => { const b = el('button', null, label); b.title = title; b.addEventListener('click', fn); return b; };
    t.appendChild(mk('▲', '上へ', () => { if (li > 0) commit(() => swapLanes(day, li - 1, li)); }));
    t.appendChild(mk('▼', '下へ', () => { if (li < day.lanes.length - 1) commit(() => swapLanes(day, li, li + 1)); }));
    t.appendChild(mk('×', 'この行を削除', () => {
      if (day.lanes.length <= 1) return toast('最後の1行は削除できません');
      if (confirm(`行「${lane.name}」を削除しますか？（この行だけのブロックも削除されます）`)) commit(() => deleteLane(day, li));
    }));
    row.appendChild(t);
  }
  return row;
}
// 隣り合う行の入れ替え：1行だけのブロックは一緒に移動、複数行にまたがるブロックはそのまま
function swapLanes(d, a, b) {
  [d.lanes[a], d.lanes[b]] = [d.lanes[b], d.lanes[a]];
  d.blocks.forEach(bl => {
    if (bl.lane0 === bl.lane1) { if (bl.lane0 === a) bl.lane0 = bl.lane1 = b; else if (bl.lane0 === b) bl.lane0 = bl.lane1 = a; }
  });
}
function deleteLane(d, li) {
  d.lanes.splice(li, 1);
  d.blocks = d.blocks.filter(b => !(b.lane0 === li && b.lane1 === li));
  d.blocks.forEach(b => {
    if (b.lane0 > li) b.lane0--;
    if (b.lane1 >= li) b.lane1--;
    if (b.lane1 < b.lane0) b.lane1 = b.lane0;
  });
}

function positionBlock(div, b) {
  div.style.left = pct(toMin(b.start)) + '%';
  div.style.width = (pct(toMin(b.end)) - pct(toMin(b.start))) + '%';
  if (b.half) { // 行の下半分に表示（運営の個別休憩など）
    div.style.top = `calc(var(--rowH) * ${b.lane1} + var(--rowH) * 0.55)`;
    div.style.height = `calc(var(--rowH) * 0.45 + 1px)`;
  } else {
    div.style.top = `calc(var(--rowH) * ${b.lane0})`;
    div.style.height = `calc(var(--rowH) * ${b.lane1 - b.lane0 + 1} + 1px)`;
  }
}
// 描画順：長い順（同じ長さなら元の順）。後に描いたものが前面
const durOf = b => toMin(b.end) - toMin(b.start);
function sortedBlocks(day) {
  return day.blocks.map((b, i) => [b, i]).sort((x, y) => durOf(y[0]) - durOf(x[0]) || x[1] - y[1]).map(x => x[0]);
}
// ブロック b のうち、前面のブロックに隠れていない区間（分）を返す
function visibleIntervals(b, day) {
  const s = toMin(b.start), e = toMin(b.end);
  const order = sortedBlocks(day); const rank = order.indexOf(b);
  const tops = order.slice(rank + 1).filter(o => !o.half && !(toMin(o.end) <= s || toMin(o.start) >= e) && !(o.lane1 < b.lane0 || o.lane0 > b.lane1));
  let iv = [[s, e]];
  tops.forEach(o => {
    const os = toMin(o.start), oe = toMin(o.end);
    iv = iv.flatMap(([a, c]) => { const r = []; if (os > a) r.push([a, Math.min(os, c)]); if (oe < c) r.push([Math.max(oe, a), c]); return r.filter(([x, y]) => y > x); });
  });
  return iv;
}
// #RRGGBB → rgba(r,g,b,a)
function rgba(hex, a) {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex || '');
  return m ? `rgba(${parseInt(m[1], 16)},${parseInt(m[2], 16)},${parseInt(m[3], 16)},${a})` : 'transparent';
}
// 前面ブロック b が下のブロックと重なる部分：下の色を50%重ねて「両方の色が透けて見える」ようにする
function overlapMixes(b, day) {
  const s = toMin(b.start), e = toMin(b.end), dur = e - s || 1, rows = b.lane1 - b.lane0 + 1;
  const order = sortedBlocks(day); const rank = order.indexOf(b);
  const out = [];
  order.slice(0, rank).forEach(o => {
    if (o.half || b.half) return;
    const os = toMin(o.start), oe = toMin(o.end);
    const a = Math.max(s, os), c = Math.min(e, oe); if (c <= a) return;
    const l0 = Math.max(b.lane0, o.lane0), l1 = Math.min(b.lane1, o.lane1); if (l1 < l0) return;
    out.push({ left: (a - s) / dur * 100, width: (c - a) / dur * 100, top: (l0 - b.lane0) / rows * 100, height: (l1 - l0 + 1) / rows * 100, color: o.bg });
  });
  return out;
}
function renderBlock(b, day) {
  const div = el('div', 'block');
  div.dataset.id = b.id;
  positionBlock(div, b);
  div.style.background = b.bg; div.style.color = b.fg;
  if (b.bold) div.classList.add('bold');
  if (b.size && b.size !== 'm') div.classList.add(b.size);
  if (b.vertical) div.classList.add('vertical');
  if (b.half) div.classList.add('half');
  if (b.gen) { div.classList.add('gen'); div.title = 'フォームから生成されたブロック（反映すると作り直されます）'; }
  overlapMixes(b, day).forEach(m => {
    const mx = el('div', 'mix');
    mx.style.left = m.left + '%'; mx.style.width = m.width + '%'; mx.style.top = m.top + '%'; mx.style.height = m.height + '%';
    mx.style.background = rgba(m.color, 0.5);
    div.appendChild(mx);
  });
  const iv = visibleIntervals(b, day);
  const s0 = toMin(b.start), dur = durOf(b) || 1;
  if (iv.length === 1 && iv[0][0] === s0 && iv[0][1] === toMin(b.end)) {
    div.appendChild(el('div', 'txt', b.text));
  } else {
    // 前面のブロックに隠れる部分を避け、見えている区間ごとにラベルを表示
    div.classList.add('split');
    iv.forEach(([a, c]) => {
      const seg = el('div', 'txt seg', b.text);
      seg.style.left = ((a - s0) / dur * 100) + '%'; seg.style.width = ((c - a) / dur * 100) + '%';
      if (c - a < 20) seg.classList.add('narrow'); // 狭すぎる区間は文字を出さない
      div.appendChild(seg);
    });
  }
  if (mode === 'edit') {
    div.appendChild(el('div', 'rs'));
    div.addEventListener('pointerdown', e => onBlockPointerDown(e, b, day, div));
  }
  return div;
}

// ===== pointer interaction =====
function areaGeom(area, day) {
  const r = area.getBoundingClientRect(); const g = gridInfo(day);
  return {
    slotAt: x => clamp(Math.floor((x - r.left) / r.width * g.slots), 0, g.slots - 1),
    laneAt: y => clamp(Math.floor((y - r.top) / r.height * g.rows), 0, g.rows - 1),
    g
  };
}
function drag(e, onMove, onUp) {
  const t = e.currentTarget; t.setPointerCapture(e.pointerId);
  let moved = false;
  const mv = ev => { if (Math.abs(ev.clientX - e.clientX) > 3 || Math.abs(ev.clientY - e.clientY) > 3) moved = true; if (moved) onMove(ev); };
  const up = ev => { t.removeEventListener('pointermove', mv); t.removeEventListener('pointerup', up); t.removeEventListener('pointercancel', up); onUp(ev, moved); };
  t.addEventListener('pointermove', mv); t.addEventListener('pointerup', up); t.addEventListener('pointercancel', up);
}

// 空きマスをドラッグして新規ブロック
function attachCreate(area, day) {
  area.addEventListener('pointerdown', e => {
    if (e.button !== 0 || !e.target.classList.contains('cell')) return;
    e.preventDefault();
    const gm = areaGeom(area, day);
    const s0 = gm.slotAt(e.clientX), l0 = gm.laneAt(e.clientY);
    let s1 = s0, l1 = l0;
    const ghost = el('div', 'ghost'); area.appendChild(ghost);
    const paint = () => {
      const a = Math.min(s0, s1), b = Math.max(s0, s1), la = Math.min(l0, l1), lb = Math.max(l0, l1);
      ghost.style.left = (a / gm.g.slots * 100) + '%'; ghost.style.width = ((b - a + 1) / gm.g.slots * 100) + '%';
      ghost.style.top = `calc(var(--rowH) * ${la})`; ghost.style.height = `calc(var(--rowH) * ${lb - la + 1})`;
    };
    paint();
    drag(e, ev => { s1 = gm.slotAt(ev.clientX); l1 = gm.laneAt(ev.clientY); paint(); }, () => {
      ghost.remove();
      const a = Math.min(s0, s1), b = Math.max(s0, s1);
      const block = {
        id: uid(), start: fmt(gm.g.start + a * gm.g.slot), end: fmt(gm.g.start + (b + 1) * gm.g.slot),
        lane0: Math.min(l0, l1), lane1: Math.max(l0, l1), text: '', bg: '#FFFFFF', fg: '#000000', bold: true, size: 'm', vertical: false
      };
      commit(() => day.blocks.push(block));
      openEditor(block.id, true);
    });
  });
}

function onBlockPointerDown(e, b, day, div) {
  if (e.button !== 0) return;
  e.stopPropagation(); e.preventDefault();
  const area = div.parentElement; const gm = areaGeom(area, day);
  const snap = JSON.stringify(state);
  const o = { start: toMin(b.start), end: toMin(b.end), lane0: b.lane0, lane1: b.lane1 };
  const s0 = gm.slotAt(e.clientX), l0 = gm.laneAt(e.clientY);
  const resizing = e.target.classList.contains('rs');
  drag(e, ev => {
    const ds = gm.slotAt(ev.clientX) - s0;
    if (resizing) {
      const newEnd = clamp(gm.g.start + (gm.slotAt(ev.clientX) + 1) * gm.g.slot, o.start + gm.g.slot, gm.g.end);
      b.end = fmt(newEnd);
    } else {
      const dl = gm.laneAt(ev.clientY) - l0;
      const len = o.end - o.start, span = o.lane1 - o.lane0;
      const ns = clamp(o.start + ds * gm.g.slot, gm.g.start, gm.g.end - len);
      const nl = clamp(o.lane0 + dl, 0, gm.g.rows - 1 - span);
      b.start = fmt(ns); b.end = fmt(ns + len); b.lane0 = nl; b.lane1 = nl + span;
    }
    positionBlock(div, b);
  }, (ev, moved) => {
    if (moved) { pushHistory(snap); afterBlockChange(day, b); selectBlock(b.id); }
    else openEditor(b.id);
  });
}

// ===== block editor =====
const ED = {};
function initEditor() {
  ['edText', 'edStart', 'edEnd', 'edLane0', 'edLane1', 'edBg', 'edBold', 'edVertical', 'edSize', 'edType', 'edPick'].forEach(id => ED[id] = $('#' + id));
  // 種別：フォーム由来ならフェーズの種別を変更（色も追従）、手作業なら色だけ種別の色に
  ED.edType.addEventListener('change', () => applyEdit(bl => {
    const t = ED.edType.value; if (!t) return;
    const ref = bl.gen && findPhase(bl.gen);
    if (ref) { ref.ph.type = t; ref.ph.style = null; }
    bl.bg = PHASE_COLORS[t]; bl.ptype = t;
  }));
  // ラベルを選ぶ → テキストに反映
  ED.edPick.addEventListener('change', () => {
    const v = ED.edPick.value; if (!v) return;
    ED.edText.value = v; ED.edText.dispatchEvent(new Event('input')); ED.edPick.value = '';
    const f = findBlock(selectedId); if (f) { afterBlockChange(f.day, f.block); fillEditor(findBlock(selectedId)?.block || f.block); }
  });
  const pal = $('#edPalette');
  PALETTE.forEach(p => { const b = el('button'); b.title = p.name; b.style.background = p.bg; b.dataset.bg = p.bg; b.addEventListener('click', () => applyEdit(bl => bl.bg = p.bg)); pal.appendChild(b); });
  $$('#edFg button').forEach(b => b.addEventListener('click', () => applyEdit(bl => bl.fg = b.dataset.fg)));
  ED.edText.addEventListener('focus', () => { ED.edText._snap = JSON.stringify(state); });
  ED.edText.addEventListener('input', () => {
    const f = findBlock(selectedId); if (!f) return;
    if (ED.edText._snap) { pushHistory(ED.edText._snap); ED.edText._snap = null; }
    f.block.text = ED.edText.value;
    $$(`.block[data-id="${selectedId}"] .txt`).forEach(t => { t.textContent = f.block.text; });
    if (f.block.gen) { syncBlockToForm(f.day, f.block); clearTimeout(ED._fr); ED._fr = setTimeout(renderForm, 600); }
    saveSoon();
  });
  ED.edStart.addEventListener('change', () => applyEdit(bl => { bl.start = ED.edStart.value; if (toMin(bl.end) <= toMin(bl.start)) bl.end = fmt(toMin(bl.start) + state.settings.slot); }));
  ED.edEnd.addEventListener('change', () => applyEdit(bl => { bl.end = ED.edEnd.value; if (toMin(bl.end) <= toMin(bl.start)) bl.start = fmt(toMin(bl.end) - state.settings.slot); }));
  ED.edLane0.addEventListener('change', () => applyEdit(bl => { bl.lane0 = +ED.edLane0.value; if (bl.lane1 < bl.lane0) bl.lane1 = bl.lane0; }));
  ED.edLane1.addEventListener('change', () => applyEdit(bl => { bl.lane1 = +ED.edLane1.value; if (bl.lane1 < bl.lane0) bl.lane0 = bl.lane1; }));
  ED.edBg.addEventListener('input', () => applyEdit(bl => bl.bg = ED.edBg.value.toUpperCase(), true));
  ED.edBold.addEventListener('change', () => applyEdit(bl => bl.bold = ED.edBold.checked));
  ED.edVertical.addEventListener('change', () => applyEdit(bl => bl.vertical = ED.edVertical.checked));
  ED.edSize.addEventListener('change', () => applyEdit(bl => bl.size = ED.edSize.value));
  $('#edClose').addEventListener('click', closeEditor);
  $('#edToForm').addEventListener('click', blockToForm);
  $('#edDel').addEventListener('click', deleteSelected);
  $('#edDup').addEventListener('click', () => {
    const f = findBlock(selectedId); if (!f) return;
    const copy = Object.assign({}, f.block, { id: uid() });
    const len = toMin(copy.end) - toMin(copy.start);
    if (toMin(copy.end) + len <= gridInfo().end) { copy.start = copy.end; copy.end = fmt(toMin(copy.end) + len); }
    commit(() => f.day.blocks.push(copy));
    openEditor(copy.id);
  });
}
function applyEdit(fn, light) {
  const f = findBlock(selectedId); if (!f) return;
  pushHistory(); fn(f.block);
  if (light) { const d = $(`.block[data-id="${selectedId}"]`); if (d) d.style.background = f.block.bg; afterBlockChange(f.day, f.block, { noRender: true }); }
  else afterBlockChange(f.day, f.block);
  const g = findBlock(selectedId); if (g) fillEditor(g.block); else closeEditor();
}
function selectBlock(id) {
  selectedId = id;
  $$('.block.sel').forEach(b => b.classList.remove('sel'));
  if (id) $(`.block[data-id="${id}"]`)?.classList.add('sel');
}
function openEditor(id, focusText) {
  const f = findBlock(id); if (!f) return;
  selectBlock(id);
  fillEditor(f.block);
  $('#editor').hidden = false; document.body.classList.add('editor-open');
  if (focusText) ED.edText.focus();
}
function fillEditor(b) {
  const g = gridInfo();
  const fillTimes = (sel, val) => {
    sel.innerHTML = '';
    const step = Math.min(15, g.slot);
    const vals = new Set();
    for (let m = g.start; m <= g.end; m += step) vals.add(fmt(m));
    vals.add(val);
    [...vals].sort().forEach(v => { const o = el('option', null, v); o.value = v; sel.appendChild(o); });
    sel.value = val;
  };
  fillTimes(ED.edStart, b.start); fillTimes(ED.edEnd, b.end);
  const dayLanes = (findBlock(b.id)?.day || state.days[0]).lanes;
  [ED.edLane0, ED.edLane1].forEach((sel, i) => {
    sel.innerHTML = '';
    dayLanes.forEach((l, li) => { const o = el('option', null, l.name.replace('\n', ' ') || `行${li + 1}`); o.value = li; sel.appendChild(o); });
    sel.value = i === 0 ? b.lane0 : b.lane1;
  });
  if (document.activeElement !== ED.edText) ED.edText.value = b.text;
  // 種別セレクト
  const ref = b.gen && findPhase(b.gen);
  const evType = ref ? ref.ev.type : (BASES[state.base].formStyle === 'byEvent' ? 'stage' : state.form.type);
  const curType = ref ? ref.ph.type : (b.ptype || Object.keys(PHASE_COLORS).find(k => PHASE_COLORS[k].toUpperCase() === (b.bg || '').toUpperCase()) || '');
  ED.edType.innerHTML = '';
  const o0 = el('option', null, '（種別なし）'); o0.value = ''; ED.edType.appendChild(o0);
  PHASE_TYPES.forEach(k => { const o = el('option', null, EVENT_TYPES[evType][k]); o.value = k; ED.edType.appendChild(o); });
  ED.edType.value = curType;
  // ラベル候補：よく使う語 ＋ この表で使用中のラベル
  const used = new Set();
  state.days.forEach(d => d.blocks.forEach(x => { if (x.text) used.add(x.text); }));
  state.form.events.forEach(e => e.phases.forEach(p => { if (p.label) used.add(p.label); }));
  ED.edPick.innerHTML = '';
  const p0 = el('option', null, 'ラベルを選ぶ…'); p0.value = ''; ED.edPick.appendChild(p0);
  const g1 = el('optgroup'); g1.label = 'よく使う';
  LABEL_PRESETS.forEach(t => { const o = el('option', null, t); o.value = t; g1.appendChild(o); });
  ED.edPick.appendChild(g1);
  const others = [...used].filter(t => !LABEL_PRESETS.includes(t));
  if (others.length) { const g2 = el('optgroup'); g2.label = 'この表で使用中'; others.forEach(t => { const o = el('option', null, t.replace(/\n/g, ' ')); o.value = t; g2.appendChild(o); }); ED.edPick.appendChild(g2); }
  ED.edBg.value = b.bg;
  $$('#edPalette button').forEach(x => x.classList.toggle('on', x.dataset.bg.toUpperCase() === b.bg.toUpperCase()));
  $$('#edFg button').forEach(x => x.classList.toggle('on', x.dataset.fg === b.fg));
  ED.edBold.checked = !!b.bold; ED.edVertical.checked = !!b.vertical; ED.edSize.value = b.size || 'm';
  $('#edToForm').hidden = !!b.gen; // フォーム由来のブロックには不要
}

// 手作業のブロックを、右のフォームのフェーズとして登録する
function blockToForm() {
  const found = findBlock(selectedId); if (!found || found.block.gen) return;
  const { day, block } = found; const f = state.form;
  const byEvent = BASES[state.base].formStyle === 'byEvent';
  if (!day.date) return toast('先にこの日の日付を入れてください');
  pushHistory();
  // 種別：背景色がフェーズ色と一致すればその種別、それ以外は「仕込み」＋表示スタイルを保持
  let type = block.ptype || Object.keys(PHASE_COLORS).find(k => PHASE_COLORS[k].toUpperCase() === (block.bg || '').toUpperCase()) || 'setup';
  const style = { bg: block.bg, fg: block.fg, bold: block.bold, size: block.size, vertical: block.vertical };
  const lanes = day.lanes.slice(block.lane0, block.lane1 + 1);
  let ev, ph;
  if (byEvent) {
    // 運営：行名「事業名\n(場所)」からイベントを特定（無ければ作る）
    const lane = lanes[0]; const [name, locPart] = (lane.name || '').split('\n');
    const loc = (locPart || '').replace(/^[（(]|[）)]$/g, '');
    ev = f.events.find(e => e.date === day.date && e.name === (name || '').trim());
    if (!ev) { ev = { id: uid(), date: day.date, name: (name || '').trim() || '（無題）', type: 'stage', location: loc, start: day.open || '', end: day.close || '', label: '', phases: [] }; f.events.push(ev); }
    ph = { id: uid(), type, label: block.text, startTime: block.start, endTime: block.end, technical: [], personnel: [], location: loc && loc !== ev.location ? loc : '', style };
  } else {
    // 設営：その日の日程（場所が分かれていれば同じ場所のもの）に追加。担当＝ブロックが覆う行
    const grp = lanes[0].grp || '';
    ev = f.events.find(e => e.date === day.date && (!grp || (e.location || state.meta.venue || '') === grp)) || f.events.find(e => e.date === day.date);
    if (!ev) { ev = { id: uid(), date: day.date, name: state.meta.title, type: f.type, location: grp, start: day.open || '', end: day.close || '', label: day.genLabel ? '' : day.label, phases: [] }; f.events.push(ev); }
    const names = lanes.map(l => (l.name || '').split('\n')[0].trim()).filter(Boolean);
    names.forEach(n => { if (!f.technical.includes(n) && !f.personnel.includes(n)) f.personnel.push(n); }); // 未登録の行名はスタッフに登録
    const all = lanes.length === day.lanes.filter(l => (l.grp || '') === grp).length;
    ph = { id: uid(), type, label: block.text, startTime: block.start, endTime: block.end,
      technical: all ? [] : f.technical.filter(n => names.includes(n)), personnel: all ? [] : f.personnel.filter(n => names.includes(n)), location: '', style };
  }
  ev.phases.push(ph);
  ev.phases.sort((a, b) => toMin(a.startTime) - toMin(b.startTime));
  day.blocks = day.blocks.filter(b => b.id !== block.id);
  applyForm(); save(); render(); renderForm();
  const nb = day.blocks.find(b => b.gen === ph.id);
  if (nb) openEditor(nb.id); else closeEditor();
  toast('フォームに追加しました');
}
function closeEditor() { $('#editor').hidden = true; document.body.classList.remove('editor-open'); selectBlock(null); }
function deleteSelected() {
  const f = findBlock(selectedId); if (!f) return;
  const ref = f.block.gen && findPhase(f.block.gen);
  const act = f.block.gen && findAction(f.block.gen);
  if ((ref || act) && !confirm('フォーム由来のブロックです。元の項目ごと削除しますか？\n（キャンセル＝削除しない）')) return;
  commit(() => {
    if (ref) { ref.ev.phases = ref.ev.phases.filter(p => p.id !== ref.ph.id); applyForm(); }
    else if (act) { state.form.techActions = state.form.techActions.filter(a => a.id !== act.id); applyForm(); }
    else f.day.blocks = f.day.blocks.filter(b => b.id !== f.block.id);
  });
  closeEditor();
}


// ===== 入力フォーム（右サイドバー） =====
let autoApply = true;
try { autoApply = localStorage.getItem('kac_ts_autoapply') !== 'off'; } catch (e) { /* ignore */ }
let applyTimer = null;
// フォームの入力内容を（自動反映がONなら）少し待ってから表に反映
function scheduleApply() {
  if (!autoApply) return;
  clearTimeout(applyTimer);
  applyTimer = setTimeout(() => { applyForm(); save(); render(); }, 400);
}
// フォーム内の入力欄に共通の挙動：フォーカス時に履歴を取り、入力で値を反映
function bindField(input, obj, key, opt = {}) {
  input.addEventListener('focus', () => { input._snap = JSON.stringify(state); });
  input.addEventListener('input', () => {
    if (input._snap) { pushHistory(input._snap); input._snap = null; }
    obj[key] = input.value; saveSoon(); scheduleApply();
  });
  if (opt.rerender) input.addEventListener('change', () => renderForm());
  return input;
}
function allStaff() { return [...state.form.technical, ...state.form.personnel]; }

function renderForm() {
  const f = state.form;
  const root = $('#form');
  const scrollTop = root.parentElement.scrollTop;
  root.innerHTML = '';

  const head = el('div', 'form-head');
  head.appendChild(el('h2', null, '入力フォーム'));
  const smp = el('button', 'tb', 'サンプルを読み込む');
  smp.addEventListener('click', () => { if (confirm('入力フォームにサンプルを読み込みますか？（現在のフォーム内容は置き換わります）')) commit(() => { state.form = normalizeForm(JSON.parse(JSON.stringify(BASES[base].formSample()))); applyForm(); }); });
  head.appendChild(smp);
  root.appendChild(head);

  // --- 種類
  root.appendChild(el('h3', null, 'タイムスケジュールの種類'));
  const bc = el('div', 'base-choice');
  [['ops', '運営', '事業（イベント）ごとに1行。隣の「担当」列にスタッフ名を羅列、セルはフェーズ。'],
   ['setup', '設営', 'テクニカル＋担当者ごとの行。担当にチェックした行へブロック（隣は結合、未選択＝全員）。']]
  .forEach(([k, name, desc]) => {
    const l = el('label', base === k ? 'on' : '');
    const r = el('input'); r.type = 'radio'; r.name = 'baseChoice'; r.value = k; r.checked = base === k;
    r.addEventListener('change', () => { if (r.checked && k !== base) { switchBase(k, { carryForm: true }); toast(`種類を「${name}」に切り替えました（表は種類ごとに別々に保存されます）`); } });
    l.appendChild(r); l.appendChild(el('b', null, name)); l.appendChild(el('p', null, desc));
    bc.appendChild(l);
  });
  root.appendChild(bc);

  // --- スタッフ
  root.appendChild(el('h3', null, 'スタッフ登録（1行に1名）'));
  const sg = el('div', 'staff-grid');
  [['technical', 'テクニカル'], ['personnel', '担当者']].forEach(([key, label]) => {
    const l = el('label', 'fl', label);
    const ta = el('textarea'); ta.value = f[key].join('\n'); ta.placeholder = '名前を1行ずつ';
    ta.addEventListener('focus', () => { ta._snap = JSON.stringify(state); });
    ta.addEventListener('input', () => { if (ta._snap) { pushHistory(ta._snap); ta._snap = null; } f[key] = ta.value.split('\n').map(x => x.trim()).filter(Boolean); saveSoon(); });
    ta.addEventListener('change', () => { renderForm(); scheduleApply(); });
    l.appendChild(ta); sg.appendChild(l);
  });
  root.appendChild(sg);

  // --- イベント（運営）／ 公演タイトル＋日程（設営）
  const bySetup = BASES[base].formStyle !== 'byEvent';
  if (bySetup) {
    root.appendChild(el('h3', null, '事業'));
    const pg = el('input'); pg.type = 'text'; pg.value = state.meta.program; pg.placeholder = '例：Co-program カテゴリーA採択事業';
    const lp = el('label', 'fl', 'プログラム名'); lp.appendChild(bindField(pg, state.meta, 'program')); root.appendChild(lp);
    const t = el('input'); t.type = 'text'; t.value = state.meta.title; t.placeholder = '例：○○○○「公演タイトル」';
    const l = el('label', 'fl', '事業タイトル'); l.appendChild(bindField(t, state.meta, 'title')); root.appendChild(l);
    const g2 = el('div', 'ev-head');
    const ty = el('select'); Object.entries(EVENT_TYPES).forEach(([k, v]) => { const o = el('option', null, v.name); o.value = k; ty.appendChild(o); }); ty.value = f.type;
    const lt = el('label', 'fl', '種別'); lt.appendChild(bindField(ty, f, 'type', { rerender: true })); g2.appendChild(lt);
    const v = el('input'); v.type = 'text'; v.value = state.meta.venue; v.placeholder = '例：京都芸術センター講堂';
    const lv = el('label', 'fl', '会場'); lv.appendChild(bindField(v, state.meta, 'venue')); g2.appendChild(lv);
    root.appendChild(g2);
    const ds = el('input'); ds.type = 'text'; ds.value = state.meta.dates; ds.placeholder = '例：2026年8月28日(金)ー31日(月)　※空欄なら日程から自動';
    const ld = el('label', 'fl', '事業日程（期間の表記）'); ld.appendChild(bindField(ds, state.meta, 'dates')); root.appendChild(ld);
    root.appendChild(el('h3', null, '事業日程'));
    if (!f.events.length) root.appendChild(el('p', 'desc', 'まだ日程がありません。「＋ 日程を追加」から始めてください。'));
  } else {
    root.appendChild(el('h3', null, 'イベント'));
    if (!f.events.length) root.appendChild(el('p', 'desc', 'まだイベントがありません。「＋ イベントを追加」から始めてください。'));
  }
  f.events.forEach((ev, ei) => root.appendChild(renderEvent(ev, ei)));
  const addEv = el('button', 'tb', bySetup ? '＋ 日程を追加' : '＋ イベントを追加');
  addEv.addEventListener('click', () => {
    const last = f.events[f.events.length - 1];
    commit(() => { f.events.push({ id: uid(), date: last ? addDays(last.date, 1) : todayISO(), name: bySetup ? state.meta.title : '', type: 'stage', location: last && bySetup ? last.location : '',
      phases: [{ id: uid(), type: 'setup', label: '', startTime: '10:00', endTime: '12:00', technical: [], personnel: [] }] }); applyForm(); });
    const inputs = $$(bySetup ? '#form .ev input[type=date]' : '#form .ev .name input'); inputs[inputs.length - 1]?.focus();
  });
  root.appendChild(addEv);
  if (!bySetup) root.appendChild(renderTechActions());

  // --- 反映
  const act = el('div', 'form-actions');
  const apply = el('button', 'tb primary', '▶ 表に反映');
  apply.addEventListener('click', () => { commit(applyForm); toast('タイムスケジュールに反映しました'); });
  act.appendChild(apply);
  const auto = el('label', 'auto'); const ck = el('input'); ck.type = 'checkbox'; ck.checked = autoApply;
  ck.addEventListener('change', () => { autoApply = ck.checked; try { localStorage.setItem('kac_ts_autoapply', autoApply ? 'on' : 'off'); } catch (e) { /* ignore */ } if (autoApply) scheduleApply(); });
  auto.appendChild(ck); auto.appendChild(document.createTextNode('入力すると自動で反映'));
  act.appendChild(auto);
  act.appendChild(el('span', 'note', 'フォーム由来のブロック（左上に青い印）は反映のたびに作り直されます。表の上で手で足したブロックはそのまま残ります。'));
  root.appendChild(act);
  root.parentElement.scrollTop = scrollTop;
}

// 運営：テクニカルの行動（MT・休憩）の記入欄
function renderTechActions() {
  const f = state.form;
  const box = el('div');
  box.appendChild(el('h3', null, 'テクニカル（MT・休憩）'));
  box.appendChild(el('p', 'desc', 'その日、対象のテクニカルが担当に入っているイベントの行に、MT・休憩のブロックが重なって表示されます（下のラベルは左右に分かれて読めます）。対象を選ばなければテクニカル全員。'));
  const dates = [...new Set(f.events.map(e => e.date).filter(Boolean))].sort();
  f.techActions.forEach((a, ai) => {
    const card = el('div', 'ph ph-type-' + (a.type === 'break' ? 'break' : a.type === 'mt' ? 'performance' : 'setup'));
    const r1 = el('div', 'r1'); r1.style.gridTemplateColumns = '120px 1fr 22px';
    const date = el('input'); date.type = 'date'; date.value = a.date; date.setAttribute('list', 'taDates');
    r1.appendChild(bindField(date, a, 'date'));
    const r1b = el('div', 'inl');
    const type = el('select'); Object.entries(TECH_ACTION_TYPES).forEach(([k, v]) => { const o = el('option', null, v.name); o.value = k; type.appendChild(o); }); type.value = a.type;
    type.addEventListener('change', () => { a.style = null; });
    r1b.appendChild(bindField(type, a, 'type', { rerender: true }));
    const label = el('input'); label.type = 'text'; label.value = a.label; label.placeholder = `ラベル（空欄なら「${TECH_ACTION_TYPES[a.type].name}」）`; label.style.flex = '1';
    r1b.appendChild(bindField(label, a, 'label'));
    r1.appendChild(r1b);
    const del = el('button', 'del', '×'); del.title = '削除';
    del.addEventListener('click', () => commit(() => { f.techActions.splice(ai, 1); applyForm(); }));
    r1.appendChild(del);
    card.appendChild(r1);
    const r2 = el('div', 'r2');
    const st = el('input'); st.type = 'time'; st.step = 900; st.value = a.startTime;
    const en = el('input'); en.type = 'time'; en.step = 900; en.value = a.endTime;
    r2.appendChild(bindField(st, a, 'startTime')); r2.appendChild(el('span', null, '〜')); r2.appendChild(bindField(en, a, 'endTime'));
    r2.appendChild(el('span', null, '対象：'));
    card.appendChild(r2);
    // 対象（テクニカルのみ）
    const pk = el('div', 'picker');
    a.technical.forEach(n => {
      const chip = el('span', 'chip tech', n); const x = el('button', null, '×'); x.title = '外す';
      x.addEventListener('click', () => commit(() => { a.technical = a.technical.filter(v => v !== n); applyForm(); }));
      chip.appendChild(x); pk.appendChild(chip);
    });
    if (!a.technical.length) pk.appendChild(el('span', 'all', '（未選択＝テクニカル全員）'));
    const remaining = f.technical.filter(n => !a.technical.includes(n));
    if (remaining.length) {
      const sel = el('select'); const o0 = el('option', null, '＋ 対象を追加'); o0.value = ''; sel.appendChild(o0);
      remaining.forEach(n => { const o = el('option', null, n); o.value = n; sel.appendChild(o); });
      sel.addEventListener('change', () => { if (sel.value) commit(() => { a.technical.push(sel.value); applyForm(); }); });
      pk.appendChild(sel);
    } else if (!f.technical.length) pk.appendChild(el('span', 'all', '（上のスタッフ登録にテクニカルを入力）'));
    card.appendChild(pk);
    box.appendChild(card);
  });
  const add = el('button', 'tb mini', '＋ MT・休憩を追加');
  add.addEventListener('click', () => commit(() => {
    const last = f.techActions[f.techActions.length - 1];
    f.techActions.push({ id: uid(), date: last ? last.date : (dates[0] || todayISO()), type: last && last.type === 'mt' ? 'break' : 'mt', label: '', startTime: last ? last.endTime : '09:30', endTime: last ? fmt(Math.min(toMin(last.endTime) + 60, 23 * 60)) : '10:00', technical: [], style: null });
  }));
  box.appendChild(add);
  return box;
}

function renderEvent(ev, ei) {
  const f = state.form;
  const bySetup = BASES[base].formStyle !== 'byEvent';
  const box = el('div', 'ev');
  const head = el('div', 'ev-head');
  const fld = (label, input, cls) => { const l = el('label', 'fl' + (cls ? ' ' + cls : ''), label); l.appendChild(input); return l; };
  if (!bySetup) {
    const name = el('input'); name.type = 'text'; name.value = ev.name; name.placeholder = 'イベント名';
    head.appendChild(fld('イベント名', bindField(name, ev, 'name'), 'name'));
  } else {
    const nb = el('div', 'ev-no');
    nb.appendChild(el('span', null, `日程 ${ei + 1}`));
    const nm = el('input'); nm.type = 'text'; nm.value = ev.label; nm.placeholder = '名称（例：仕込み／本番①／バラシ）※表の日ラベルになる';
    nb.appendChild(bindField(nm, ev, 'label'));
    head.appendChild(nb);
  }
  const date = el('input'); date.type = 'date'; date.value = ev.date;
  head.appendChild(fld('日付', bindField(date, ev, 'date')));
  const loc = el('input'); loc.type = 'text'; loc.value = ev.location; loc.placeholder = bySetup ? '（空欄なら事業「会場」）' : '講堂 など';
  head.appendChild(fld('場所', bindField(loc, ev, 'location')));
  // 時間（入り〜退館）はフォームには出さない。表の「入」「退」ハンドルで調整（データは ev.start / ev.end に同期）
  if (!bySetup) {
    const type = el('select'); Object.entries(EVENT_TYPES).forEach(([k, v]) => { const o = el('option', null, v.name); o.value = k; type.appendChild(o); }); type.value = ev.type;
    head.appendChild(fld('種別', bindField(type, ev, 'type', { rerender: true })));
  }
  box.appendChild(head);

  // フェーズ
  ev.phases.forEach((ph, pi) => box.appendChild(renderPhase(ev, ph, pi)));
  const addPh = el('button', 'tb mini', '＋ フェーズを追加');
  addPh.addEventListener('click', () => commit(() => {
    const last = ev.phases[ev.phases.length - 1];
    const order = ['setup', 'performance', 'teardown'];
    const nextType = last && order.includes(last.type) ? order[Math.min(order.indexOf(last.type) + 1, 2)] : 'setup';
    const st = last ? last.endTime : '10:00';
    ev.phases.push({ id: uid(), type: nextType, label: '', startTime: st, endTime: fmt(Math.min(toMin(st) + 120, 23 * 60 + 30)), technical: last ? [...last.technical] : [], personnel: last ? [...last.personnel] : [] });
    applyForm();
  }));
  box.appendChild(addPh);

  const tools = el('div', 'ev-tools');
  const mk = (label, fn, cls = 'tb') => { const b = el('button', cls, label); b.addEventListener('click', fn); return b; };
  tools.appendChild(mk('複製（翌日）', () => commit(() => {
    const c = JSON.parse(JSON.stringify(ev)); c.id = uid(); c.date = addDays(ev.date, 1); c.phases.forEach(p => p.id = uid());
    f.events.splice(ei + 1, 0, c); applyForm();
  })));
  tools.appendChild(mk('↑', () => { if (ei > 0) commit(() => { f.events.splice(ei - 1, 0, f.events.splice(ei, 1)[0]); applyForm(); }); }));
  tools.appendChild(mk('↓', () => { if (ei < f.events.length - 1) commit(() => { f.events.splice(ei + 1, 0, f.events.splice(ei, 1)[0]); applyForm(); }); }));
  tools.appendChild(mk('削除', () => { if (confirm(bySetup ? `日程 ${mdLabel(ev.date)} を削除しますか？` : `イベント「${ev.name || '(無題)'}」を削除しますか？`)) commit(() => { f.events.splice(ei, 1); applyForm(); }); }, 'tb danger'));
  box.appendChild(tools);
  return box;
}

function renderPhase(ev, ph, pi) {
  const f = state.form;
  const card = el('div', 'ph ph-type-' + ph.type);
  const r1 = el('div', 'r1');
  const type = el('select');
  const evType = BASES[base].formStyle === 'byEvent' ? ev.type : f.type;
  PHASE_TYPES.forEach(k => { const o = el('option', null, EVENT_TYPES[evType][k]); o.value = k; type.appendChild(o); });
  type.value = ph.type;
  type.addEventListener('change', () => { ph.style = null; }); // 種別を変えたら表で付けた色はリセット
  r1.appendChild(bindField(type, ph, 'type', { rerender: true }));
  const label = el('input'); label.type = 'text'; label.value = ph.label; label.placeholder = `ラベル（空欄なら「${EVENT_TYPES[evType][ph.type]}」）`;
  r1.appendChild(bindField(label, ph, 'label'));
  const del = el('button', 'del', '×'); del.title = 'このフェーズを削除';
  del.addEventListener('click', () => commit(() => { ev.phases.splice(pi, 1); applyForm(); }));
  r1.appendChild(del);
  card.appendChild(r1);
  if (BASES[base].formStyle === 'byEvent') {
    const rl = el('div', 'r2');
    rl.appendChild(el('span', null, '場所：'));
    const loc = el('input'); loc.type = 'text'; loc.value = ph.location; loc.placeholder = ev.location ? `空欄なら「${ev.location}」` : '（イベントの場所と違うとき）';
    loc.title = 'イベントの場所と違う場所を入れると「イベント名（場所）」の行が別に増えます';
    rl.appendChild(bindField(loc, ph, 'location'));
    card.appendChild(rl);
  }

  const r2 = el('div', 'r2');
  const st = el('input'); st.type = 'time'; st.step = 900; st.value = ph.startTime;
  const en = el('input'); en.type = 'time'; en.step = 900; en.value = ph.endTime;
  r2.appendChild(bindField(st, ph, 'startTime')); r2.appendChild(el('span', null, '〜')); r2.appendChild(bindField(en, ph, 'endTime'));
  r2.appendChild(el('span', null, '担当：'));
  card.appendChild(r2);

  // 担当ピッカー：選択済みチップ ＋ ドロップダウンで追加
  const pk = el('div', 'picker');
  const chosen = [...ph.technical.map(n => [n, 'technical']), ...ph.personnel.map(n => [n, 'personnel'])];
  chosen.forEach(([n, key]) => {
    const chip = el('span', 'chip' + (key === 'technical' ? ' tech' : ''), n);
    const x = el('button', null, '×'); x.title = '外す';
    x.addEventListener('click', () => commit(() => { ph[key] = ph[key].filter(v => v !== n); applyForm(); }));
    chip.appendChild(x); pk.appendChild(chip);
  });
  if (!chosen.length) pk.appendChild(el('span', 'all', BASES[base].formStyle === 'byEvent' ? '（未選択）' : '（未選択＝全員）'));
  const remaining = { technical: f.technical.filter(n => !ph.technical.includes(n)), personnel: f.personnel.filter(n => !ph.personnel.includes(n)) };
  if (remaining.technical.length || remaining.personnel.length) {
    const sel = el('select');
    const o0 = el('option', null, '＋ 担当を追加'); o0.value = ''; sel.appendChild(o0);
    [['technical', 'テクニカル'], ['personnel', '担当者']].forEach(([key, label]) => {
      if (!remaining[key].length) return;
      const g = el('optgroup'); g.label = label;
      remaining[key].forEach(n => { const o = el('option', null, n); o.value = key + '|' + n; g.appendChild(o); });
      sel.appendChild(g);
    });
    if (remaining.technical.length + remaining.personnel.length > 1) { const o = el('option', null, '全員を追加'); o.value = '*'; sel.appendChild(o); }
    sel.addEventListener('change', () => {
      const v = sel.value; if (!v) return;
      commit(() => {
        if (v === '*') { ph.technical = [...f.technical]; ph.personnel = [...f.personnel]; }
        else { const [key, n] = v.split('|'); ph[key].push(n); }
        applyForm();
      });
    });
    pk.appendChild(sel);
  } else if (!f.technical.length && !f.personnel.length) {
    pk.appendChild(el('span', 'all', '（上のスタッフ登録に名前を入力）'));
  }
  card.appendChild(pk);
  return card;
}

// フォーム → タイムスケジュール生成（手で追加したブロック・行はそのまま残す）
function applyForm() {
  const f = state.form;
  const byEvent = BASES[state.base].formStyle === 'byEvent';
  // 日ごとの行：名前で探し、なければ追加（grp＝設営で場所ごとに行を分けるときの場所）
  const laneIndex = (day, name, grp = '') => {
    let i = day.lanes.findIndex(l => l.name === name && (l.grp || '') === grp);
    if (i < 0) { day.lanes.push({ id: uid(), name, staff: '', loc: '', gen: true, grp }); i = day.lanes.length - 1; }
    if (day.lanes[i].gen) day.lanes[i].loc = grp; // 場所ごとに分けた行は「場所」列に場所を表示
    return i;
  };
  const dayNames = new Map(); // day.id -> Set(イベント名)
  const dayFor = (date, name) => {
    let d = state.days.find(x => x.date === date);
    if (!d) { d = { id: uid(), date, label: '', notes: '', blocks: [], lanes: [], gen: true, genLabel: true }; state.days.push(d); }
    if (!dayNames.has(d.id)) dayNames.set(d.id, new Set());
    if (name) dayNames.get(d.id).add(name);
    return d;
  };
  // 生成済みブロックを削除
  state.days.forEach(d => { d.blocks = d.blocks.filter(b => !b.gen); });
  // 空の初期日や、フォーム由来で不要になった日は削除
  const formDates = new Set(f.events.map(e => e.date).filter(Boolean));
  state.days = state.days.filter(d => formDates.has(d.date) || (d.blocks.length && !(d.gen && !d.blocks.some(b => !b.gen))) || (!d.gen && (d.label || d.notes)));
  // 手作業のブロックが無い日は、行を全部作り直す（ひな形の空行を残さない）
  state.days.forEach(d => { if (formDates.has(d.date) && !d.blocks.length) d.lanes = []; });

  // 設営：イベント名は事業タイトル、種別は事業の種別に統一
  if (!byEvent) f.events.forEach(ev => { ev.name = state.meta.title; ev.type = f.type; });
  const multiEvent = byEvent && new Set(f.events.map(e => e.name)).size > 1;
  // 運営：行のキー＝事業名（場所）。フェーズの場所がイベントと違えば別の行
  const laneKey = (ev, ph) => { const loc = (ph && ph.location) || ev.location; return ev.name + (loc ? `\n(${loc})` : ''); };
  // 設営：同じ日に場所の違う日程があれば、行を場所ごとに分け、隣の「場所」列に場所を出す
  // 日程の場所が空欄なら事業の「会場」とみなす。同じ日の場所がすべて同じなら列は出さない
  const effLoc = ev => ev.location || state.meta.venue || '';
  const locsOf = date => [...new Set(f.events.filter(e => e.date === date).map(effLoc))];
  const setupLaneName = (ev, staffName) => staffName;
  const setupGrp = ev => locsOf(ev.date).length > 1 ? effLoc(ev) : '';

  // ブロックidはフェーズid＋行から決める（作り直しても同じidになり、選択が保たれる）
  const mkBlock = (ph, lane, text) => Object.assign({
    id: `${ph.id}-${lane}`, gen: ph.id, start: ph.startTime, end: ph.endTime, lane0: lane, lane1: lane,
    text, bg: PHASE_COLORS[ph.type], fg: '#000000', bold: true, size: 'm', vertical: false
  }, ph.style || {});

  // 行を先に作る（順序：運営＝イベント順 ／ 設営＝日程順にテクニカル→担当者）
  f.events.forEach(ev => {
    if (!ev.date) return;
    const day = dayFor(ev.date, ev.name);
    if (byEvent) { if (!ev.phases.length) laneIndex(day, laneKey(ev)); ev.phases.forEach(ph => laneIndex(day, laneKey(ev, ph))); }
    else { const grp = setupGrp(ev); [...f.technical, ...f.personnel].forEach(n => laneIndex(day, setupLaneName(ev, n), grp)); }
  });

  const perLane = new Map(); // 運営：行ごとの担当者（day.id + lane index → names）
  f.events.forEach(ev => {
    if (!ev.date) return;
    const day = dayFor(ev.date, ev.name);
    // その日の利用時間（入り〜退館）：複数イベントなら最も早い入り〜最も遅い退館
    if (ev.start && (!day._open || toMin(ev.start) < toMin(day._open))) day._open = ev.start;
    if (ev.end && (!day._close || toMin(ev.end) > toMin(day._close))) day._close = ev.end;
    const grp = setupGrp(ev);
    ev.phases.forEach(ph => {
      if (byEvent) {
        const li = laneIndex(day, laneKey(ev, ph));
        const key = day.id + ':' + li;
        if (!perLane.has(key)) perLane.set(key, { day, li, names: [] });
        [...ph.technical, ...ph.personnel].forEach(n => { const a = perLane.get(key).names; if (!a.includes(n)) a.push(n); });
      }
      if (toMin(ph.endTime) <= toMin(ph.startTime)) return;
      const label = ph.label || EVENT_TYPES[ev.type][ph.type];
      if (byEvent) {
        // セルはフェーズ名のみ。担当者は行見出しの「担当」列に羅列。行はフェーズの場所で決まる
        day.blocks.push(mkBlock(ph, laneIndex(day, laneKey(ev, ph)), label));
      } else {
        // 設営：担当にチェックした行へ。隣り合う行はひとつのブロックに結合。未選択なら（その場所の）全行
        const names = [...ph.technical, ...ph.personnel];
        const idx = names.length
          ? [...new Set(names.map(n => laneIndex(day, setupLaneName(ev, n), grp)))].sort((a, b) => a - b)
          : day.lanes.map((l, i) => (l.grp || '') === grp ? i : -1).filter(i => i >= 0);
        const text = multiEvent ? `${ev.name}\n${label}` : label;
        let run = null;
        idx.forEach(i => {
          if (run && i === run.lane1 + 1) run.lane1 = i;
          else { run = mkBlock(ph, i, text); day.blocks.push(run); }
        });
      }
    });
  });
  // 運営：テクニカルの行動（MT・休憩）→ その日、対象のテクニカルが担当に入っているイベント行すべてに重ねて表示
  // （誰の担当にも入っていなければ全イベント行。短いので前面に描かれ、下のラベルは左右に分かれる）
  if (byEvent) {
    f.techActions.forEach(a => {
      const evs = f.events.filter(e => e.date === a.date);
      if (!a.date || !evs.length) return;
      const as = toMin(a.startTime), ae = toMin(a.endTime); if (ae <= as) return;
      const day = dayFor(a.date, null);
      const targets = a.technical.length ? a.technical : f.technical;
      const hit = new Set();
      evs.forEach(ev => ev.phases.forEach(ph => { if (ph.technical.some(n => targets.includes(n))) hit.add(laneIndex(day, laneKey(ev, ph))); }));
      if (!hit.size) evs.forEach(ev => ev.phases.forEach(ph => hit.add(laneIndex(day, laneKey(ev, ph)))));
      const t = TECH_ACTION_TYPES[a.type];
      const label = a.label || t.name;
      const text = a.technical.length && a.technical.length < f.technical.length ? `${label}\n${targets.join('、')}` : label;
      // 隣り合う行はひとつのブロックに結合（全行なら1本で縦に貫く）
      let run = null;
      [...hit].sort((x, y) => x - y).forEach(li => {
        if (run && li === run.lane1 + 1) { run.lane1 = li; return; }
        run = Object.assign({
          id: `${a.id}-${li}`, gen: a.id, start: a.startTime, end: a.endTime, lane0: li, lane1: li,
          text, bg: t.bg, fg: '#000000', bold: true, size: 's', vertical: false
        }, a.style || {});
        day.blocks.push(run);
      });
    });
  }
  // 運営：「担当」列。見出し付きで「担当／テクニカル」に分け、名前は「、」区切り
  perLane.forEach(({ day, li, names }) => {
    const pers = f.personnel.filter(n => names.includes(n));
    const tech = f.technical.filter(n => names.includes(n));
    const parts = [];
    if (pers.length) parts.push('担当\n' + pers.join('、'));
    if (tech.length) parts.push('テクニカル\n' + tech.join('、'));
    const lane = day.lanes[li]; if (lane.gen || !lane.staff) lane.staff = parts.join('\n');
  });
  state.days.forEach(d => { if (dayNames.has(d.id)) { d.open = d._open || ''; d.close = d._close || ''; } delete d._open; delete d._close; });
  // 日ラベル：空、または自動で付けたものなら更新（運営＝イベント名 ／ 設営＝日程の名称、なければ本番系フェーズ名 → 仕込み/バラシ）
  const setupLabel = date => {
    const named = f.events.filter(e => e.date === date && e.label).map(e => e.label);
    if (named.length) return [...new Set(named)].join('\n');
    const phs = f.events.filter(e => e.date === date).flatMap(e => e.phases);
    const perf = phs.filter(p => p.type === 'performance').map(p => (p.label || '本番').split('\n')[0]);
    if (perf.length) return [...new Set(perf)].join('〜');
    if (phs.some(p => p.type === 'teardown') && !phs.some(p => p.type === 'setup')) return 'バラシ';
    return phs.length ? '仕込み' : '';
  };
  state.days.forEach(d => {
    if (!(!d.label || d.genLabel) || !dayNames.has(d.id)) return;
    const named = f.events.filter(e => e.date === d.date && e.label).map(e => e.label);
    d.label = byEvent ? (named.length ? named.join('\n') : [...dayNames.get(d.id)].join('\n')) : setupLabel(d.date); d.genLabel = true;
  });
  // 使われなくなった生成行を削除（末尾から順に）、行が無い日には空行を1つ
  state.days.forEach(d => {
    for (let li = d.lanes.length - 1; li >= 0; li--) {
      if (!d.lanes[li].gen) continue;
      if (!d.blocks.some(b => b.lane0 <= li && li <= b.lane1) && d.lanes.length > 1) deleteLane(d, li);
    }
    if (!d.lanes.length) d.lanes.push({ id: uid(), name: '', staff: '' });
  });
  state.days.sort((a, b) => (a.date || '9999').localeCompare(b.date || '9999'));
  if (byEvent && !state.meta.title) state.meta.title = [...new Set(f.events.map(e => e.name).filter(Boolean))].join(' / ');
  if (!state.meta.dates && state.days.length) {
    const ds = state.days.map(d => d.date).filter(Boolean);
    const j = iso => { const d = parseDate(iso); return d ? `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日${wdLabel(iso)}` : iso; };
    state.meta.dates = ds.length > 1 ? `${j(ds[0])}ー${j(ds[ds.length - 1])}` : j(ds[0]);
  }
  state.meta.updated = todayISO();
}

// ===== 表 → フォームの書き戻し（双方向同期） =====
function findPhase(phId) {
  for (const ev of state.form.events) { const ph = ev.phases.find(p => p.id === phId); if (ph) return { ev, ph }; }
  return null;
}
function findAction(id) { return state.form.techActions.find(a => a.id === id) || null; }
// フォーム由来のブロックを表の上で変えたとき、元のフェーズに反映する
function syncBlockToForm(day, block) {
  const act = block.gen && findAction(block.gen);
  if (act) { // テクニカル行動（MT・休憩）
    act.startTime = block.start; act.endTime = block.end;
    act.label = (block.text || '').split('\n')[0];
    act.style = { bg: block.bg, fg: block.fg, bold: block.bold, size: block.size, vertical: block.vertical };
    return true;
  }
  const ref = block.gen && findPhase(block.gen); if (!ref) return false;
  const { ev, ph } = ref; const f = state.form;
  const byEvent = BASES[state.base].formStyle === 'byEvent';
  ph.startTime = block.start; ph.endTime = block.end;
  let text = block.text || '';
  if (text.startsWith(ev.name + '\n')) text = text.slice(ev.name.length + 1);
  ph.label = text;
  ph.style = { bg: block.bg, fg: block.fg, bold: block.bold, size: block.size, vertical: block.vertical };
  if (!byEvent) {
    // 同じフェーズの全ブロックが覆う行 → 担当
    const covered = new Set();
    day.blocks.filter(b => b.gen === ph.id).forEach(b => { for (let i = b.lane0; i <= b.lane1; i++) covered.add(i); });
    const lanes = [...covered].sort((a, b) => a - b).map(i => day.lanes[i]).filter(Boolean);
    const names = lanes.map(l => l.name.split('\n')[0]);
    const grp = lanes[0]?.grp || '';
    const all = lanes.length === day.lanes.filter(l => (l.grp || '') === grp).length;
    if (!(all && !ph.technical.length && !ph.personnel.length)) {
      ph.technical = f.technical.filter(n => names.includes(n));
      ph.personnel = f.personnel.filter(n => names.includes(n));
    }
  }
  return true;
}
// 日の利用時間（入り〜退館）をフォームの同じ日付のイベントへ
function syncDayTimesToForm(day) {
  let hit = false;
  state.form.events.forEach(ev => { if (ev.date === day.date) { ev.start = day.open || ''; ev.end = day.close || ''; hit = true; } });
  return hit;
}
// ブロック変更後の共通処理：フォームへ書き戻し → 反映 → 保存 → 再描画
function afterBlockChange(day, block, opts = {}) {
  if (block.gen && syncBlockToForm(day, block)) { applyForm(); renderForm(); }
  save(); if (!opts.noRender) render();
}

// ===== live mode (本番進行) =====
function updateLive() {
  $$('.now-line').forEach(n => n.remove());
  $$('.block.now').forEach(b => b.classList.remove('now'));
  const panel = $('#live');
  if (mode !== 'live') { panel.hidden = true; return; }
  panel.hidden = false;
  const now = new Date();
  $('#clock').textContent = `${now.getHours()}:${String(now.getMinutes()).padStart(2, '0')}`;
  const today = todayISO();

  const sel = $('#liveDay');
  const sig = state.days.map(d => d.id + d.date + d.label).join('|');
  if (sel.dataset.sig !== sig) {
    sel.innerHTML = '';
    state.days.forEach(d => { const o = el('option', null, `${mdLabel(d.date)}${wdLabel(d.date)} ${firstLine(d.label).replace('(無題)', '')}`); o.value = d.id; sel.appendChild(o); });
    sel.dataset.sig = sig;
  }
  let day = state.days.find(d => d.id === liveDayId) || state.days.find(d => d.date === today) || state.days[0];
  const info = $('#liveInfo');
  if (!day) {
    info.textContent = '本日の日程はありません。表示する日を選んでください。';
    $('#liveNow').innerHTML = ''; $('#liveNext').innerHTML = ''; return;
  }
  sel.value = day.id;
  info.textContent = day.date === today ? '' : '※今日の日程がないため別の日を表示中（時刻は現在時刻）';

  const nowMin = now.getHours() * 60 + now.getMinutes();
  const g = gridInfo();
  const sec = $(`.day[data-id="${day.id}"]`);
  const area = sec && $('.time-area', sec);
  if (area && nowMin >= g.start && nowMin <= g.end) {
    const line = el('div', 'now-line'); line.style.left = pct(nowMin) + '%';
    line.appendChild(el('span', 'now-tag', fmt(nowMin)));
    area.appendChild(line);
  }
  const cur = day.blocks.filter(b => toMin(b.start) <= nowMin && nowMin < toMin(b.end)).sort((a, b) => a.lane0 - b.lane0);
  cur.forEach(b => sec && $(`.block[data-id="${b.id}"]`, sec)?.classList.add('now'));
  const next = day.blocks.filter(b => toMin(b.start) > nowMin).sort((a, b) => toMin(a.start) - toMin(b.start) || a.lane0 - b.lane0).slice(0, 6);

  const li = (b, extra) => {
    const l = el('li');
    l.appendChild(el('span', 't', `${b.start}–${b.end}`));
    const n = el('span', 'n', firstLine(b.text)); n.appendChild(el('div', 'lanes', laneRange(day, b))); l.appendChild(n);
    if (extra) l.appendChild(el('span', 'c', extra));
    return l;
  };
  const ulNow = $('#liveNow'); ulNow.innerHTML = '';
  if (!cur.length) ulNow.appendChild(el('li', null, '—'));
  cur.forEach(b => ulNow.appendChild(li(b, `残り${toMin(b.end) - nowMin}分`)));
  const ulNext = $('#liveNext'); ulNext.innerHTML = '';
  if (!next.length) ulNext.appendChild(el('li', null, '—'));
  next.forEach(b => ulNext.appendChild(li(b, `あと${toMin(b.start) - nowMin}分`)));
}

// ===== import / export =====
function download(name, blob) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
function fileBase() { return (state.meta.title || 'timeschedule').replace(/[\\/:*?"<>|]/g, '_').slice(0, 40); }

function exportJSON() {
  download(`${fileBase()}_TS.json`, new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' }));
}
function importJSON(file) {
  const r = new FileReader();
  r.onload = () => {
    try {
      const d = JSON.parse(r.result);
      if (d.events && !d.days) {
        // Python版（staff_data / events）形式 → 入力フォームに取り込む
        const sd = d.staff_data || {};
        commit(() => { state.form = normalizeForm({ technical: sd.technical, personnel: sd.personnel, events: d.events }); });
        closeEditor(); setMode('edit'); openSide(true); toast('フォーム形式のJSONを入力フォームに読み込みました');
        return;
      }
      if (!d.days && !d.lanes) throw new Error('形式が違います');
      const nd = normalize(d);
      if (nd.base !== base) { save(); switchBase(nd.base, { state: nd }); save(); }
      else commit(() => { state = nd; });
      closeEditor(); toast(`【${BASES[nd.base].name}】に読み込みました`);
    } catch (e) { alert('JSONを読み込めませんでした：' + e.message); }
  };
  r.readAsText(file);
}

async function exportExcel() {
  if (typeof ExcelJS === 'undefined') return alert('Excel出力ライブラリを読み込めませんでした（オフラインの可能性）。');
  const g = gridInfo(); const s = state.settings;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('タイムスケジュール', { pageSetup: { orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 } });
  const extras = []; // 行名の右に付く列（場所／担当）
  if (showLocCol()) extras.push({ title: '場所', get: l => l.loc || '' });
  if (showStaffCol()) extras.push({ title: '担当', get: l => l.staff || '' });
  const staffCol = extras.length > 0;
  const C0 = 3 + extras.length; // 時間列の開始（A=日付, B=行名, [C..=場所/担当]）
  const thin = { style: 'thin', color: { argb: 'FF000000' } };
  const border = { top: thin, left: thin, bottom: thin, right: thin };
  const fill = hex => ({ type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + hex.replace('#', '').toUpperCase() } });
  const slotCol = min => C0 + Math.round((min - g.start) / g.slot);

  ws.getColumn(1).width = 9; ws.getColumn(2).width = 16; extras.forEach((x, i) => { ws.getColumn(3 + i).width = 14; });
  for (let i = 0; i < g.slots; i++) ws.getColumn(C0 + i).width = g.slot === 60 ? 7 : g.slot === 30 ? 3.6 : 1.9;

  let r = 1;
  const m = state.meta;
  const put = (text, font) => { const c = ws.getCell(r, 1); c.value = text; c.font = font; r++; };
  if (m.program) put(m.program, { size: 9 });
  if (m.title) put(m.title, { size: 14, bold: true });
  if (m.dates) put(m.dates, { size: 10 });
  if (m.venue) put(m.venue, { size: 10 });
  if (m.updated) put(`最終更新：${m.updated}`, { size: 8, color: { argb: 'FF666666' } });
  r++;

  for (const day of state.days) {
    // 時間ヘッダー
    const hr = r;
    for (let h = s.startHour; h < s.endHour; h++) {
      const c1 = slotCol(h * 60), c2 = c1 + 60 / g.slot - 1;
      if (c2 > c1) ws.mergeCells(hr, c1, hr, c2);
      const c = ws.getCell(hr, c1); c.value = `${h}:00`; c.font = { bold: true, size: 8 }; c.alignment = { horizontal: 'center' };
      for (let cc = c1; cc <= c2; cc++) ws.getCell(hr, cc).border = border;
    }
    if (staffCol) {
      const c2 = ws.getCell(hr, 2); c2.value = BASES[state.base].formStyle === 'byEvent' ? '事業（場所）' : ''; c2.font = { bold: true, size: 8 }; c2.border = border;
      extras.forEach((x, i) => { const c = ws.getCell(hr, 3 + i); c.value = x.title; c.font = { bold: true, size: 8 }; c.border = border; });
    }
    ws.getRow(hr).height = 14;
    r++;
    // 行
    const r0 = r;
    day.lanes.forEach((lane, li) => {
      const lines = Math.max(...[lane.name, lane.staff, lane.loc].map(t => (t || '').split('\n').length), 2);
      const row = ws.getRow(r0 + li); row.height = Math.max(30, lines * 12 + 6);
      const nc = ws.getCell(r0 + li, 2); nc.value = lane.name; nc.font = { bold: true, size: 9 }; nc.border = border; nc.alignment = { vertical: 'middle', wrapText: true };
      extras.forEach((x, i) => {
        const sc = ws.getCell(r0 + li, 3 + i); const text = x.get(lane);
        if (x.title === '担当' && text) {
          // 見出し行（担当／テクニカル）を太字に
          sc.value = { richText: text.split('\n').map((line, k, arr) => ({ font: { size: 8, bold: STAFF_HEAD.test(line.trim()) }, text: line + (k < arr.length - 1 ? '\n' : '') })) };
        } else { sc.value = text; sc.font = { size: 8 }; }
        sc.border = border; sc.alignment = { vertical: 'middle', wrapText: true };
      });
      for (let i = 0; i < g.slots; i++) {
        const c = ws.getCell(r0 + li, C0 + i); c.border = border;
        const min = g.start + i * g.slot;
        const openT = day.open || s.openTime, closeT = day.close || s.closeTime;
        if ((openT && min < toMin(openT)) || (closeT && min >= toMin(closeT))) c.fill = fill('#9B9B9B');
      }
    });
    // 日付セル
    const r1 = r0 + day.lanes.length - 1;
    if (r1 > r0) ws.mergeCells(r0, 1, r1, 1);
    const dc = ws.getCell(r0, 1);
    dc.value = `${mdLabel(day.date)}\n${wdLabel(day.date)}${day.label ? '\n・\n' + day.label : ''}`;
    dc.font = { bold: true, size: 9 }; dc.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }; dc.border = border;
    for (let rr = r0; rr <= r1; rr++) ws.getCell(rr, 1).border = border;
    // ブロック
    for (const b of day.blocks) {
      const c1 = clamp(slotCol(toMin(b.start)), C0, C0 + g.slots - 1);
      const c2 = clamp(slotCol(toMin(b.end)) - 1, c1, C0 + g.slots - 1);
      const ra = r0 + b.lane0, rb = r0 + b.lane1;
      try { if (ra !== rb || c1 !== c2) ws.mergeCells(ra, c1, rb, c2); } catch (e) { /* 重なりは結合せず塗るだけ */ }
      const c = ws.getCell(ra, c1);
      c.value = b.text; c.fill = fill(b.bg);
      c.font = { bold: !!b.bold, size: b.size === 's' ? 7 : b.size === 'l' ? 10 : 8, color: { argb: 'FF' + b.fg.replace('#', '').toUpperCase() } };
      c.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true, textRotation: b.vertical ? 'vertical' : 0 };
      for (let rr = ra; rr <= rb; rr++) for (let cc = c1; cc <= c2; cc++) { const x = ws.getCell(rr, cc); x.border = border; if (rr !== ra || cc !== c1) x.fill = fill(b.bg); }
    }
    r = r1 + 1;
    if (day.notes) { const c = ws.getCell(r, 2); c.value = day.notes; c.font = { size: 8 }; c.alignment = { wrapText: true }; ws.mergeCells(r, 2, r, C0 + g.slots - 1); r++; }
    r++;
  }
  if (state.notes) {
    ws.getCell(r, 1).value = 'NOTE'; ws.getCell(r, 1).font = { bold: true, size: 9 }; r++;
    state.notes.split('\n').forEach(line => { ws.getCell(r, 1).value = line; ws.getCell(r, 1).font = { size: 9 }; r++; });
  }
  // 入力フォームがあれば「スタッフマスター」「イベント詳細」シートも追加（Python版と同じ構成）
  const fm = state.form;
  if (fm && (fm.events.length || fm.technical.length || fm.personnel.length)) {
    const hdr = { bold: true }; const hfill = fill('#CCCCCC');
    const sw = wb.addWorksheet('スタッフマスター');
    sw.getCell(1, 1).value = 'テクニカル'; sw.getCell(1, 2).value = '担当者';
    [sw.getCell(1, 1), sw.getCell(1, 2)].forEach(c => { c.font = hdr; c.fill = hfill; });
    fm.technical.forEach((n, i) => sw.getCell(i + 2, 1).value = n);
    fm.personnel.forEach((n, i) => sw.getCell(i + 2, 2).value = n);
    sw.getColumn(1).width = 20; sw.getColumn(2).width = 20;
    if (fm.events.length) {
      const dw = wb.addWorksheet('イベント詳細');
      ['日付', 'イベント名', 'タイプ', '場所', 'フェーズ', 'ラベル', '開始時刻', '終了時刻', 'テクニカル', '担当者'].forEach((h, i) => { const c = dw.getCell(1, i + 1); c.value = h; c.font = hdr; c.fill = hfill; });
      let rr = 2;
      fm.events.forEach(ev => ev.phases.forEach(ph => {
        const vals = [ev.date, ev.name, EVENT_TYPES[ev.type].name, ev.location, EVENT_TYPES[ev.type][ph.type], ph.label, ph.startTime, ph.endTime, ph.technical.join(', '), ph.personnel.join(', ')];
        vals.forEach((v, i) => { const c = dw.getCell(rr, i + 1); c.value = v; c.fill = fill(PHASE_COLORS[ph.type]); });
        rr++;
      }));
      for (let i = 1; i <= 10; i++) dw.getColumn(i).width = 15;
    }
  }
  const buf = await wb.xlsx.writeBuffer();
  download(`${fileBase()}_TS.xlsx`, new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  toast('Excelを書き出しました');
}

// ===== share URL =====
function shareURL(viewMode) {
  if (typeof LZString === 'undefined') return '';
  const d = LZString.compressToEncodedURIComponent(JSON.stringify(state));
  return `${location.origin}${location.pathname}#${viewMode ? 'm=view&' : ''}d=${d}`;
}
function loadFromHash() {
  if (!location.hash.startsWith('#')) return null;
  const p = new URLSearchParams(location.hash.slice(1));
  const out = { mode: p.get('m'), data: null };
  const d = p.get('d');
  if (d && typeof LZString !== 'undefined') {
    try { out.data = normalize(JSON.parse(LZString.decompressFromEncodedURIComponent(d))); } catch (e) { out.data = null; }
  }
  return out;
}

// ===== settings dialog =====
function openSettings() {
  const s = state.settings;
  const fillH = (sel, from, to, val) => { sel.innerHTML = ''; for (let h = from; h <= to; h++) { const o = el('option', null, `${h}:00`); o.value = h; sel.appendChild(o); } sel.value = val; };
  fillH($('#stStart'), 0, 23, s.startHour); fillH($('#stEnd'), 1, 24, s.endHour);
  $('#stSlot').value = s.slot; $('#stOpen').value = s.openTime || ''; $('#stClose').value = s.closeTime || '';
  const dlg = $('#dlgSettings');
  dlg.onclose = () => {
    if (dlg.returnValue !== 'ok') return;
    const st = +$('#stStart').value, en = +$('#stEnd').value;
    if (en <= st) return alert('表示終了は表示開始より後にしてください');
    commit(() => {
      s.startHour = st; s.endHour = en; s.slot = +$('#stSlot').value;
      s.openTime = $('#stOpen').value; s.closeTime = $('#stClose').value;
    });
  };
  dlg.showModal();
}

// ===== init =====
function setMode(m) {
  mode = m;
  if (m !== 'edit') closeEditor();
  render();
}

function init() {
  initEditor();
  try { base = BASES[localStorage.getItem(BASE_KEY)] ? localStorage.getItem(BASE_KEY) : (localStorage.getItem(STORAGE_KEY) ? 'setup' : 'ops'); } catch (e) { /* ignore */ }
  const h = loadFromHash();
  if (h && h.mode === 'view') mode = 'view';
  if (h && h.data) {
    const kind = h.data.base;
    const stored = load(kind);
    const ok = !stored || confirm(`共有URLのデータ【${BASES[kind].name}】を読み込みますか？\n（現在このブラウザに保存されている【${BASES[kind].name}】のデータは置き換わります。残したい場合はキャンセルして先に「JSON保存」してください）`);
    switchBase(kind, ok ? { state: h.data } : {});
    if (ok) save();
    window.history.replaceState(null, '', location.pathname);
  } else {
    switchBase(base);
  }

  $$('#modeSeg button').forEach(b => b.addEventListener('click', () => setMode(b.dataset.mode)));
  $('#btnUndo').addEventListener('click', undo);
  $('#btnNew').addEventListener('click', () => { if (confirm(`【${BASES[base].name}】の新しいタイムスケジュールを作成しますか？（現在の内容は「元に戻す」で復元できます）`)) { commit(() => { state = newState(base); }); closeEditor(); } });
  $('#btnSample').addEventListener('click', () => { if (confirm(`【${BASES[base].name}】のサンプル（${BASES[base].sampleName}）を読み込みますか？`)) { commit(() => { state = sampleState(base); }); closeEditor(); } });
  $('#baseBadge').addEventListener('click', () => { setMode('edit'); openSide(true); });
  $('#btnSide').addEventListener('click', () => openSide(document.body.classList.contains('side-closed')));
  try { if (localStorage.getItem('kac_ts_side') === 'closed') document.body.classList.add('side-closed'); } catch (e) { /* ignore */ }
  renderForm();
  $('#btnSettings').addEventListener('click', openSettings);
  $('#btnImport').addEventListener('click', () => $('#fileInput').click());
  $('#fileInput').addEventListener('change', e => { if (e.target.files[0]) importJSON(e.target.files[0]); e.target.value = ''; });
  $('#btnExport').addEventListener('click', exportJSON);
  $('#btnExcel').addEventListener('click', () => exportExcel().catch(err => alert('Excel出力に失敗しました：' + err.message)));
  $('#btnPrint').addEventListener('click', () => window.print());
  $('#btnShare').addEventListener('click', () => {
    const e = shareURL(false), v = shareURL(true);
    if (!e) return alert('共有URLを作成できませんでした（オフラインの可能性）');
    $('#shareEdit').value = e; $('#shareView').value = v;
    $('#dlgShare').showModal();
  });
  $$('#dlgShare [data-copy]').forEach(b => b.addEventListener('click', async () => {
    const inp = $('#' + b.dataset.copy); inp.select();
    try { await navigator.clipboard.writeText(inp.value); toast('コピーしました'); } catch (e) { document.execCommand('copy'); toast('コピーしました'); }
  }));
  $('#liveDay').addEventListener('change', e => { liveDayId = e.target.value; updateLive(); });

  // 印刷時は閲覧モードの見た目にする
  let modeBeforePrint = null;
  window.addEventListener('beforeprint', () => { if (mode === 'edit') { modeBeforePrint = mode; mode = 'view'; render(); } });
  window.addEventListener('afterprint', () => { if (modeBeforePrint) { mode = modeBeforePrint; modeBeforePrint = null; render(); } });

  document.addEventListener('keydown', e => {
    const inField = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName);
    if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !inField) { e.preventDefault(); undo(); }
    if (e.key === 'Escape') { closeEditor(); }
    if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId && !inField) { e.preventDefault(); deleteSelected(); }
  });
  // 空白クリックで選択解除
  $('#sheet').addEventListener('pointerdown', e => { if (!e.target.closest('.block') && !e.target.closest('.cell')) selectBlock(null); });

  setInterval(updateLive, 15000);
}
document.addEventListener('DOMContentLoaded', init);
