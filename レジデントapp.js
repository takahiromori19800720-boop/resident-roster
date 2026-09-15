/* ============================================================
   レジデント勤務表 — アプリ本体
   ============================================================
   - Firebase Firestore (rr_staff / rr_months) で共有
   - Google Calendar API で共有カレンダーへ同期
   - SheetJS でブラウザ内 Excel 生成
   - JSX は index.html の Babel Standalone がブラウザ内で変換
   ============================================================ */

const { useState, useEffect, useMemo, useRef, Fragment } = React;
const CONFIG = window.APP_CONFIG;
const RULES = Object.assign({ midoriSlot: 'w1', holidaySlots: 2, deadlineDay: 15, silverWeekMinDays: 4 }, CONFIG.rules || {});

/* ───────── Firebase ───────── */
firebase.initializeApp(CONFIG.firebase);
const db = firebase.firestore();
const FV = firebase.firestore.FieldValue;
const staffCol  = () => db.collection('rr_staff');
const monthsCol = () => db.collection('rr_months');

/* ───────── Codes ───────── */
const CODES = {
  toban:    { label: '当番',   group: 'duty',  note: '平日オンコール（月〜木）' },
  w1:       { label: '週末①', group: 'duty',  note: '週末当番①（金土日）' },
  w2:       { label: '週末②', group: 'duty',  note: '週末当番②（金土日）' },
  h1:       { label: '祝日①', group: 'duty',  note: '祝日当番①' },
  h2:       { label: '祝日②', group: 'duty',  note: '祝日当番②' },
  nakazawa: { label: '中澤',   group: 'ext',   note: '中澤病院（毎週月曜・外来チーム）' },
  urakami:  { label: '浦上',   group: 'ext',   note: '浦上病院（第2土日 日当直・外来チーム）' },
  kinen:    { label: '記念',   group: 'ext',   note: '上田記念病院（第1土曜午前・希望者）' },
  gairai:   { label: '外来',   group: 'fixed', note: '外来チーム期間' },
  tochoku:  { label: '当直',   group: 'fixed', note: '当直（当直表より）' },
  ake:      { label: '明け',   group: 'fixed', note: '当直明け' },
  yakan:    { label: '夜間初期', group: 'fixed', note: '夜間初期診療センター（翌日も勤務）' },
  gsapo:    { label: '外サポ', group: 'fixed', note: '外来サポート（翌日も勤務）' },
  junya:    { label: '準夜',   group: 'fixed', note: '準夜勤' },
};
const SELF_CODES = ['tochoku', 'yakan', 'gsapo', 'junya'];   // 各自が入力する病院勤務
const DUTY_CODES = ['toban', 'w1', 'w2', 'h1', 'h2', 'nakazawa', 'urakami', 'kinen'];
const codeLabel = (c) => CODES[c]?.label || c;
const MIDORI = RULES.midoriSlot === 'w2' ? 'w2' : 'w1';
const OTHER_W = MIDORI === 'w1' ? 'w2' : 'w1';
const MIDORI_H = MIDORI === 'w1' ? 'h1' : 'h2';               // 祝日のみどり兼任スロット

/* ───────── Date helpers ───────── */
const pad2 = (n) => String(n).padStart(2, '0');
const ymOf = (y, m) => `${y}-${pad2(m + 1)}`;              // m: 0-based
const parseYm = (ym) => { const [y, m] = ym.split('-').map(Number); return { y, m: m - 1 }; };
const addMonths = (ym, k) => { const { y, m } = parseYm(ym); const d = new Date(y, m + k, 1); return ymOf(d.getFullYear(), d.getMonth()); };
const daysInMonth = (y, m) => new Date(y, m + 1, 0).getDate();
const dateKey = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const fromKey = (k) => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
const ymOfKey = (k) => k.slice(0, 7);
const dayOfKey = (k) => Number(k.slice(8, 10));
const addDays = (d, k) => { const x = new Date(d); x.setDate(x.getDate() + k); return x; };
const keyPlus = (k, n) => dateKey(addDays(fromKey(k), n));
const dowJP = ['日', '月', '火', '水', '木', '金', '土'];
const dowOfKey = (k) => fromKey(k).getDay();
const fmtYm = (ym) => { const { y, m } = parseYm(ym); return `${y}年${m + 1}月`; };
const fmtMd = (k) => `${Number(k.slice(5, 7))}/${Number(k.slice(8, 10))}(${dowJP[dowOfKey(k)]})`;
const monthKeys = (ym) => { const { y, m } = parseYm(ym); const n = daysInMonth(y, m); return Array.from({ length: n }, (_, i) => `${ym}-${pad2(i + 1)}`); };
const rangeYms = (startYm, n) => Array.from({ length: n }, (_, i) => addMonths(startYm, i));
const deadlineOf = (ym) => `${addMonths(ym, -1)}-${pad2(RULES.deadlineDay)}`;
const fiscalYearOf = (ym) => { const { y, m } = parseYm(ym); return m >= 3 ? y : y - 1; };
const fiscalMonths = (fy) => rangeYms(`${fy}-04`, 12);

/* ───────── Japanese holidays ───────── */
const _hCache = {};
function getHolidays(year) {
  if (_hCache[year]) return _hCache[year];
  const h = {};
  h[`${year}-01-01`] = '元日';
  h[`${year}-02-11`] = '建国記念の日';
  h[`${year}-02-23`] = '天皇誕生日';
  h[`${year}-04-29`] = '昭和の日';
  h[`${year}-05-03`] = '憲法記念日';
  h[`${year}-05-04`] = 'みどりの日';
  h[`${year}-05-05`] = 'こどもの日';
  h[`${year}-08-11`] = '山の日';
  h[`${year}-11-03`] = '文化の日';
  h[`${year}-11-23`] = '勤労感謝の日';
  const nthMon = (m, n) => { const first = new Date(year, m - 1, 1).getDay(); return ((8 - first) % 7) + 1 + (n - 1) * 7; };
  h[`${year}-01-${pad2(nthMon(1, 2))}`]  = '成人の日';
  h[`${year}-07-${pad2(nthMon(7, 3))}`]  = '海の日';
  h[`${year}-09-${pad2(nthMon(9, 3))}`]  = '敬老の日';
  h[`${year}-10-${pad2(nthMon(10, 2))}`] = 'スポーツの日';
  const shun = Math.floor(20.8431 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4));
  const shu  = Math.floor(23.2488 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4));
  h[`${year}-03-${pad2(shun)}`] = '春分の日';
  h[`${year}-09-${pad2(shu)}`]  = '秋分の日';
  Object.keys(h).slice().forEach(k => {                       // 振替休日
    const date = fromKey(k);
    if (date.getDay() === 0) {
      let next = addDays(date, 1);
      while (h[dateKey(next)]) next = addDays(next, 1);
      h[dateKey(next)] = '振替休日';
    }
  });
  const isNamed = (k) => h[k] && h[k] !== '振替休日';        // 国民の休日
  for (let m = 0; m < 12; m++) {
    for (let d = 1; d <= daysInMonth(year, m); d++) {
      const key = `${year}-${pad2(m + 1)}-${pad2(d)}`;
      if (h[key]) continue;
      if (isNamed(keyPlus(key, -1)) && isNamed(keyPlus(key, 1))) h[key] = '国民の休日';
    }
  }
  _hCache[year] = h;
  return h;
}
const holidayName = (k) => getHolidays(Number(k.slice(0, 4)))[k] || null;
const isHolidayKey = (k) => !!holidayName(k);
const isOffKey = (k) => { const w = dowOfKey(k); return w === 0 || w === 6 || isHolidayKey(k); };
const isWeekdayHoliday = (k) => { const w = dowOfKey(k); return w >= 1 && w <= 5 && isHolidayKey(k); };
const isTobanDay = (k) => { const w = dowOfKey(k); return w >= 1 && w <= 4 && !isHolidayKey(k); };

/* ───────── 別枠 (GW / SW / 年末年始) ───────── */
const _sCache = {};
function specialWindows(year) {
  if (_sCache[year]) return _sCache[year];
  const extend = (start, end) => {
    while (isOffKey(keyPlus(start, -1))) start = keyPlus(start, -1);
    while (isOffKey(keyPlus(end, 1))) end = keyPlus(end, 1);
    return { start, end };
  };
  const out = [];
  out.push({ name: 'GW', ...extend(`${year}-04-29`, `${year}-05-05`) });
  out.push({ name: '年末年始', ...extend(`${year}-12-29`, `${year + 1}-01-03`) });
  const keiro = Object.keys(getHolidays(year)).find(k => getHolidays(year)[k] === '敬老の日');
  if (keiro) {
    const sw = extend(keiro, keiro);
    const len = Math.round((fromKey(sw.end) - fromKey(sw.start)) / 86400000) + 1;
    if (len >= RULES.silverWeekMinDays) out.push({ name: 'SW', ...sw });
  }
  _sCache[year] = out;
  return out;
}
function specialNameOf(k) {
  const y = Number(k.slice(0, 4));
  for (const w of [...specialWindows(y - 1), ...specialWindows(y)]) if (k >= w.start && k <= w.end) return w.name;
  return null;
}

/* ───────── Weekend blocks ───────── */
function weekendBlocks(startYm, count) {
  const yms = rangeYms(startYm, count);
  const out = [];
  yms.forEach(ym => monthKeys(ym).forEach(k => {
    if (dowOfKey(k) !== 6) return;
    const days = [keyPlus(k, -1), k, keyPlus(k, 1)];
    const sat = fromKey(k);
    const nth = Math.ceil(sat.getDate() / 7);
    out.push({ satKey: k, ym, days, nth, isFirstSat: nth === 1, isSecondSat: nth === 2,
      specialAuto: days.map(specialNameOf).find(Boolean) || null });
  }));
  return out;
}

/* ───────── Month data accessors ───────── */
const getCode = (months, k, sid) => months[ymOfKey(k)]?.cells?.[sid]?.[String(dayOfKey(k))] || '';
const isNg    = (months, k, sid) => !!months[ymOfKey(k)]?.ng?.[sid]?.[String(dayOfKey(k))];
const teamOf  = (months, ym, sid) => months[ym]?.teams?.[sid] || '';
const isLeader = (months, ym, sid) => !!months[ym]?.leaders?.[sid];
const tochokuBefore = (months, k, sid) => getCode(months, keyPlus(k, -1), sid) === 'tochoku';   // 前日が当直
const holdersOf = (months, k, code, staff) => staff.filter(s => getCode(months, k, s.id) === code).map(s => s.id);
const isBlockSpecial = (months, b) => {
  const ov = months[b.ym]?.special?.[b.satKey];
  return ov === undefined ? !!b.specialAuto : !!ov;
};

const isStaffActiveIn = (s, ym) => {
  if (!s || s.status !== 'active' || s.noDuty) return false;
  if (s.startYm && ym < s.startYm) return false;
  if (s.endYm && ym > s.endYm) return false;
  return true;
};
const activeIn = (staff, ym) => staff.filter(s => isStaffActiveIn(s, ym));

/* 人 sid が日 k に「その枠に入れる」か（枠 code 以外が入っていたら不可） */
const cellFreeFor = (months, k, sid, code) => {
  const c = getCode(months, k, sid);
  return (!c || c === code) && !isNg(months, k, sid);
};
/* 外来期間の中か（前後の日が外来） */
const gairaiAround = (months, k, sid, r = 1) => {
  for (let i = -r; i <= r; i++) if (getCode(months, keyPlus(k, i), sid) === 'gairai') return true;
  return false;
};

/* ───────── Counts (年度: 4月〜3月) ───────── */
function countsFor(months, staff, fy) {
  const out = Object.fromEntries(staff.map(s => [s.id, { w: 0, toban: 0, h: 0, nakazawa: 0, urakami: 0, kinen: 0, tochoku: 0 }]));
  fiscalMonths(fy).forEach(ym => {
    const cells = months[ym]?.cells || {};
    Object.entries(cells).forEach(([sid, days]) => {
      if (!out[sid]) return;
      Object.entries(days).forEach(([d, c]) => {
        const k = `${ym}-${pad2(Number(d))}`;
        if ((c === 'w1' || c === 'w2') && dowOfKey(k) === 6) out[sid].w++;       // 週末は土曜で1ブロック
        else if (c === 'toban') out[sid].toban++;
        else if (c === 'h1' || c === 'h2') out[sid].h++;
        else if (c === 'nakazawa') out[sid].nakazawa++;
        else if (c === 'urakami' && dowOfKey(k) === 6) out[sid].urakami++;
        else if (c === 'kinen') out[sid].kinen++;
        else if (c === 'tochoku') out[sid].tochoku++;
      });
    });
  });
  return out;
}

/* ───────── Validation ───────── */
function validate(months, staff, yms) {
  const issues = [];   // { level: 'error'|'warn'|'info', key, sid?, msg }
  const byId = Object.fromEntries(staff.map(s => [s.id, s]));
  const nameOf = (sid) => byId[sid]?.name || sid;
  const add = (level, key, sid, msg) => issues.push({ level, key, sid, msg });
  const startYm = yms[0];
  const blocks = weekendBlocks(startYm, yms.length);

  // --- weekend blocks ---
  let prevPair = null;
  const prevBlock = weekendBlocks(addMonths(startYm, -1), 1).pop();
  if (prevBlock) prevPair = new Set([...holdersOf(months, prevBlock.satKey, 'w1', staff), ...holdersOf(months, prevBlock.satKey, 'w2', staff)]);
  blocks.forEach(b => {
    const special = isBlockSpecial(months, b);
    const w1 = holdersOf(months, b.satKey, 'w1', staff);
    const w2 = holdersOf(months, b.satKey, 'w2', staff);
    if (w1.length > 1) add('error', b.satKey, null, `${fmtMd(b.satKey)} 週末①が複数人に入っています`);
    if (w2.length > 1) add('error', b.satKey, null, `${fmtMd(b.satKey)} 週末②が複数人に入っています`);
    if (!special) {
      if (!w1.length) add('info', b.satKey, null, `${fmtMd(b.satKey)} 週末① 未割当`);
      if (!w2.length) add('info', b.satKey, null, `${fmtMd(b.satKey)} 週末② 未割当`);
    }
    const a = w1[0], c = w2[0];
    if (a && c && a === c) add('error', b.satKey, a, `${fmtMd(b.satKey)} ${nameOf(a)} が週末①②の両方に入っています`);
    const midori = MIDORI === 'w1' ? a : c;
    if (midori && !byId[midori]?.omura) add('error', b.satKey, midori, `${fmtMd(b.satKey)} ${nameOf(midori)} は大村在住ではありません（みどり兼任は大村在住者）`);
    if (a && c && teamOf(months, b.ym, a) && teamOf(months, b.ym, a) === teamOf(months, b.ym, c))
      add('error', b.satKey, c, `${fmtMd(b.satKey)} ${nameOf(a)} と ${nameOf(c)} が同じチーム（${teamOf(months, b.ym, a)}）です`);
    [['w1', a], ['w2', c]].forEach(([slot, sid]) => {
      if (!sid) return;
      if (!isStaffActiveIn(byId[sid], b.ym)) add('error', b.satKey, sid, `${fmtMd(b.satKey)} ${nameOf(sid)} は在籍期間外です`);
      if (!special) b.days.forEach(k => {
        const code = getCode(months, k, sid);
        if (code !== slot) add('warn', k, sid, `${fmtMd(k)} ${nameOf(sid)} の${codeLabel(slot)}が3日そろっていません（${code ? codeLabel(code) : '空欄'}）`);
        if (isNg(months, k, sid)) add('error', k, sid, `${fmtMd(k)} ${nameOf(sid)} の不可日（✖）に${codeLabel(slot)}が入っています`);
      });
      if (gairaiAround(months, b.days[0], sid, 1) && gairaiAround(months, b.days[2], sid, 1))
        add('error', b.satKey, sid, `${fmtMd(b.satKey)} ${nameOf(sid)} は外来期間中です`);
      if (tochokuBefore(months, b.days[0], sid)) add('error', b.satKey, sid, `${fmtMd(b.satKey)} ${nameOf(sid)} は木曜当直（金曜の申し送りがあるため週末当番不可）`);
      if (prevPair && prevPair.has(sid)) add('warn', b.satKey, sid, `${fmtMd(b.satKey)} ${nameOf(sid)} は2週連続の週末当番です`);
    });
    // 記念 (第1土曜)
    const kin = holdersOf(months, b.satKey, 'kinen', staff);
    kin.forEach(sid => {
      if (sid === a || sid === c) add('error', b.satKey, sid, `${fmtMd(b.satKey)} ${nameOf(sid)} が記念と週末当番の両方に入っています`);
      if (!byId[sid]?.ueda) add('warn', b.satKey, sid, `${fmtMd(b.satKey)} ${nameOf(sid)} は上田記念の希望者ではありません`);
      if (!b.isFirstSat) add('warn', b.satKey, sid, `${fmtMd(b.satKey)} 記念は第1土曜のみです`);
    });
    if (b.isFirstSat && !kin.length && staff.some(s => s.ueda && isStaffActiveIn(s, b.ym))) add('info', b.satKey, null, `${fmtMd(b.satKey)} 記念（第1土曜）未割当`);
    // 浦上 (第2土日)
    const ur = holdersOf(months, b.satKey, 'urakami', staff);
    const urSun = holdersOf(months, b.days[2], 'urakami', staff);
    if (b.isSecondSat) {
      if (!ur.length) add('info', b.satKey, null, `${fmtMd(b.satKey)} 浦上（第2土日）未割当`);
      ur.forEach(sid => {
        if (!urSun.includes(sid)) add('warn', b.satKey, sid, `${fmtMd(b.satKey)} ${nameOf(sid)} の浦上が日曜に入っていません`);
        if (!gairaiAround(months, b.days[0], sid, 1) && !gairaiAround(months, b.days[2], sid, 1)) add('warn', b.satKey, sid, `${fmtMd(b.satKey)} ${nameOf(sid)} は外来チームではないようです（浦上）`);
      });
    } else {
      ur.forEach(sid => add('warn', b.satKey, sid, `${fmtMd(b.satKey)} 浦上は第2土日のみです`));
    }
    prevPair = new Set([...w1, ...w2]);
  });

  // --- per-day checks ---
  yms.forEach(ym => monthKeys(ym).forEach(k => {
    const dow = dowOfKey(k);
    const special = specialNameOf(k);
    const tb = holdersOf(months, k, 'toban', staff);
    if (isTobanDay(k) && !tb.length) add('info', k, null, `${fmtMd(k)} 当番 未割当`);
    if (tb.length > 1) add('error', k, null, `${fmtMd(k)} 当番が複数人に入っています`);
    tb.forEach(sid => {
      if (!isTobanDay(k)) add('warn', k, sid, `${fmtMd(k)} 平日当番は月〜木のみです（${nameOf(sid)}）`);
      if (gairaiAround(months, k, sid, 1)) add('error', k, sid, `${fmtMd(k)} ${nameOf(sid)} は外来期間中です（当番不可）`);
      if (tochokuBefore(months, k, sid)) add('error', k, sid, `${fmtMd(k)} ${nameOf(sid)} は前日当直（翌日は当番なし）`);
      if (isLeader(months, ym, sid)) add('warn', k, sid, `${fmtMd(k)} ${nameOf(sid)} はスタッフ枠リーダー（平日当番は免除）`);
      if (isNg(months, k, sid)) add('error', k, sid, `${fmtMd(k)} ${nameOf(sid)} の不可日（✖）に当番が入っています`);
      if (!isStaffActiveIn(byId[sid], ym)) add('error', k, sid, `${fmtMd(k)} ${nameOf(sid)} は在籍期間外です`);
    });
    if (dow === 1 && !isHolidayKey(k)) {
      const nz = holdersOf(months, k, 'nakazawa', staff);
      if (!nz.length) add('info', k, null, `${fmtMd(k)} 中澤（月曜）未割当`);
      nz.forEach(sid => { if (!gairaiAround(months, k, sid, 3)) add('warn', k, sid, `${fmtMd(k)} ${nameOf(sid)} は外来チームではないようです（中澤）`); });
    } else {
      holdersOf(months, k, 'nakazawa', staff).forEach(sid => add('warn', k, sid, `${fmtMd(k)} 中澤は毎週月曜（平日）のみです`));
    }
    if (isWeekdayHoliday(k)) {
      const h1 = holdersOf(months, k, 'h1', staff), h2 = holdersOf(months, k, 'h2', staff);
      if (!h1.length) add('info', k, null, `${fmtMd(k)} ${holidayName(k)} 祝日① 未割当${special ? `（別枠: ${special}）` : ''}`);
      if (RULES.holidaySlots >= 2 && !h2.length) add('info', k, null, `${fmtMd(k)} ${holidayName(k)} 祝日② 未割当${special ? `（別枠: ${special}）` : ''}`);
      if (h1[0] && h2[0] && h1[0] === h2[0]) add('error', k, h1[0], `${fmtMd(k)} ${nameOf(h1[0])} が祝日①②の両方に入っています`);
      const hm = (MIDORI_H === 'h1' ? h1 : h2)[0];
      if (hm && !byId[hm]?.omura) add('error', k, hm, `${fmtMd(k)} ${nameOf(hm)} は大村在住ではありません（祝日${codeLabel(MIDORI_H).slice(-1)}はみどり兼任）`);
      [...h1, ...h2].forEach(sid => {
        if (isNg(months, k, sid)) add('error', k, sid, `${fmtMd(k)} ${nameOf(sid)} の不可日（✖）に祝日当番が入っています`);
        if (gairaiAround(months, k, sid, 1)) add('error', k, sid, `${fmtMd(k)} ${nameOf(sid)} は外来期間中です（祝日当番）`);
      });
    } else {
      [...holdersOf(months, k, 'h1', staff), ...holdersOf(months, k, 'h2', staff)].forEach(sid => add('warn', k, sid, `${fmtMd(k)} 祝日当番が祝日以外に入っています（${nameOf(sid)}）`));
    }
    // ✖ に何か入っている（当番類以外）
    staff.forEach(s => {
      const c = getCode(months, k, s.id);
      if (c && isNg(months, k, s.id) && !['toban', 'w1', 'w2', 'h1', 'h2'].includes(c) && DUTY_CODES.includes(c))
        add('error', k, s.id, `${fmtMd(k)} ${s.name} の不可日（✖）に${codeLabel(c)}が入っています`);
    });
  }));
  return issues;
}

/* ───────── Auto draft ───────── */
const shuffle = (arr) => { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

/* 週末当番の下書き（空いているブロックだけ埋める） */
function draftWeekends(months, staff, startYm, count) {
  const entries = [];
  const skipped = [];
  const local = JSON.parse(JSON.stringify(months));            // 仮置き用コピー
  const put = (k, sid, code) => {
    const ym = ymOfKey(k), d = String(dayOfKey(k));
    if (!local[ym]) local[ym] = {}; if (!local[ym].cells) local[ym].cells = {}; if (!local[ym].cells[sid]) local[ym].cells[sid] = {};
    local[ym].cells[sid][d] = code; entries.push({ ym, sid, d: Number(d), code });
  };
  const fy = fiscalYearOf(startYm);
  const counts = countsFor(months, staff, fy);
  const rangeCount = Object.fromEntries(staff.map(s => [s.id, 0]));
  const blocks = weekendBlocks(startYm, count);
  const prevBlock = weekendBlocks(addMonths(startYm, -1), 1).pop();
  let prevPair = prevBlock ? new Set([...holdersOf(months, prevBlock.satKey, 'w1', staff), ...holdersOf(months, prevBlock.satKey, 'w2', staff)]) : new Set();

  blocks.forEach(b => {
    if (isBlockSpecial(local, b)) { prevPair = new Set([...holdersOf(local, b.satKey, 'w1', staff), ...holdersOf(local, b.satKey, 'w2', staff)]); return; }
    const cur = { w1: holdersOf(local, b.satKey, 'w1', staff)[0], w2: holdersOf(local, b.satKey, 'w2', staff)[0] };
    const pool = activeIn(staff, b.ym);
    const eligible = (sid, slot) => b.days.every(k => cellFreeFor(local, k, sid, slot)) &&
      !tochokuBefore(local, b.days[0], sid) &&
      !(gairaiAround(local, b.days[0], sid, 1) && gairaiAround(local, b.days[2], sid, 1));
    const score = (sid) => (counts[sid]?.w || 0) + rangeCount[sid] * 1.0 + (prevPair.has(sid) ? 0.75 : 0);
    const pick = (cands) => shuffle(cands).sort((x, y) => score(x) - score(y))[0];

    const order = MIDORI === 'w1' ? ['w1', 'w2'] : ['w2', 'w1'];
    order.forEach(slot => {
      if (cur[slot]) return;
      let cands = pool.filter(s => eligible(s.id, slot)).map(s => s.id);
      if (slot === MIDORI) cands = cands.filter(sid => staff.find(s => s.id === sid)?.omura);
      const other = cur[slot === 'w1' ? 'w2' : 'w1'];
      if (other) {
        cands = cands.filter(sid => sid !== other);
        const ot = teamOf(local, b.ym, other);
        if (ot) cands = cands.filter(sid => teamOf(local, b.ym, sid) !== ot);
      }
      const chosen = pick(cands);
      if (!chosen) { skipped.push(`${fmtMd(b.satKey)} ${codeLabel(slot)}：候補なし`); return; }
      b.days.forEach(k => put(k, chosen, slot));
      cur[slot] = chosen; rangeCount[chosen]++;
    });
    prevPair = new Set([cur.w1, cur.w2].filter(Boolean));
  });
  return { entries, skipped };
}

/* 平日当番・中澤・浦上・記念の下書き（1か月） */
function draftMonth(months, staff, ym) {
  const entries = [];
  const skipped = [];
  const local = JSON.parse(JSON.stringify(months));
  const put = (k, sid, code) => {
    const y = ymOfKey(k), d = String(dayOfKey(k));
    if (!local[y]) local[y] = {}; if (!local[y].cells) local[y].cells = {}; if (!local[y].cells[sid]) local[y].cells[sid] = {};
    local[y].cells[sid][d] = code; entries.push({ ym: y, sid, d: Number(d), code });
  };
  const counts = countsFor(months, staff, fiscalYearOf(ym));
  const mc = Object.fromEntries(staff.map(s => [s.id, { toban: 0, nakazawa: 0, kinen: 0, urakami: 0 }]));
  const pool = activeIn(staff, ym);
  const pick = (cands, key) => shuffle(cands).sort((x, y) => (counts[x]?.[key] || 0) + mc[x][key] * 1.5 - ((counts[y]?.[key] || 0) + mc[y][key] * 1.5))[0];
  let prevToban = null;

  monthKeys(ym).forEach(k => {
    const dow = dowOfKey(k);
    // 平日当番（月〜木）
    if (isTobanDay(k) && !holdersOf(local, k, 'toban', staff).length) {
      let cands = pool.filter(s => cellFreeFor(local, k, s.id, 'toban') && !gairaiAround(local, k, s.id, 1)
        && !tochokuBefore(local, k, s.id) && !isLeader(local, ym, s.id)).map(s => s.id);
      if (cands.length > 1 && prevToban) cands = cands.filter(sid => sid !== prevToban);
      const c = pick(cands, 'toban');
      if (c) { put(k, c, 'toban'); mc[c].toban++; prevToban = c; } else skipped.push(`${fmtMd(k)} 当番：候補なし`);
    }
    // 中澤（月曜・外来チーム）
    if (dow === 1 && !isHolidayKey(k) && !holdersOf(local, k, 'nakazawa', staff).length) {
      const cands = pool.filter(s => getCode(local, k, s.id) === 'gairai' && !isNg(local, k, s.id)).map(s => s.id);
      const c = pick(cands, 'nakazawa');
      if (c) { put(k, c, 'nakazawa'); mc[c].nakazawa++; } else skipped.push(`${fmtMd(k)} 中澤：外来チームに候補なし`);
    }
    // 浦上（第2土日・外来チーム）
    if (dow === 6 && Math.ceil(dayOfKey(k) / 7) === 2 && !holdersOf(local, k, 'urakami', staff).length) {
      const sun = keyPlus(k, 1);
      const cands = pool.filter(s => ['gairai', 'urakami'].includes(getCode(local, k, s.id)) && ['gairai', 'urakami', ''].includes(getCode(local, sun, s.id))
        && !isNg(local, k, s.id) && !isNg(local, sun, s.id)).map(s => s.id);
      const c = pick(cands, 'urakami');
      if (c) { put(k, c, 'urakami'); put(sun, c, 'urakami'); mc[c].urakami++; } else skipped.push(`${fmtMd(k)} 浦上：外来チームに候補なし`);
    }
    // 記念（第1土曜・希望者・週末当番と重複不可）
    if (dow === 6 && Math.ceil(dayOfKey(k) / 7) === 1 && !holdersOf(local, k, 'kinen', staff).length) {
      const cands = pool.filter(s => s.ueda && ['', 'gairai'].includes(getCode(local, k, s.id)) && !isNg(local, k, s.id)).map(s => s.id);
      const c = pick(cands, 'kinen');
      if (c) { put(k, c, 'kinen'); mc[c].kinen++; } else if (pool.some(s => s.ueda)) skipped.push(`${fmtMd(k)} 記念：候補なし`);
    }
  });
  return { entries, skipped };
}

/* ===================== UI ===================== */

/* ───────── Colors (avatar) ───────── */
const AV = ['#0E6F69', '#1D3F8C', '#8A3D00', '#4B2E83', '#7A2A5A', '#3E5A24', '#6B4A00', '#343A46', '#B3261E', '#0A5A51', '#566F89', '#965488'];
const avColor = (s) => AV[((s?.colorIndex ?? 0) % AV.length + AV.length) % AV.length];
const shortName = (n) => (n || '').replace(/\s+/g, ' ').trim();

/* ───────── Firestore writes ───────── */
async function writeEntries(entries) {
  if (!entries.length) return;
  const byYm = {};
  entries.forEach(e => {
    if (!byYm[e.ym]) byYm[e.ym] = {};
    if (!byYm[e.ym][e.sid]) byYm[e.ym][e.sid] = {};
    byYm[e.ym][e.sid][String(e.d)] = e.code ? e.code : FV.delete();
  });
  const yms = Object.keys(byYm);
  for (let i = 0; i < yms.length; i += 400) {
    const batch = db.batch();
    yms.slice(i, i + 400).forEach(ym => batch.set(monthsCol().doc(ym), { ym, cells: byYm[ym], updatedAt: Date.now() }, { merge: true }));
    await batch.commit();
  }
}
const patchMonth = (ym, patch) => monthsCol().doc(ym).set({ ym, ...patch, updatedAt: Date.now() }, { merge: true });

/* 日 k の枠 code を sid に（他の人の同じ枠は外す）。sid が空なら解除のみ */
function entriesAssignDay(months, staff, k, code, sid) {
  const ym = ymOfKey(k), d = dayOfKey(k);
  const out = [];
  holdersOf(months, k, code, staff).forEach(h => { if (h !== sid) out.push({ ym, sid: h, d, code: null }); });
  if (sid && getCode(months, k, sid) !== code) out.push({ ym, sid, d, code });
  return out;
}
function entriesAssignBlock(months, staff, block, slot, sid) {
  let out = [];
  block.days.forEach(k => { out = out.concat(entriesAssignDay(months, staff, k, slot, sid)); });
  return out;
}
/* 範囲の当番類（下書き）を消す */
function entriesClearCodes(months, staff, keys, codes) {
  const out = [];
  keys.forEach(k => staff.forEach(s => {
    const c = getCode(months, k, s.id);
    if (codes.includes(c)) out.push({ ym: ymOfKey(k), sid: s.id, d: dayOfKey(k), code: null });
  }));
  return out;
}

/* ───────── Excel ───────── */
function exportExcel(ym, months, staff) {
  const { y, m } = parseYm(ym);
  const keys = monthKeys(ym);
  const people = activeIn(staff, ym);
  const legend = '✖：入れない日 / 外来：当番・休み入れない / 当番：RTリーダー入れない / 中澤：毎週月曜 / '
    + `${codeLabel(MIDORI)}：みどり兼任・大村在住 / ${codeLabel(OTHER_W)}：${codeLabel(MIDORI)}と別チーム / 浦上：第2土日 / 記念：第1土曜`;
  const cellText = (k, sid) => { const c = getCode(months, k, sid); if (c) return codeLabel(c); return isNg(months, k, sid) ? '✖' : ''; };
  const aoa = [
    [`${CONFIG.org.name} ${CONFIG.org.dept} 勤務表  ${y}年${m + 1}月`],
    [legend],
    ['氏名', 'チーム', ...keys.map(k => `${dayOfKey(k)}(${dowJP[dowOfKey(k)]})${isHolidayKey(k) ? '祝' : ''}`)],
    ...people.map(s => [s.name, teamOf(months, ym, s.id), ...keys.map(k => cellText(k, s.id))]),
  ];
  const ws1 = XLSX.utils.aoa_to_sheet(aoa);
  ws1['!cols'] = [{ wch: 12 }, { wch: 6 }, ...keys.map(() => ({ wch: 7 }))];
  ws1['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: keys.length + 1 } }, { s: { r: 1, c: 0 }, e: { r: 1, c: keys.length + 1 } }];

  const nameOf = (k, code) => holdersOf(months, k, code, staff).map(id => staff.find(s => s.id === id)?.name).join('・');
  const aoa2 = [
    ['日付', '曜日', '祝日/別枠', '平日当番', `${codeLabel(MIDORI)}（みどり）`, codeLabel(OTHER_W), '祝日①', '祝日②', '中澤', '浦上', '記念'],
    ...keys.map(k => [`${m + 1}/${dayOfKey(k)}`, dowJP[dowOfKey(k)], holidayName(k) || specialNameOf(k) || '',
      nameOf(k, 'toban'), nameOf(k, MIDORI), nameOf(k, OTHER_W), nameOf(k, 'h1'), nameOf(k, 'h2'), nameOf(k, 'nakazawa'), nameOf(k, 'urakami'), nameOf(k, 'kinen')]),
  ];
  const ws2 = XLSX.utils.aoa_to_sheet(aoa2);
  ws2['!cols'] = [{ wch: 7 }, { wch: 5 }, { wch: 12 }, { wch: 12 }, { wch: 16 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 12 }];

  // NMC当番シフト.xlsx と同じ列（日付 / 曜日 / 研修医 / 担当 / バックアップ）— 研修医・バックアップは手入力
  const tanto = (k) => {
    if (isTobanDay(k)) return nameOf(k, 'toban');
    if (isWeekdayHoliday(k)) return [nameOf(k, 'h1'), nameOf(k, 'h2')].filter(Boolean).join('/');
    return [nameOf(k, 'w1'), nameOf(k, 'w2')].filter(Boolean).join('/');
  };
  const aoa3 = [['日付', '曜日', '研修医', '担当', 'バックアップ'],
    ...keys.map(k => [`${m + 1}/${dayOfKey(k)}`, dowJP[dowOfKey(k)] + (isHolidayKey(k) ? '祝' : ''), '', tanto(k), ''])];
  const ws3 = XLSX.utils.aoa_to_sheet(aoa3);
  ws3['!cols'] = [{ wch: 7 }, { wch: 5 }, { wch: 12 }, { wch: 16 }, { wch: 14 }];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws1, '勤務表');
  XLSX.utils.book_append_sheet(wb, ws2, '当番一覧');
  XLSX.utils.book_append_sheet(wb, ws3, 'NMC当番シフト');
  XLSX.writeFile(wb, `レジデント勤務表_${y}${pad2(m + 1)}.xlsx`);
}

/* ───────── Google Calendar ───────── */
let _gcInited = false, _tokenClient = null, _accessToken = null;
function initGoogleClient() {
  return new Promise((resolve, reject) => {
    if (_gcInited) return resolve();
    if (typeof window.gapi === 'undefined' || typeof window.google === 'undefined')
      return reject(new Error('Google API がまだ読み込まれていません。少し待って再試行してください。'));
    window.gapi.load('client', async () => {
      try {
        await window.gapi.client.init({ discoveryDocs: ['https://www.googleapis.com/discovery/v1/apis/calendar/v3/rest'] });
        _tokenClient = window.google.accounts.oauth2.initTokenClient({
          client_id: CONFIG.google.clientId, scope: 'https://www.googleapis.com/auth/calendar.events', callback: '',
        });
        _gcInited = true; resolve();
      } catch (e) { reject(e); }
    });
  });
}
function requestAccessToken() {
  return new Promise((resolve, reject) => {
    if (!_tokenClient) return reject(new Error('OAuth クライアントが未初期化です'));
    _tokenClient.callback = (resp) => { if (resp.error) return reject(new Error(resp.error)); _accessToken = resp.access_token; resolve(resp.access_token); };
    _tokenClient.requestAccessToken({ prompt: _accessToken ? '' : 'consent' });
  });
}
/* 1日1イベント（その日の当番をまとめる） */
function daySummary(k, months, staff) {
  const nm = (code) => holdersOf(months, k, code, staff).map(id => shortName(staff.find(s => s.id === id)?.name)).join('・');
  const parts = [];
  const tb = nm('toban'); if (tb) parts.push(`当番 ${tb}`);
  const w1 = nm('w1'), w2 = nm('w2');
  if (w1) parts.push(`週末① ${w1}${MIDORI === 'w1' ? '(みどり)' : ''}`);
  if (w2) parts.push(`週末② ${w2}${MIDORI === 'w2' ? '(みどり)' : ''}`);
  const h1 = nm('h1'), h2 = nm('h2');
  if (h1) parts.push(`祝日① ${h1}`); if (h2) parts.push(`祝日② ${h2}`);
  const nz = nm('nakazawa'); if (nz) parts.push(`中澤 ${nz}`);
  const ur = nm('urakami'); if (ur) parts.push(`浦上 ${ur}`);
  const ki = nm('kinen'); if (ki) parts.push(`記念 ${ki}`);
  return parts;
}
async function syncMonthToCalendar(ym, months, staff, onProgress) {
  await initGoogleClient();
  await requestAccessToken();
  window.gapi.client.setToken({ access_token: _accessToken });
  const calId = CONFIG.google.calendarId;
  const { y, m } = parseYm(ym);
  const keys = monthKeys(ym);
  const timeMin = new Date(y, m, 1).toISOString(), timeMax = new Date(y, m + 1, 1).toISOString();
  const existing = {};
  try {
    const res = await window.gapi.client.calendar.events.list({ calendarId: calId, timeMin, timeMax, singleEvents: true, privateExtendedProperty: 'app=resident-roster', maxResults: 250 });
    (res.result.items || []).forEach(ev => { const d = ev.extendedProperties?.private?.date; if (d) existing[d] = ev; });
  } catch (e) { console.warn('events.list failed', e); }
  let created = 0, updated = 0, deleted = 0; const errors = [];
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i];
    const parts = daySummary(k, months, staff);
    try {
      if (!parts.length) {
        if (existing[k]) { await window.gapi.client.calendar.events.delete({ calendarId: calId, eventId: existing[k].id }); deleted++; }
      } else {
        const ev = {
          summary: `【レジ】${parts.join(' / ')}`,
          description: `${CONFIG.org.name} ${CONFIG.org.dept} 勤務表\n${parts.join('\n')}`,
          start: { date: k }, end: { date: keyPlus(k, 1) },
          extendedProperties: { private: { app: 'resident-roster', date: k, month: ym } },
        };
        if (existing[k]) { await window.gapi.client.calendar.events.update({ calendarId: calId, eventId: existing[k].id, resource: ev }); updated++; }
        else { await window.gapi.client.calendar.events.insert({ calendarId: calId, resource: ev }); created++; }
      }
    } catch (e) { errors.push({ date: k, error: e?.result?.error?.message || e.message }); }
    onProgress && onProgress(i + 1, keys.length);
  }
  return { created, updated, deleted, errors };
}

/* ───────── Toast ───────── */
function useToast() {
  const [toasts, setToasts] = useState([]);
  const push = (msg, type = 'info') => {
    const id = Math.random().toString(36).slice(2);
    setToasts(t => [...t, { id, msg, type }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 4500);
  };
  const Host = () => (
    <div className="toasts">{toasts.map(t => <div key={t.id} className={`toast ${t.type}`}>{t.msg}</div>)}</div>
  );
  return { push, Host };
}

/* ───────── Small shared UI ───────── */
function MonthNav({ ym, setYm, label }) {
  return (
    <div className="monthnav">
      <button onClick={() => setYm(addMonths(ym, -1))} aria-label="前の月">‹</button>
      <div className="ym">{label ? label(ym) : fmtYm(ym)}</div>
      <button onClick={() => setYm(addMonths(ym, 1))} aria-label="次の月">›</button>
    </div>
  );
}
function CodeChip({ code, small }) {
  if (!code) return null;
  return <span className={`code c-${code} ${small ? 'small' : ''}`}>{codeLabel(code)}</span>;
}
function Legend() {
  const items = ['toban', 'w1', 'w2', 'h1', 'h2', 'nakazawa', 'urakami', 'kinen', 'gairai', 'tochoku', 'ake', 'yakan', 'gsapo', 'junya'];
  return (
    <div className="legend">
      <span><span className="ng">✖</span> 入れない日</span>
      {items.map(c => <span key={c}><span className={`sw c-${c}`}>{codeLabel(c)}</span>{CODES[c].note}</span>)}
    </div>
  );
}
function IssueList({ issues, max = 40 }) {
  const shown = issues.filter(i => i.level !== 'info');
  const infos = issues.filter(i => i.level === 'info');
  if (!shown.length && !infos.length) return <div className="issues"><div className="issue info">問題は見つかりません</div></div>;
  return (
    <div className="issues">
      {shown.slice(0, max).map((i, n) => <div key={n} className={`issue ${i.level}`}>{i.msg}</div>)}
      {shown.length > max && <div className="issue info">他 {shown.length - max} 件</div>}
      {infos.length > 0 && <div className="issue info">未割当 {infos.length} 件</div>}
    </div>
  );
}
/* 人選択（候補状態を表示） */
function PersonSelect({ value, onChange, people, statusOf, disabled, placeholder = '—' }) {
  return (
    <select className="sel" value={value || ''} disabled={disabled} onChange={e => onChange(e.target.value || null)}>
      <option value="">{placeholder}</option>
      {people.map(s => { const st = statusOf ? statusOf(s) : ''; return <option key={s.id} value={s.id}>{s.name}{st ? `　${st}` : ''}</option>; })}
    </select>
  );
}

/* ───────── Grid (勤務表) ───────── */
function GridView({ ym, setYm, months, staff, user, isAdmin, issues, actions, push }) {
  const keys = monthKeys(ym);
  const people = useMemo(() => activeIn(staff, ym), [staff, ym]);
  const md = months[ym] || {};
  const confirmed = !!md.confirmed;
  const [picker, setPicker] = useState(null);           // { sid, k }
  const [rangeMode, setRangeMode] = useState(false);    // 外来の範囲入力
  const [anchor, setAnchor] = useState(null);           // { sid, k }
  const [busy, setBusy] = useState('');
  const todayKey = dateKey(new Date());
  const issueMap = useMemo(() => {
    const mp = {};
    issues.forEach(i => { if (!i.sid) return; const id = `${i.key}|${i.sid}`; if (i.level === 'error') mp[id] = 'error'; else if (i.level === 'warn' && !mp[id]) mp[id] = 'warn'; });
    return mp;
  }, [issues]);
  const errCount = issues.filter(i => i.level === 'error').length;
  const warnCount = issues.filter(i => i.level === 'warn').length;

  const onCell = async (s, k) => {
    if (isAdmin) {
      if (rangeMode) {
        if (!anchor || anchor.sid !== s.id) { setAnchor({ sid: s.id, k }); return; }
        const [a, b] = [anchor.k, k].sort();
        const ks = keys.filter(x => x >= a && x <= b);
        await writeEntries(ks.map(x => ({ ym, sid: s.id, d: dayOfKey(x), code: 'gairai' })));
        setAnchor(null); push(`${s.name}：${fmtMd(a)}〜${fmtMd(b)} を外来にしました`, 'success');
        return;
      }
      setPicker({ sid: s.id, k });
      return;
    }
    if (s.id !== user.id) return;
    if (confirmed) { push('この月は確定済みです。変更は管理者に連絡してください', 'warn'); return; }
    const c = getCode(months, k, s.id);
    if (c && !SELF_CODES.includes(c) && c !== 'ake') { push(`${codeLabel(c)} が入っている日は変更できません（管理者に連絡）`, 'warn'); return; }
    setPicker({ sid: s.id, k });
  };

  const run = async (label, fn) => { setBusy(label); try { await fn(); } catch (e) { console.error(e); push(`${label}に失敗: ${e.message}`, 'error'); } setBusy(''); };

  return (
    <div className="page">
      <div className="toolbar">
        <MonthNav ym={ym} setYm={setYm} />
        <span className={`pill ${confirmed ? 'ok' : ''}`}>{confirmed ? '確定' : '作成中'}</span>
        <span className="muted">提出締切 {fmtMd(deadlineOf(ym))}</span>
        {(errCount > 0 || warnCount > 0) && <span className={`pill ${errCount ? 'err' : 'warn'}`}>{errCount ? `違反 ${errCount}` : ''}{errCount && warnCount ? ' / ' : ''}{warnCount ? `注意 ${warnCount}` : ''}</span>}
        <div className="grow" />
        {isAdmin && <Fragment>
          <button className={`btn sm ${rangeMode ? 'accent' : ''}`} onClick={() => { setRangeMode(!rangeMode); setAnchor(null); }}>
            {rangeMode ? (anchor ? '終点をクリック' : '外来: 始点をクリック') : '外来を範囲入力'}
          </button>
          {!Object.keys(md.teams || {}).length && <button className="btn sm" onClick={actions.copyTeams}>チームを前月からコピー</button>}
          <button className="btn sm" disabled={!!busy} onClick={() => run('自動下書き', actions.draftMonth)}>平日・外勤を自動下書き</button>
          <button className="btn sm" onClick={() => exportExcel(ym, months, staff)}>Excel</button>
          <button className="btn sm" disabled={!!busy} onClick={() => run('カレンダー同期', actions.syncCalendar)}>{busy === 'カレンダー同期' ? '同期中…' : 'カレンダー同期'}</button>
          <button className={`btn sm ${confirmed ? '' : 'primary'}`} onClick={() => actions.setConfirmed(!confirmed)}>{confirmed ? '確定を解除' : 'この月を確定'}</button>
        </Fragment>}
      </div>
      {!isAdmin && <p className="note">自分の行をタップして <span className="ng">✖</span>（入れない日）と、病院から指定された 当直・準夜・夜間初期・外サポ を入力してください（当直の翌日は自動で「明け」になります）。締切は {fmtMd(deadlineOf(ym))} です。</p>}
      {isAdmin && rangeMode && <p className="note">同じ人の行で始点 → 終点の順にクリックすると、その期間が「外来」になります。</p>}

      <div className="gridwrap">
        <table className="grid">
          <thead>
            <tr>
              <th className="namecol">氏名</th>
              {keys.map(k => {
                const dow = dowOfKey(k); const hol = isHolidayKey(k);
                return (
                  <th key={k} className={`${dow === 6 ? 'sat' : ''} ${dow === 0 ? 'sun' : ''} ${hol ? 'hol' : ''} ${k === todayKey ? 'today' : ''}`} title={holidayName(k) || specialNameOf(k) || ''}>
                    <div className="dn">{dayOfKey(k)}</div>
                    <div className="dw">{dowJP[dow]}{hol ? '祝' : ''}</div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {people.map(s => (
              <tr key={s.id} className={s.id === user.id ? 'me' : ''}>
                <td className="namecol">
                  <div className="nm">{s.name}</div>
                  <div className="tm">
                    {isAdmin
                      ? <Fragment>
                          <select value={teamOf(months, ym, s.id)} onChange={e => actions.setTeam(s.id, e.target.value)} aria-label="チーム">
                            <option value="">チーム</option>{['A', 'B', 'C', 'D'].map(t => <option key={t} value={t}>{t}</option>)}
                          </select>
                          <label title="スタッフ枠リーダー（平日当番免除）" style={{ marginLeft: 4 }}><input type="checkbox" checked={isLeader(months, ym, s.id)} onChange={e => actions.setLeader(s.id, e.target.checked)} style={{ verticalAlign: 'middle', margin: 0 }} />L</label>
                        </Fragment>
                      : (teamOf(months, ym, s.id) ? `チーム${teamOf(months, ym, s.id)}` : '') + (isLeader(months, ym, s.id) ? ' L' : '')}
                    {s.omura ? ' 大村' : ''}{s.ueda ? ' 記念' : ''}
                  </div>
                </td>
                {keys.map(k => {
                  const dow = dowOfKey(k); const hol = isHolidayKey(k);
                  const code = getCode(months, k, s.id); const ng = isNg(months, k, s.id);
                  const v = issueMap[`${k}|${s.id}`];
                  const editable = isAdmin || (s.id === user.id && !confirmed && (!code || SELF_CODES.includes(code) || code === 'ake'));
                  const picking = (picker && picker.sid === s.id && picker.k === k) || (anchor && anchor.sid === s.id && anchor.k === k);
                  return (
                    <td key={k} onClick={() => editable && onCell(s, k)}
                      className={`cell ${dow === 6 ? 'sat' : ''} ${dow === 0 ? 'sun' : ''} ${hol ? 'hol' : ''} ${editable ? 'editable' : ''} ${v === 'error' ? 'viol' : v === 'warn' ? 'warnm' : ''} ${code && ng ? 'ngover' : ''} ${picking ? 'picking' : ''}`}
                      title={code && ng ? `${codeLabel(code)}（✖の日）` : ''}>
                      {code ? <CodeChip code={code} small={codeLabel(code).length > 3} /> : ng ? <span className="ng">✖</span> : null}
                    </td>
                  );
                })}
              </tr>
            ))}
            {!people.length && <tr><td className="namecol" colSpan={keys.length + 1} style={{ padding: 16 }}>この月に在籍しているスタッフがいません。スタッフ画面で在籍期間を確認してください。</td></tr>}
          </tbody>
        </table>
      </div>
      <Legend />
      {isAdmin && <IssueList issues={issues} />}

      {picker && (() => {
        const s = staff.find(x => x.id === picker.sid); const k = picker.k;
        const code = getCode(months, k, s.id); const ng = isNg(months, k, s.id);
        const set = async (c) => { await actions.setCell(k, s.id, c); setPicker(null); };
        const groups = isAdmin
          ? [['当番', ['toban', 'w1', 'w2', 'h1', 'h2']], ['外勤', ['nakazawa', 'urakami', 'kinen']], ['病院勤務・外来', ['gairai', 'tochoku', 'ake', 'yakan', 'gsapo', 'junya']]]
          : [['病院から指定された勤務（各自で入力）', ['tochoku', 'yakan', 'gsapo', 'junya']]];
        return (
          <div className="backdrop" onClick={() => setPicker(null)}>
            <div className="modal" onClick={e => e.stopPropagation()}>
              <h3>{s.name}　{fmtMd(k)}{holidayName(k) ? `　${holidayName(k)}` : ''}</h3>
              <div className="muted">現在: {code ? codeLabel(code) : ng ? '✖ 入れない日' : '空欄'}{code && ng ? '（✖の日に割当済み）' : ''}</div>
              {!isAdmin && <div className="muted">当直を入れると翌日は自動で「明け」になります（明けの日は当番なし）。外サポ・夜間初期・準夜は翌日も通常勤務です。</div>}
              {groups.map(([g, cs]) => (
                <div key={g}>
                  <div className="muted" style={{ marginTop: 8 }}>{g}</div>
                  <div className="codegrid">{cs.map(c => <button key={c} className={`c-${c} ${code === c ? 'on' : ''}`} onClick={() => set(c)}>{codeLabel(c)}</button>)}</div>
                </div>
              ))}
              <div className="toolbar" style={{ marginTop: 6 }}>
                <button className="btn" onClick={async () => { await actions.toggleNg(k, s.id); setPicker(null); }}>{ng ? '✖ を外す' : '✖ にする'}</button>
                <button className="btn" disabled={!code} onClick={() => set(null)}>割当を消去</button>
                <div className="grow" />
                <button className="btn" onClick={() => setPicker(null)}>閉じる</button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

/* ───────── 週末当番（3か月） ───────── */
function WeekendPanel({ ym, setYm, months, staff, isAdmin, push }) {
  const yms = rangeYms(ym, 3);
  const blocks = useMemo(() => weekendBlocks(ym, 3), [ym]);
  const issues = useMemo(() => validate(months, staff, yms), [months, staff, ym]);
  const [busy, setBusy] = useState(false);
  const blockIssues = (b) => issues.filter(i => i.level !== 'info' && (i.key === b.satKey || b.days.includes(i.key)));

  const assign = async (b, slot, sid) => {
    await writeEntries(entriesAssignBlock(months, staff, b, slot, sid));
  };
  const assignDay = async (k, code, sid, extraKeys = []) => {
    let e = entriesAssignDay(months, staff, k, code, sid);
    extraKeys.forEach(x => { e = e.concat(entriesAssignDay(months, staff, x, code, sid)); });
    await writeEntries(e);
  };
  const statusFor = (b, slot) => (s) => {
    const free = b.days.every(k => cellFreeFor(months, k, s.id, slot));
    const inG = gairaiAround(months, b.days[0], s.id, 1) && gairaiAround(months, b.days[2], s.id, 1);
    const ng = b.days.some(k => isNg(months, k, s.id));
    const parts = [];
    if (ng) parts.push('✖'); else if (inG) parts.push('外来'); else if (!free) parts.push('予定あり');
    if (slot === MIDORI && !s.omura) parts.push('大村外');
    if (teamOf(months, b.ym, s.id)) parts.push(`チーム${teamOf(months, b.ym, s.id)}`);
    return parts.join(' ');
  };
  const doDraft = async () => {
    setBusy(true);
    try {
      const { entries, skipped } = draftWeekends(months, staff, ym, 3);
      await writeEntries(entries);
      push(entries.length ? `週末当番の下書きを作成しました（${entries.length / 3} 枠）` : '空いている週末はありません', entries.length ? 'success' : 'info');
      skipped.forEach(s => push(s, 'warn'));
    } catch (e) { push(`下書きに失敗: ${e.message}`, 'error'); }
    setBusy(false);
  };
  const doClear = async () => {
    if (!confirm(`${fmtYm(yms[0])}〜${fmtYm(yms[2])} の週末①②・記念・浦上をすべて消しますか？（別枠の週末は残します）`)) return;
    const keys = blocks.filter(b => !isBlockSpecial(months, b)).flatMap(b => b.days);
    await writeEntries(entriesClearCodes(months, staff, keys, ['w1', 'w2', 'kinen', 'urakami']));
    push('消去しました', 'info');
  };

  return (
    <div className="page">
      <div className="toolbar">
        <MonthNav ym={ym} setYm={setYm} label={(y) => `${fmtYm(y)}〜`} />
        <span className="muted">{fmtYm(yms[0])} 〜 {fmtYm(yms[2])} の3か月（締切 {fmtMd(deadlineOf(yms[0]))}）</span>
        <div className="grow" />
        {isAdmin && <Fragment>
          <button className="btn sm primary" disabled={busy} onClick={doDraft}>空き枠を自動下書き</button>
          <button className="btn sm danger" onClick={doClear}>この範囲を消去</button>
        </Fragment>}
      </div>
      <p className="note">{codeLabel(MIDORI)}＝みどり兼任（大村在住者）、{codeLabel(OTHER_W)}＝{codeLabel(MIDORI)}と別チーム。金土日を同じ2人が通しで担当します。別枠（GW・SW・年末年始）の週末は「祝日・連休」画面で日ごとに調整します。</p>
      <div style={{ overflowX: 'auto' }}>
        <table className="list">
          <thead><tr><th>週末（金〜日）</th><th>別枠</th><th>{codeLabel(MIDORI)}（みどり）</th><th>{codeLabel(OTHER_W)}</th><th>記念（第1土）</th><th>浦上（第2土日）</th><th>状態</th></tr></thead>
          <tbody>
            {blocks.map(b => {
              const special = isBlockSpecial(months, b);
              const people = activeIn(staff, b.ym);
              const w1 = holdersOf(months, b.satKey, 'w1', staff)[0] || '';
              const w2 = holdersOf(months, b.satKey, 'w2', staff)[0] || '';
              const kin = holdersOf(months, b.satKey, 'kinen', staff)[0] || '';
              const ur = holdersOf(months, b.satKey, 'urakami', staff)[0] || '';
              const bi = blockIssues(b);
              const hasErr = bi.some(i => i.level === 'error');
              const holNote = b.days.map(k => holidayName(k) ? `${fmtMd(k)}${holidayName(k)}` : '').filter(Boolean).join(' ');
              return (
                <tr key={b.satKey} className={special ? 'special' : ''}>
                  <td className="date">{fmtMd(b.days[0])}〜{fmtMd(b.days[2])}{holNote && <div className="muted">{holNote}</div>}</td>
                  <td>
                    {isAdmin
                      ? <label style={{ whiteSpace: 'nowrap' }}><input type="checkbox" checked={special} onChange={e => patchMonth(b.ym, { special: { [b.satKey]: e.target.checked } })} /> {b.specialAuto || (special ? '別枠' : '')}</label>
                      : (special ? (b.specialAuto || '別枠') : '')}
                  </td>
                  {special ? <td colSpan={2} className="muted">祝日・連休 画面で日ごとに割当</td> : <Fragment>
                    <td><PersonSelect value={MIDORI === 'w1' ? w1 : w2} disabled={!isAdmin} people={people} statusOf={statusFor(b, MIDORI)} onChange={sid => assign(b, MIDORI, sid)} /></td>
                    <td><PersonSelect value={MIDORI === 'w1' ? w2 : w1} disabled={!isAdmin} people={people} statusOf={statusFor(b, OTHER_W)} onChange={sid => assign(b, OTHER_W, sid)} /></td>
                  </Fragment>}
                  <td>{b.isFirstSat
                    ? <PersonSelect value={kin} disabled={!isAdmin} people={people.filter(s => s.ueda || s.id === kin)} placeholder="なし"
                        statusOf={s => (s.id === w1 || s.id === w2) ? '週末当番' : isNg(months, b.satKey, s.id) ? '✖' : ''}
                        onChange={sid => assignDay(b.satKey, 'kinen', sid)} />
                    : <span className="muted">—</span>}</td>
                  <td>{b.isSecondSat
                    ? <PersonSelect value={ur} disabled={!isAdmin} people={people} placeholder="—"
                        statusOf={s => getCode(months, b.satKey, s.id) === 'gairai' || getCode(months, b.satKey, s.id) === 'urakami' ? '外来' : (isNg(months, b.satKey, s.id) ? '✖' : '外来以外')}
                        onChange={sid => assignDay(b.satKey, 'urakami', sid, [b.days[2]])} />
                    : <span className="muted">—</span>}</td>
                  <td>{hasErr ? <span className="pill err">違反 {bi.filter(i => i.level === 'error').length}</span> : bi.length ? <span className="pill warn">注意 {bi.length}</span> : (special || (w1 && w2)) ? <span className="pill ok">OK</span> : <span className="pill">未割当</span>}
                    {bi.slice(0, 3).map((i, n) => <div key={n} className="muted" style={{ color: i.level === 'error' ? 'var(--danger)' : 'var(--warn)' }}>{i.msg.replace(/^[^ ]+ /, '')}</div>)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ───────── 平日当番（1か月） ───────── */
function WeekdayPanel({ ym, setYm, months, staff, isAdmin, push }) {
  const keys = monthKeys(ym);
  const people = useMemo(() => activeIn(staff, ym), [staff, ym]);
  const issues = useMemo(() => validate(months, staff, [ym]), [months, staff, ym]);
  const [busy, setBusy] = useState(false);
  const rows = keys.filter(k => isTobanDay(k) || (dowOfKey(k) === 1 && !isHolidayKey(k)));
  const dayIssues = (k) => issues.filter(i => i.level !== 'info' && i.key === k && ['toban', 'nakazawa'].some(c => i.msg.includes(codeLabel(c))));
  const stTb = (k) => (s) => isNg(months, k, s.id) ? '✖' : gairaiAround(months, k, s.id, 1) ? '外来' : (getCode(months, k, s.id) && getCode(months, k, s.id) !== 'toban') ? codeLabel(getCode(months, k, s.id)) : '';
  const stNz = (k) => (s) => ['gairai', 'nakazawa'].includes(getCode(months, k, s.id)) ? '外来' : isNg(months, k, s.id) ? '✖' : '外来以外';
  const doDraft = async () => {
    setBusy(true);
    try {
      const { entries, skipped } = draftMonth(months, staff, ym);
      await writeEntries(entries);
      push(entries.length ? `${fmtYm(ym)} の平日当番・外勤を下書きしました（${entries.length} 件）` : '空いている日はありません', entries.length ? 'success' : 'info');
      skipped.forEach(s => push(s, 'warn'));
    } catch (e) { push(`下書きに失敗: ${e.message}`, 'error'); }
    setBusy(false);
  };
  const doClear = async () => {
    if (!confirm(`${fmtYm(ym)} の平日当番と中澤をすべて消しますか？`)) return;
    await writeEntries(entriesClearCodes(months, staff, keys, ['toban', 'nakazawa']));
    push('消去しました', 'info');
  };
  const count = Object.fromEntries(people.map(s => [s.id, keys.filter(k => getCode(months, k, s.id) === 'toban').length]));
  return (
    <div className="page">
      <div className="toolbar">
        <MonthNav ym={ym} setYm={setYm} />
        <span className="muted">月〜木 1日1人（金〜日は週末当番）　締切 {fmtMd(deadlineOf(ym))}</span>
        <div className="grow" />
        {isAdmin && <Fragment>
          <button className="btn sm primary" disabled={busy} onClick={doDraft}>空き日を自動下書き</button>
          <button className="btn sm danger" onClick={doClear}>この月を消去</button>
        </Fragment>}
      </div>
      <div className="toolbar" style={{ gap: 6 }}>
        {people.map(s => <span key={s.id} className="pill">{s.name} {count[s.id]}</span>)}
      </div>
      <table className="list">
        <thead><tr><th>日付</th><th>平日当番</th><th>中澤（月曜・外来チーム）</th><th>状態</th></tr></thead>
        <tbody>
          {rows.map(k => {
            const dow = dowOfKey(k);
            const tb = holdersOf(months, k, 'toban', staff)[0] || '';
            const nz = holdersOf(months, k, 'nakazawa', staff)[0] || '';
            const di = dayIssues(k);
            return (
              <tr key={k}>
                <td className="date">{fmtMd(k)}</td>
                <td>{isTobanDay(k) ? <PersonSelect value={tb} disabled={!isAdmin} people={people} statusOf={stTb(k)} onChange={sid => writeEntries(entriesAssignDay(months, staff, k, 'toban', sid))} /> : <span className="muted">—</span>}</td>
                <td>{dow === 1 ? <PersonSelect value={nz} disabled={!isAdmin} people={people} statusOf={stNz(k)} onChange={sid => writeEntries(entriesAssignDay(months, staff, k, 'nakazawa', sid))} /> : <span className="muted">—</span>}</td>
                <td>{di.length ? di.map((i, n) => <div key={n} className="muted" style={{ color: i.level === 'error' ? 'var(--danger)' : 'var(--warn)' }}>{i.msg.replace(/^[^ ]+ /, '')}</div>) : (tb ? <span className="pill ok">OK</span> : <span className="pill">未割当</span>)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ───────── 祝日・連休（別枠） ───────── */
function HolidayPanel({ ym, setYm, months, staff, isAdmin, push }) {
  const yms = rangeYms(ym, 3);
  const blocks = useMemo(() => weekendBlocks(ym, 3), [ym]);
  const items = useMemo(() => {
    const out = [];
    yms.forEach(y => monthKeys(y).forEach(k => { if (isWeekdayHoliday(k)) out.push({ k, kind: 'hol', codes: ['h1', 'h2'], label: holidayName(k), special: specialNameOf(k) }); }));
    blocks.forEach(b => { if (isBlockSpecial(months, b)) b.days.forEach(k => { if (!isWeekdayHoliday(k)) out.push({ k, kind: 'wk', codes: ['w1', 'w2'], label: '週末（別枠）', special: b.specialAuto || '別枠' }); }); });
    return out.sort((a, b) => a.k.localeCompare(b.k));
  }, [ym, months]);
  const st = (k, code) => (s) => isNg(months, k, s.id) ? '✖' : gairaiAround(months, k, s.id, 1) ? '外来' : (getCode(months, k, s.id) && getCode(months, k, s.id) !== code) ? codeLabel(getCode(months, k, s.id)) : ((code === MIDORI || code === MIDORI_H) && !s.omura ? '大村外' : '');
  return (
    <div className="page">
      <div className="toolbar">
        <MonthNav ym={ym} setYm={setYm} label={(y) => `${fmtYm(y)}〜`} />
        <span className="muted">{fmtYm(yms[0])} 〜 {fmtYm(yms[2])} の祝日と別枠（GW・SW・年末年始）</span>
      </div>
      <p className="note">祝日は祝日①②、別枠の週末は週末①②を日ごとに割り当てます（通常の週末のように3日通しの制約はかけません）。{codeLabel(MIDORI_H)}・{codeLabel(MIDORI)}はみどり兼任（大村在住者）です。</p>
      {!items.length && <p className="note">この期間に祝日・別枠はありません。</p>}
      {items.length > 0 && (
        <table className="list">
          <thead><tr><th>日付</th><th>名称</th><th>①{MIDORI === 'w1' ? '（みどり）' : ''}</th><th>②{MIDORI === 'w2' ? '（みどり）' : ''}</th></tr></thead>
          <tbody>
            {items.map(it => {
              const people = activeIn(staff, ymOfKey(it.k));
              const [c1, c2] = it.codes;
              const v1 = holdersOf(months, it.k, c1, staff)[0] || '', v2 = holdersOf(months, it.k, c2, staff)[0] || '';
              return (
                <tr key={it.k} className={it.special ? 'special' : ''}>
                  <td className="date">{fmtMd(it.k)}</td>
                  <td>{it.label}{it.special ? <span className="pill warn" style={{ marginLeft: 6 }}>{it.special}</span> : ''}</td>
                  <td><PersonSelect value={v1} disabled={!isAdmin} people={people} statusOf={st(it.k, c1)} onChange={sid => writeEntries(entriesAssignDay(months, staff, it.k, c1, sid))} /></td>
                  <td>{(it.kind === 'wk' || RULES.holidaySlots >= 2) ? <PersonSelect value={v2} disabled={!isAdmin} people={people} statusOf={st(it.k, c2)} onChange={sid => writeEntries(entriesAssignDay(months, staff, it.k, c2, sid))} /> : <span className="muted">—</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

/* ───────── スタッフ ───────── */
function StaffPanel({ staff, months, ym, user, isAdmin, push }) {
  const [editing, setEditing] = useState(null);   // staff object or 'new'
  const sorted = [...staff].sort((a, b) => (a.status === b.status ? 0 : a.status === 'active' ? -1 : 1) || (a.colorIndex ?? 0) - (b.colorIndex ?? 0));
  const save = async (data) => {
    const rec = { name: data.name.trim(), email: (data.email || '').trim(), omura: !!data.omura, ueda: !!data.ueda, noDuty: !!data.noDuty, startYm: data.startYm || '', endYm: data.endYm || '', role: data.role || 'staff', status: data.status || 'active' };
    if (!rec.name) { push('氏名を入力してください', 'warn'); return; }
    if (data.id) await staffCol().doc(data.id).update(rec);
    else {
      const id = 'r' + Date.now().toString(36);
      await staffCol().doc(id).set({ ...rec, id, colorIndex: staff.length % AV.length, createdAt: Date.now() });
    }
    push('保存しました', 'success'); setEditing(null);
  };
  const admins = staff.filter(s => s.role === 'admin' && s.status === 'active').length;
  return (
    <div className="page">
      <div className="toolbar">
        <h2 style={{ margin: 0, fontSize: 16 }}>スタッフ <span className="muted">{staff.filter(s => s.status === 'active').length} 名（管理者 {admins} 名）</span></h2>
        <div className="grow" />
        {isAdmin && <button className="btn sm primary" onClick={() => setEditing('new')}>スタッフを追加</button>}
      </div>
      <p className="note">大村在住 → みどり兼任（{codeLabel(MIDORI)}）に入れます。上田記念 → 第1土曜の外勤候補になります。在籍期間を外れた月は勤務表に表示されません。</p>
      <div style={{ overflowX: 'auto' }}>
        <table className="list">
          <thead><tr><th>氏名</th><th>大村在住</th><th>上田記念</th><th>在籍</th><th>{fmtYm(ym)} チーム</th><th>権限</th><th></th></tr></thead>
          <tbody>
            {sorted.map(s => (
              <tr key={s.id} style={{ opacity: s.status === 'active' ? 1 : .5 }}>
                <td><span style={{ display: 'inline-grid', placeItems: 'center', width: 22, height: 22, borderRadius: 5, background: avColor(s), color: '#fff', fontSize: 11, fontWeight: 700, marginRight: 8 }}>{s.name.slice(0, 1)}</span>{s.name}{s.email ? <div className="muted">{s.email}</div> : null}</td>
                <td>{s.omura ? '○' : ''}</td>
                <td>{s.ueda ? '○' : ''}</td>
                <td className="muted">{s.noDuty ? '当番対象外' : `${s.startYm || '…'} 〜 ${s.endYm || '…'}`}{s.status !== 'active' ? '（退職）' : ''}</td>
                <td className="muted">{teamOf(months, ym, s.id) || '—'}</td>
                <td>{s.role === 'admin' ? <span className="pill ok">管理者</span> : ''}</td>
                <td>{isAdmin && <button className="btn sm" onClick={() => setEditing(s)}>編集</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted" style={{ marginTop: 8 }}>チームの割当は勤務表の氏名欄（月ごと）で設定します。</p>
      {editing && <StaffModal init={editing === 'new' ? { name: '', email: '', omura: false, ueda: false, noDuty: false, startYm: '', endYm: '', role: 'staff', status: 'active' } : editing}
        isSelf={editing !== 'new' && editing.id === user.id} lastAdmin={editing !== 'new' && editing.role === 'admin' && admins <= 1}
        onSave={save} onClose={() => setEditing(null)} />}
    </div>
  );
}
function StaffModal({ init, isSelf, lastAdmin, onSave, onClose }) {
  const [f, setF] = useState(init);
  const up = (k, v) => setF(x => ({ ...x, [k]: v }));
  return (
    <div className="backdrop" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h3>{init.id ? 'スタッフを編集' : 'スタッフを追加'}</h3>
        <div className="field">氏名<input type="text" value={f.name} onChange={e => up('name', e.target.value)} /></div>
        <div className="field">メール（任意）<input type="email" value={f.email || ''} onChange={e => up('email', e.target.value)} /></div>
        <div className="checks" style={{ marginBottom: 10 }}>
          <label><input type="checkbox" checked={!!f.omura} onChange={e => up('omura', e.target.checked)} /> 大村在住（みどり兼任可）</label>
          <label><input type="checkbox" checked={!!f.ueda} onChange={e => up('ueda', e.target.checked)} /> 上田記念 希望</label>
          <label><input type="checkbox" checked={!!f.noDuty} onChange={e => up('noDuty', e.target.checked)} /> 当番対象外（指導医・管理者など）</label>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <div className="field">在籍開始（年月）<input type="month" value={f.startYm || ''} onChange={e => up('startYm', e.target.value)} /></div>
          <div className="field">在籍終了（年月）<input type="month" value={f.endYm || ''} onChange={e => up('endYm', e.target.value)} /></div>
        </div>
        <div className="checks" style={{ marginBottom: 10 }}>
          <label><input type="checkbox" checked={f.role === 'admin'} disabled={lastAdmin && isSelf} onChange={e => up('role', e.target.checked ? 'admin' : 'staff')} /> 管理者</label>
          <label><input type="checkbox" checked={f.status !== 'active'} disabled={isSelf} onChange={e => up('status', e.target.checked ? 'inactive' : 'active')} /> 退職・非表示</label>
        </div>
        <div className="toolbar">
          <div className="grow" />
          <button className="btn" onClick={onClose}>キャンセル</button>
          <button className="btn primary" onClick={() => onSave(f)}>保存</button>
        </div>
      </div>
    </div>
  );
}

/* ───────── 集計（年度） ───────── */
function StatsPanel({ months, staff, ym }) {
  const [fy, setFy] = useState(fiscalYearOf(ym));
  const counts = useMemo(() => countsFor(months, staff, fy), [months, staff, fy]);
  const people = staff.filter(s => fiscalMonths(fy).some(m => isStaffActiveIn(s, m)));
  const cols = [['w', '週末'], ['toban', '平日当番'], ['h', '祝日'], ['nakazawa', '中澤'], ['urakami', '浦上'], ['kinen', '記念'], ['tochoku', '当直']];
  const spread = (key) => { const v = people.map(s => counts[s.id]?.[key] || 0); return v.length ? Math.max(...v) - Math.min(...v) : 0; };
  return (
    <div className="page">
      <div className="toolbar">
        <div className="monthnav">
          <button onClick={() => setFy(fy - 1)} aria-label="前年度">‹</button>
          <div className="ym">{fy}年度</div>
          <button onClick={() => setFy(fy + 1)} aria-label="次年度">›</button>
        </div>
        <span className="muted">{fy}年4月〜{fy + 1}年3月の回数（週末は金土日で1回）</span>
      </div>
      <table className="list">
        <thead><tr><th>氏名</th>{cols.map(([k, l]) => <th key={k} style={{ textAlign: 'right' }}>{l}</th>)}</tr></thead>
        <tbody>
          {people.map(s => <tr key={s.id}><td>{s.name}</td>{cols.map(([k]) => <td key={k} className="num">{counts[s.id]?.[k] || 0}</td>)}</tr>)}
          <tr><td className="muted">最大−最小</td>{cols.map(([k]) => <td key={k} className="num muted">{spread(k)}</td>)}</tr>
        </tbody>
      </table>
    </div>
  );
}

/* ───────── ログイン / ヘッダー ───────── */
function LoginScreen({ staff, onLogin }) {
  const sorted = [...staff].filter(s => s.status === 'active').sort((a, b) => (a.role !== b.role) ? (a.role === 'admin' ? -1 : 1) : (a.colorIndex ?? 0) - (b.colorIndex ?? 0));
  return (
    <div className="login">
      <div className="login-box">
        <h1>レジデント勤務表</h1>
        <p>{CONFIG.org.name} {CONFIG.org.dept}　自分の名前を選んでください</p>
        <div className="login-list">
          {sorted.map(s => (
            <button key={s.id} onClick={() => onLogin(s)}>
              <span style={{ display: 'grid', placeItems: 'center', width: 32, height: 32, borderRadius: 7, background: avColor(s), color: '#fff', fontWeight: 700 }}>{s.name.slice(0, 1)}</span>
              <span style={{ flex: 1 }}>{s.name}</span>
              {s.role === 'admin' && <span className="pill ok">管理者</span>}
            </button>
          ))}
          {!sorted.length && <div style={{ padding: 16 }} className="muted">スタッフが登録されていません（config.js の seedStaff を確認）</div>}
        </div>
      </div>
    </div>
  );
}
function Header({ user, isAdmin, onLogout }) {
  return (
    <header className="topbar">
      <div className="topbar-inner">
        <div className="brand">レジデント勤務表<small>{CONFIG.org.name} {CONFIG.org.dept}</small></div>
        <div className="spacer" />
        <div className="userchip">
          <span className="avatar" style={{ background: avColor(user) }}>{user.name.slice(0, 1)}</span>
          <span>{user.name}</span>
          {isAdmin && <span className="tag">管理者</span>}
        </div>
        <button className="btn-ghost" onClick={onLogout}>ログアウト</button>
      </div>
    </header>
  );
}

/* ───────── App ───────── */
const TABS = [['grid', '勤務表'], ['weekend', '週末当番'], ['weekday', '平日当番'], ['holiday', '祝日・連休'], ['stats', '集計'], ['staff', 'スタッフ']];
function App() {
  const [hydrated, setHydrated] = useState(false);
  const [staff, setStaff] = useState([]);
  const [months, setMonths] = useState({});
  const [user, setUser] = useState(null);
  const [tab, setTab] = useState('grid');
  const today = new Date();
  const [ym, setYm] = useState(addMonths(ymOf(today.getFullYear(), today.getMonth()), 1));
  const { push, Host: ToastHost } = useToast();

  useEffect(() => {
    let unsubs = [];
    (async () => {
      try { await firebase.auth().signInAnonymously(); } catch (e) { console.warn('anonymous auth skipped:', e?.message); }
      try {
        const snap = await staffCol().get();
        if (snap.empty && CONFIG.seedStaff?.length) {
          const batch = db.batch();
          CONFIG.seedStaff.forEach(s => batch.set(staffCol().doc(s.id), { ...s, createdAt: Date.now() }));
          await batch.commit();
        }
      } catch (e) { console.error('seed failed', e); push('Firestore に接続できません。ルールと設定を確認してください', 'error'); }
      unsubs.push(staffCol().onSnapshot(snap => {
        const arr = []; snap.forEach(d => arr.push({ id: d.id, ...d.data() }));
        arr.sort((a, b) => (a.colorIndex ?? 0) - (b.colorIndex ?? 0));
        setStaff(arr); setHydrated(true);
        const saved = localStorage.getItem('rr_user');
        if (saved) { const s = arr.find(x => x.id === saved && x.status === 'active'); if (s) setUser(u => u || s); }
      }, e => { console.error(e); push('データの読み込みに失敗しました', 'error'); setHydrated(true); }));
      unsubs.push(monthsCol().onSnapshot(snap => {
        const o = {}; snap.forEach(d => { o[d.id] = d.data(); }); setMonths(o);
      }));
    })();
    return () => unsubs.forEach(u => u());
  }, []);

  const liveUser = user ? (staff.find(s => s.id === user.id) || user) : null;
  const isAdmin = liveUser?.role === 'admin';
  const gridIssues = useMemo(() => (liveUser ? validate(months, staff, [ym]) : []), [months, staff, ym, !!liveUser]);

  const actions = {
    toggleNg: async (k, sid) => {
      const y = ymOfKey(k), d = String(dayOfKey(k));
      await patchMonth(y, { ng: { [sid]: { [d]: isNg(months, k, sid) ? FV.delete() : true } } });
    },
    setCell: async (k, sid, code) => {
      const y = ymOfKey(k), d = dayOfKey(k);
      const prev = getCode(months, k, sid);
      let entries = [{ ym: y, sid, d, code }];
      // 1人枠の当番類は他の人から外す
      if (code && ['toban', 'w1', 'w2', 'h1', 'h2', 'nakazawa', 'kinen', 'urakami'].includes(code))
        entries = entries.concat(holdersOf(months, k, code, staff).filter(h => h !== sid).map(h => ({ ym: y, sid: h, d, code: null })));
      // 当直 → 翌日を自動で「明け」に（空欄のときだけ）／当直を外したら翌日の明けも外す
      const next = keyPlus(k, 1);
      if (code === 'tochoku' && !getCode(months, next, sid)) entries.push({ ym: ymOfKey(next), sid, d: dayOfKey(next), code: 'ake' });
      if (prev === 'tochoku' && code !== 'tochoku' && getCode(months, next, sid) === 'ake') entries.push({ ym: ymOfKey(next), sid, d: dayOfKey(next), code: null });
      await writeEntries(entries);
    },
    setTeam: (sid, team) => patchMonth(ym, { teams: { [sid]: team || FV.delete() } }),
    setLeader: (sid, on) => patchMonth(ym, { leaders: { [sid]: on ? true : FV.delete() } }),
    copyTeams: async () => {
      const prev = months[addMonths(ym, -1)]?.teams || {};
      if (!Object.keys(prev).length) { push('前月にチーム設定がありません', 'warn'); return; }
      await patchMonth(ym, { teams: prev, leaders: months[addMonths(ym, -1)]?.leaders || {} }); push('前月のチームをコピーしました', 'success');
    },
    setConfirmed: async (v) => { await patchMonth(ym, { confirmed: v, confirmedAt: Date.now() }); push(v ? `${fmtYm(ym)} を確定しました` : '確定を解除しました', v ? 'success' : 'info'); },
    draftMonth: async () => {
      const { entries, skipped } = draftMonth(months, staff, ym);
      await writeEntries(entries);
      push(entries.length ? `平日当番・外勤を下書きしました（${entries.length} 件）` : '空いている日はありません', entries.length ? 'success' : 'info');
      skipped.forEach(s => push(s, 'warn'));
    },
    syncCalendar: async () => {
      const r = await syncMonthToCalendar(ym, months, staff);
      push(`カレンダー同期: 作成 ${r.created} / 更新 ${r.updated} / 削除 ${r.deleted}${r.errors.length ? ` / 失敗 ${r.errors.length}` : ''}`, r.errors.length ? 'warn' : 'success');
      r.errors.slice(0, 3).forEach(e => push(`${e.date}: ${e.error}`, 'error'));
    },
  };

  if (!hydrated) return <div className="login"><div className="muted">読み込み中…</div></div>;
  if (!liveUser) return <Fragment><ToastHost /><LoginScreen staff={staff} onLogin={s => { localStorage.setItem('rr_user', s.id); setUser(s); }} /></Fragment>;

  const common = { ym, setYm, months, staff, user: liveUser, isAdmin, push };
  return (
    <Fragment>
      <ToastHost />
      <Header user={liveUser} isAdmin={isAdmin} onLogout={() => { localStorage.removeItem('rr_user'); setUser(null); }} />
      <nav className="tabs">{TABS.map(([id, l]) => <button key={id} className={`tab ${tab === id ? 'active' : ''}`} onClick={() => setTab(id)}>{l}</button>)}</nav>
      {tab === 'grid' && <GridView {...common} issues={gridIssues} actions={actions} />}
      {tab === 'weekend' && <WeekendPanel {...common} />}
      {tab === 'weekday' && <WeekdayPanel {...common} />}
      {tab === 'holiday' && <HolidayPanel {...common} />}
      {tab === 'stats' && <StatsPanel {...common} />}
      {tab === 'staff' && <StaffPanel {...common} />}
    </Fragment>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
