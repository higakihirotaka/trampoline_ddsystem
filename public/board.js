/**
 * 公開スコアボード（観客・コーチ向け）の、データの組み立てと計算。 docs/realtime-score-spec.md
 *
 * 確定時に、CJPの画面が「表示用データ」を tournaments/{eventId}/publicBoard/* に書き、公開ページ（score.html）は
 * それを読むだけにする。この中身は、すべて Firestore や DOM に依存しない関数（単体テストできる）。
 * 書込だけは、SDKの関数を呼び出し側から渡す（createBoardWriter）。
 *
 *   書き込み側   buildRoutine / findUnresolvedSkills / buildGroups / buildRoster ... / createBoardWriter
 *   読み取り側   rankGroup / rankTeams（順位・Q・団体は、閲覧者のブラウザで計算する）
 *
 * 他のファイルを import しない（順位の計算は、shared.js の関数を、読み取り側の関数の引数で受け取る）。
 */

export const BOARD_VERSION = 1;
export const INDEX_ID = '_index';
export const BOARD_COLLECTION = 'publicBoard';
export const ROUNDS = ['pre1', 'pre2', 'final'];

// ============================================================
//  整形（保存する表示用文字列。score_public_sample.html と同じ規則）
// ============================================================
const num = v => (v == null || v === '' || isNaN(Number(v))) ? null : Number(v);
export const f1 = v => num(v) != null ? Number(v).toFixed(1) : null;
export const f2 = v => num(v) != null ? Number(v).toFixed(2) : null;
/** 小数第2位（浮動小数の誤差で .xx5 が下がらないように補正） */
export const f2r = v => num(v) != null ? (Math.round(Number(v) * 100 + 1e-6) / 100).toFixed(2) : null;
/** E減点（技ごと・着地）: 個人は10倍の整数、シンクロは10倍の小数第2位 */
export const fmtEDeduction = (v, synchro) => num(v) == null ? '–' : (synchro ? (Number(v) * 10).toFixed(2) : String(Math.round(Number(v) * 10)));
const dashOr = (v, fn) => num(v) != null ? fn(v) : '–';

// ============================================================
//  技マスタ
// ============================================================
/** 技マスタ（配列、または { id: {...} } のオブジェクト）を、IDと記号の両方で引ける索引にする */
export function indexSkills(master) {
  const list = Array.isArray(master) ? master : Object.entries(master || {}).map(([id, v]) => ({ id, ...v }));
  const byId = new Map(), bySymbol = new Map();
  for (const s of list) {
    if (s == null) continue;
    if (s.id != null) byId.set(String(s.id), s);
    if (s.symbol != null && !bySymbol.has(String(s.symbol))) bySymbol.set(String(s.symbol), s);
  }
  return { isSkillIndex: true, find: raw => (raw == null || raw === '') ? null : (byId.get(String(raw)) || bySymbol.get(String(raw)) || null) };
}
const skillSymbol = m => m ? String(m.displaySymbol || m.symbol || '') : '';

/** その結果の、有効な範囲の技のうち、技マスタに無いもの（IDまたは記号）の一覧 */
export function findUnresolvedSkills(res, master) {
  if (!res) return [];
  const idx = master?.isSkillIndex ? master : indexSkills(master);
  const vl = res.validCount ?? 10;
  const out = [];
  (res.officialSkills || []).slice(0, vl).forEach(raw => {
    if (raw == null || raw === '') return;
    if (!idx.find(raw)) out.push(String(raw));
  });
  return out;
}

// ============================================================
//  1本の演技（routine）の組み立て
// ============================================================
/** 審判パネルごとの人数が最も多いパネル（CJPが curPanel() を渡せないとき（再生成）の推定） */
function guessPanel(res) {
  const counts = {};
  Object.keys(res.execution?.judges || {}).forEach(k => { const p = k.split('_')[0]; counts[p] = (counts[p] || 0) + 1; });
  return Object.entries(counts).sort((x, y) => y[1] - x[1])[0]?.[0];
}

/**
 * 結果ドキュメント（results/*）の内容から、公開用の routine を作る。
 *
 * @param {object} res  結果ドキュメントの内容（確定時にCJPが書く値と同じ形）
 * @param {object} ctx
 *   - at            確定時刻（ミリ秒）
 *   - synchro       シンクロか
 *   - gender        '男子'|'女子'|'混合'（ボーナス計算用）
 *   - rule          クラスのルール（紙運用・難度ルールの判定に使う）
 *   - round         'pre1'|'pre2'|'final'
 *   - skills        技マスタ（配列・オブジェクト・indexSkills の戻り値のどれでも）
 *   - calcCardDD    shared.js の calcCardDD（難度の計算。画面の難度セルと同じ結果にする）
 *   - parseDDRule   shared.js の parseDDRule
 *   - panel         ToF・HDを読む審判パネル（省略時は、人数の多いパネル、無ければ先頭）
 * @returns {object} routine（3.3章）
 */
export function buildRoutine(res, ctx) {
  const at = ctx.at ?? Date.now();
  if (res?.dns === true) return { at, dns: true };
  const synchro = !!ctx.synchro;
  const rule = ctx.rule || {};
  const paper = rule.useOnlineCard === false;
  const idx = ctx.skills?.isSkillIndex ? ctx.skills : indexSkills(ctx.skills);
  const vl = res.validCount ?? 10;

  // 技（記号・難度）。画面の難度セルと同じ計算（重複は0、1技の上限、指定難度）
  let calc = null;
  const hasManualDD = Array.isArray(res.officialDDValues) && res.officialDDValues.length > 0;
  if (!paper && !hasManualDD && ctx.calcCardDD && ctx.parseDDRule) {
    const skills = Array.from({ length: 10 }, (_, i) => {
      const raw = (res.officialSkills || [])[i];
      if (i >= vl || raw == null || raw === '') return null;
      const m = idx.find(raw);
      return m ? { key: String(m.id ?? raw), dd: m.dd ?? null, isTriple: m.isTriple === true } : null;
    });
    calc = ctx.calcCardDD({
      skills, gender: ctx.gender, ddRule: ctx.parseDDRule(rule, ctx.round),
      designatedIndices: res.officialDesignatedDDIndices || [], validLimit: vl,
    });
  }

  const hmap = res.hdtsPerSkillByPanel || {};
  const hd = hmap[ctx.panel || guessPanel(res)] || hmap[Object.keys(hmap)[0]] || {};
  const sk = [];
  for (let i = 0; i < 10; i++) {
    if (i >= vl) { sk.push(null); continue; }
    const row = {};
    if (!paper) {
      const raw = (res.officialSkills || [])[i];
      const m = raw != null && raw !== '' ? idx.find(raw) : null;
      row.sym = m ? skillSymbol(m) : (raw != null && raw !== '' ? '?' : '–');
      if (hasManualDD) row.dd = dashOr(res.officialDDValues[i] ?? 0, v => Number(v).toFixed(1));
      else row.dd = calc?.rows[i]?.skill ? (calc.rows[i].isDesignated ? calc.rows[i].usedDD.toFixed(1) : '–') : '–';
    }
    row.e = fmtEDeduction(res.officialEPerSkill?.[i], synchro);
    if (synchro) {
      row.tof = dashOr(hd.syn?.[i], v => Number(v).toFixed(2));
      row.hd = (hd.hd1?.[i] != null || hd.hd2?.[i] != null) ? `${hd.hd1?.[i] ?? '–'} / ${hd.hd2?.[i] ?? '–'}` : '–';
    } else {
      row.tof = dashOr(hd.tof?.[i], v => Number(v).toFixed(3));
      row.hd = hd.hd?.[i] != null ? String(hd.hd[i]) : '–';
    }
    sk.push(row);
  }

  const penNum = num(res.penalty);
  const routine = {
    at,
    total: num(res.officialTotal) ?? 0, d: num(res.officialD) ?? 0, e: num(res.officialE) ?? 0,
    tof: num(res.tof) ?? 0, hd: num(res.hd?.total) ?? 0, pen: penNum ?? 0,
    vl,
    s: {
      total: f2(res.officialTotal) ?? '0.00', d: f1(res.officialD) ?? '0.0',
      e: (synchro ? f2r(res.officialE) : f1(res.officialE)) ?? (synchro ? '0.00' : '0.0'),
      tof: f2(res.tof) ?? '0.00', hd: f2(res.hd?.total) ?? '0.00',
      pen: penNum ? f1(penNum) : '',
    },
    sk,
    land: vl < 10 ? '' : fmtEDeduction(res.officialELanding, synchro),
    pr: (res.penaltyItems || []).map(penaltyLabel).filter(Boolean),
  };
  return routine;
}

/** 反則の表示（会場ディスプレイと同じ: 英字の表示名＋減点。例 'START DELAY −0.2'） */
function penaltyLabel(p) {
  const name = String(p?.display || p?.en || p?.ja || p?.label || p?.name || p?.reason || '');
  if (!name) return '';
  const pt = Number(p?.points);
  return p?.points != null && p.points !== '' && Number.isFinite(pt) ? `${name} −${pt.toFixed(1)}` : name;
}

// ============================================================
//  グループ（種目×クラス×性別）・名簿・目次
// ============================================================
const GENDER_ORDER = g => g === '男子' ? 0 : g === '女子' ? 1 : 2;
const TYPE_LABEL = t => t === 'synchro' ? 'シンクロ' : t === 'team' ? '団体' : '個人';
export const athleteType = a => a?.type === 'synchro' ? 'synchro' : 'individual';
export const athleteClass = a => a?.class || a?.category || '';

/** グループのキー。ドキュメントIDに使えない文字（/）は置き換える */
export function groupKey(type, cls, gender) {
  return [type, cls, gender].map(s => String(s ?? '').replace(/[\/\\]/g, '／').replace(/^\.+$/, '・')).join('__');
}
export const groupLabel = (type, cls, gender) => `${TYPE_LABEL(type)} ${cls} ${gender}`;

/** クラスのルール（tour.classRules は新旧の形式がある） */
export function ruleOf(tour, type, cls) {
  const cr = tour?.classRules || {};
  const byType = ('individual' in cr || 'synchro' in cr) ? (cr[type] || {}) : (type === 'individual' ? cr : {});
  return byType[cls] || {};
}
/** 公開に必要なルールだけを取り出す */
export function publicRule(tour, type, cls) {
  const r = ruleOf(tour, type, cls);
  return {
    numPre: r.qualifyingRoutines ?? tour?.qualifyingRoutines ?? 1,
    scoreMode: r.scoreMode || 'best',
    finalScoreMode: r.finalScoreMode ?? 'zero',
    hasFinal: r.hasFinal !== false,
    finalOnly: r.finalOnly === true,
    useOnlineCard: r.useOnlineCard !== false,
  };
}
function classOrder(tour, type) {
  const c = tour?.classes;
  const defs = Array.isArray(c) ? c : (c?.[type] || c?.individual || []);
  return defs.slice().sort((a, b) => (a.display_order ?? 99) - (b.display_order ?? 99)).map(x => x.name);
}

/** 名簿の1人分 */
export function rosterEntry(a, finalOrders) {
  const fo = finalOrders?.[a.id]?.finalOrder ?? a.finalOrder ?? null;
  return { n1: a.name1 || '', n2: a.name2 || '', c1: a.club1 || '', c2: a.club2 || '', fo };
}

/** 選手を、グループごとに分ける（種目→クラス→性別の並び） */
export function listGroups(tour, athletes) {
  const out = [];
  for (const type of ['individual', 'synchro']) {
    const ath = athletes.filter(a => athleteType(a) === type);
    const present = [...new Set(ath.map(athleteClass).filter(Boolean))];
    const order = classOrder(tour, type);
    const classes = [...order.filter(c => present.includes(c)), ...present.filter(c => !order.includes(c))];
    for (const cls of classes) {
      const genders = [...new Set(ath.filter(a => athleteClass(a) === cls).map(a => a.gender || '').filter(Boolean))]
        .sort((a, b) => GENDER_ORDER(a) - GENDER_ORDER(b));
      for (const gender of genders) out.push({ type, cls, gender, key: groupKey(type, cls, gender) });
    }
  }
  return out;
}

/** チーム（teams コレクション）を、公開用の形（{name, members}）にして、クラス×性別で引ける形にする */
function teamsByClassGender(teams) {
  const m = new Map();
  (teams || []).forEach(t => {
    const k = `${t.class || ''}\u0000${t.gender || ''}`;
    if (!m.has(k)) m.set(k, []);
    m.get(k).push({ name: t.teamName || '', members: (t.memberIds || []).map(String) });
  });
  return m;
}

/** 目次（_index）の内容 */
export function buildIndex(tour, athletes, teams) {
  const tb = teamsByClassGender(teams);
  const groups = listGroups(tour, athletes).map((g, i) => {
    const rule = publicRule(tour, g.type, g.cls);
    return {
      key: g.key, type: g.type, cls: g.cls, gender: g.gender, label: groupLabel(g.type, g.cls, g.gender), order: i,
      hasFinal: rule.hasFinal, finalOnly: rule.finalOnly,
      hasTeam: g.type === 'individual' && tb.has(`${g.cls}\u0000${g.gender}`),
    };
  });
  return {
    v: BOARD_VERSION,
    tournament: {
      name: tour?.name || '', venue: tour?.venue || '',
      startDate: tour?.start_date || tour?.startDate || '', endDate: tour?.end_date || tour?.endDate || '',
      colorTheme: tour?.displaySettings?.colorTheme || '',
    },
    groups,
  };
}

/** あるグループの meta（ルール・名簿・チーム） */
export function buildMeta(tour, athletes, teams, g, finalOrders) {
  const tb = teamsByClassGender(teams);
  const roster = {};
  athletes.filter(a => athleteType(a) === g.type && athleteClass(a) === g.cls && (a.gender || '') === g.gender)
    .forEach(a => { roster[a.id] = rosterEntry(a, finalOrders); });
  const meta = { rule: publicRule(tour, g.type, g.cls), roster };
  if (g.type === 'individual' && tb.has(`${g.cls}\u0000${g.gender}`)) meta.teams = tb.get(`${g.cls}\u0000${g.gender}`);
  return meta;
}

/** 空の（まだ結果が無い）グループのドキュメント */
export function buildSkeleton(tour, athletes, teams, g, finalOrders) {
  return { v: BOARD_VERSION, meta: buildMeta(tour, athletes, teams, g, finalOrders), rows: {} };
}

/** 結果の採用条件: 確定済み、または、修正中（確定は解除されているが、前の確定値が残っている） */
export function isAdoptable(r) {
  return !!r && (r.published === true || (r.published === false && r.officialTotal != null));
}

/** 結果ドキュメントの確定時刻（ミリ秒）。無ければ fallback */
export function resultTime(r, fallback) {
  const t = r?.publishedAt;
  if (t && typeof t.toMillis === 'function') return t.toMillis();
  if (t && typeof t.seconds === 'number') return t.seconds * 1000;
  if (typeof t === 'string' && !isNaN(Date.parse(t))) return Date.parse(t);
  return fallback ?? Date.now();
}

/**
 * 全グループのドキュメントと目次を、結果から作る（再生成用）。
 * @param {object} p  { tour, athletes, teams, finalOrders?, results: [{id?, athleteId, round, ...}], skills, calcCardDD, parseDDRule, now? }
 * @returns {{ index: object, groups: Object<string, object>, stats: Array }}
 */
export function buildAll(p) {
  const { tour, athletes, teams, finalOrders, results } = p;
  const idx = indexSkills(p.skills);
  const aMap = new Map(athletes.map(a => [a.id, a]));
  const groups = {}, stats = [];
  const list = listGroups(tour, athletes);
  for (const g of list) {
    const doc = buildSkeleton(tour, athletes, teams, g, finalOrders);
    groups[g.key] = doc;
    stats.push({ key: g.key, label: groupLabel(g.type, g.cls, g.gender), confirmed: 0, dns: 0, unresolved: 0 });
  }
  const statOf = Object.fromEntries(stats.map(s => [s.key, s]));
  for (const r of results || []) {
    if (!isAdoptable(r) || !ROUNDS.includes(r.round)) continue;
    const a = aMap.get(r.athleteId);
    if (!a) continue;
    const key = groupKey(athleteType(a), athleteClass(a), a.gender || '');
    const doc = groups[key];
    if (!doc) continue;
    const at = resultTime(r, p.now);
    const routine = buildRoutine(r, {
      at, synchro: athleteType(a) === 'synchro', gender: a.gender, rule: ruleOf(tour, athleteType(a), athleteClass(a)),
      round: r.round, skills: idx, calcCardDD: p.calcCardDD, parseDDRule: p.parseDDRule,
    });
    (doc.rows[r.athleteId] ||= {})[r.round] = routine;
    if (routine.dns) statOf[key].dns++; else statOf[key].confirmed++;
    statOf[key].unresolved += findUnresolvedSkills(r, idx).length;
  }
  stats.forEach(s => { s.bytes = JSON.stringify(groups[s.key]).length; });
  return { index: buildIndex(tour, athletes, teams), groups, stats };
}

// ============================================================
//  書き込み（Firestore の関数は、呼び出し側から渡す）
// ============================================================
export const rowPath = (athleteId, round) => {
  if (!athleteId || /[.~*\/\[\]]/.test(athleteId)) throw new Error('選手IDが公開データのパスに使えません: ' + athleteId);
  if (!ROUNDS.includes(round)) throw new Error('ラウンドが不正です: ' + round);
  return `rows.${athleteId}.${round}`;
};

/** { 'a.b.c': v } を { a: { b: { c: v } } } にする（ドキュメントが無いときの setDoc(merge) 用） */
export function nest(fields) {
  const out = {};
  for (const [path, v] of Object.entries(fields)) {
    const ks = path.split('.');
    let o = out;
    ks.slice(0, -1).forEach(k => { o = (o[k] ||= {}); });
    o[ks[ks.length - 1]] = v;
  }
  return out;
}
function deepMerge(base, over) {
  const out = { ...base };
  for (const [k, v] of Object.entries(over)) {
    const isPlain = x => x && typeof x === 'object' && !Array.isArray(x) && Object.getPrototypeOf(x) === Object.prototype;
    out[k] = isPlain(v) && isPlain(out[k]) ? deepMerge(out[k], v) : v;
  }
  return out;
}

/**
 * 公開データの書き手。
 * @param {object} db
 * @param {object} sdk  { doc, setDoc, updateDoc, deleteField, serverTimestamp }（firebase-firestore.js の関数）
 *
 * 書込はすべてフィールド単位。読み込みはしない。ドキュメントがまだ無いときだけ、骨組み（名簿・ルール・チーム）を
 * 添えて setDoc(merge) で作る。台AとBが同時に確定しても、別のフィールドなので衝突しない。
 */
export function createBoardWriter(db, sdk) {
  const ref = (eventId, id) => sdk.doc(db, 'tournaments', eventId, BOARD_COLLECTION, id);
  const stamp = () => sdk.serverTimestamp();

  /** フィールド単位の更新。ドキュメントが無ければ、skeleton() の骨組みごと作る。戻り値: 'updated' | 'created' */
  async function patch(eventId, key, fields, skeleton) {
    const r = ref(eventId, key);
    try {
      await sdk.updateDoc(r, { ...fields, updatedAt: stamp() });
      return 'updated';
    } catch (e) {
      if (e?.code !== 'not-found') throw e;
      const base = skeleton ? await skeleton() : { v: BOARD_VERSION };
      await sdk.setDoc(r, deepMerge(base, nest({ ...fields, updatedAt: stamp() })), { merge: true });
      return 'created';
    }
  }

  return {
    /** 1本の確定を書く */
    writeRoutine: (eventId, key, athleteId, round, routine, skeleton) =>
      patch(eventId, key, { [rowPath(athleteId, round)]: routine }, skeleton),
    /** 1本を消す（棄権の取消・得点の削除）。ドキュメントが無ければ何もしない */
    async deleteRoutine(eventId, key, athleteId, round) {
      try { await sdk.updateDoc(ref(eventId, key), { [rowPath(athleteId, round)]: sdk.deleteField(), updatedAt: stamp() }); }
      catch (e) { if (e?.code !== 'not-found') throw e; }
    },
    /**
     * すでにあるグループの meta（roster / teams / rule）を、書き直す。渡したものだけ。ドキュメントが無ければ何もしない（false）。
     * 大会の準備中に、選手名などが公開されないようにするため、作ることはしない。teams が undefined のときは、項目を消す。
     */
    async updateMeta(eventId, key, parts) {
      const fields = {};
      for (const k of ['roster', 'teams', 'rule']) if (k in parts) fields['meta.' + k] = parts[k] === undefined ? sdk.deleteField() : parts[k];
      if (!Object.keys(fields).length) return true;
      try { await sdk.updateDoc(ref(eventId, key), { ...fields, updatedAt: stamp() }); return true; }
      catch (e) { if (e?.code === 'not-found') return false; throw e; }
    },
    /** 目次を、すでにあるときだけ、書き直す（無ければ何もしない）。書いたら true */
    async updateIndex(eventId, index) {
      try { await sdk.updateDoc(ref(eventId, INDEX_ID), { ...index, updatedAt: stamp() }); return true; }
      catch (e) { if (e?.code === 'not-found') return false; throw e; }
    },
    /** meta の一部（roster / teams / rule）を書き直す（無ければ骨組みごと作る） */
    writeMeta: (eventId, key, field, value, skeleton) => {
      if (!['roster', 'teams', 'rule'].includes(field)) throw new Error('meta のフィールドが不正です: ' + field);
      return patch(eventId, key, { [`meta.${field}`]: value }, skeleton);
    },
    /** 目次がまだ無いときだけ、書く（1回だけ読む）。書いたら true */
    async ensureIndex(eventId, indexFn) {
      const s = await sdk.getDoc(ref(eventId, INDEX_ID));
      if (s.exists()) return false;
      await sdk.setDoc(ref(eventId, INDEX_ID), { ...(await indexFn()), updatedAt: stamp() });
      return true;
    },
    /** 目次を、丸ごと書く */
    writeIndex: (eventId, index) => sdk.setDoc(ref(eventId, INDEX_ID), { ...index, updatedAt: stamp() }),
    /** グループのドキュメントを、丸ごと書く（再生成） */
    writeGroup: (eventId, key, doc) => sdk.setDoc(ref(eventId, key), { ...doc, updatedAt: stamp() }),
    /** 再生成で、もう無いグループのドキュメントを消す */
    removeGroup: (eventId, key) => sdk.deleteDoc ? sdk.deleteDoc(ref(eventId, key)) : Promise.resolve(),
  };
}

// ============================================================
//  読み取り側（閲覧者のブラウザで、順位・Q・団体を計算する）
// ============================================================
/** routine を、shared.js の順位関数が読める形（結果ドキュメントの形）にする */
export function asResult(r) {
  return r ? { officialTotal: r.dns ? null : r.total, tof: r.tof ?? null, hd: { total: r.hd ?? null }, officialD: r.d ?? null, dns: r.dns === true } : null;
}

/**
 * 個人・シンクロの順位表を作る。
 * @param {object} doc    グループのドキュメント（meta・rows）
 * @param {'qual'|'final'} phase
 * @param {object} S      shared.js の { calcQualifyingScore, calcQualifyingTb, calcFinalScore, compareRankEntries, assignRanks, extractTbScores }
 * @returns {{ ranked: Array, waiting: Array, dns: Array, total: number, rule: object }}
 *   各行: { id, n1, n2, c1, c2, fo, p1, p2, fin（routine または null）, qualScore, qualPart, rank, isDns, showQ, adopted }
 */
export function rankGroup(doc, phase, S) {
  const rule = doc?.meta?.rule || {};
  const numPre = rule.numPre ?? 1, scoreMode = rule.scoreMode || 'best', finalScoreMode = rule.finalScoreMode ?? 'zero';
  const roster = doc?.meta?.roster || {}, rows = doc?.rows || {};
  let ids = Object.keys(roster);
  if (phase === 'final') ids = ids.filter(id => roster[id].fo != null);
  const list = ids.map(id => {
    const p1 = rows[id]?.pre1 || null, p2 = rows[id]?.pre2 || null, fin = rows[id]?.final || null;
    const p1r = asResult(p1), p2r = asResult(p2), fr = asResult(fin);
    const t1 = p1r?.officialTotal ?? null, t2 = p2r?.officialTotal ?? null, tf = fr?.officialTotal ?? null;
    const qualPart = S.calcQualifyingScore(t1, t2, numPre, scoreMode);
    let qualScore, tbSum = null, tb;
    if (phase === 'qual') { qualScore = qualPart; ({ tbSum, tb } = S.calcQualifyingTb(t1, t2, p1r, p2r, numPre, scoreMode)); }
    else { qualScore = S.calcFinalScore(qualPart, tf, finalScoreMode); tb = S.extractTbScores(fr); }
    const isDns = phase === 'qual' ? (p1?.dns === true || p2?.dns === true) : fin?.dns === true;
    if (isDns) qualScore = null;
    let adopted = -1;
    if (phase === 'qual' && numPre >= 2 && scoreMode === 'best') {
      if (p1 && p2 && !p1.dns && !p2.dns) adopted = (p2.total ?? 0) > (p1.total ?? 0) ? 1 : 0;
      else adopted = p1 && !p1.dns ? 0 : (p2 && !p2.dns ? 1 : -1);
    }
    const r = roster[id];
    return {
      id, ...r, p1, p2, fin, qualScore, qualPart, tbSum, tb, isDns, adopted,
      showQ: phase === 'qual' && rule.hasFinal !== false && rule.finalOnly !== true && r.fo != null,
    };
  });
  const ranked = list.filter(r => !r.isDns && r.qualScore != null).sort(S.compareRankEntries);
  S.assignRanks(ranked);
  return {
    ranked, rule,
    waiting: list.filter(r => !r.isDns && r.qualScore == null),
    dns: list.filter(r => r.isDns),
    total: list.length,
  };
}

/**
 * 団体の順位（予選のみ）。上位3名の合計。ベスト方式は2本のうち良い方、合計方式は1本目と2本目をそれぞれ上位3名。
 * 同点は、合計→T→H→D の順で比べ、すべて同じなら同順位（ranking.html と同じ）。
 * @returns {Array<{ rank, name, score, T, H, D, members: Array }>}
 */
export function rankTeams(doc) {
  const rule = doc?.meta?.rule || {};
  const scoreMode = rule.scoreMode || 'best', numPre = rule.numPre ?? 1;
  const roster = doc?.meta?.roster || {}, rows = doc?.rows || {};
  const ZERO = { total: 0, T: 0, H: 0, D: 0 };
  const comp = r => (!r || r.dns === true) ? ZERO : { total: r.total ?? 0, T: r.tof ?? 0, H: r.hd ?? 0, D: r.d ?? 0 };
  const top3 = arr => [...arr].sort((a, b) => b - a).slice(0, 3).reduce((s, v) => s + v, 0);
  const teams = (doc?.meta?.teams || []).map(t => {
    const members = (t.members || []).map(id => {
      const raw1 = rows[id]?.pre1, raw2 = rows[id]?.pre2;
      const p1 = comp(raw1), p2 = comp(raw2);
      const base = { id, name: roster[id]?.n1 || id, p1, p2, has1: raw1 != null, has2: raw2 != null };
      if (scoreMode === 'best') { const use2 = p2.total > p1.total; const ad = use2 ? p2 : p1; return { ...base, score: ad.total, T: ad.T, H: ad.H, D: ad.D, adopt: use2 ? 2 : 1 }; }
      return base;
    });
    let score, T, H, D;
    if (scoreMode === 'best') {
      score = top3(members.map(m => m.score)); T = top3(members.map(m => m.T)); H = top3(members.map(m => m.H)); D = top3(members.map(m => m.D));
      members.sort((a, b) => b.score - a.score); members.forEach((m, i) => { m.counted = i < 3; });
    } else {
      score = top3(members.map(m => m.p1.total)) + top3(members.map(m => m.p2.total));
      T = top3(members.map(m => m.p1.T)) + top3(members.map(m => m.p2.T));
      H = top3(members.map(m => m.p1.H)) + top3(members.map(m => m.p2.H));
      D = top3(members.map(m => m.p1.D)) + top3(members.map(m => m.p2.D));
      const i1 = [...members].sort((a, b) => b.p1.total - a.p1.total).slice(0, 3).map(m => m.id);
      const i2 = [...members].sort((a, b) => b.p2.total - a.p2.total).slice(0, 3).map(m => m.id);
      members.forEach(m => { m.c1 = i1.includes(m.id); m.c2 = i2.includes(m.id); });
      members.sort((a, b) => (b.p1.total + b.p2.total) - (a.p1.total + a.p2.total));
    }
    return { name: t.name || '–', members, score, T, H, D, numPre };
  });
  teams.sort((a, b) => b.score - a.score || b.T - a.T || b.H - a.H || b.D - a.D);
  let rank = 0, prev = null;
  teams.forEach((t, i) => { const k = `${t.score}|${t.T}|${t.H}|${t.D}`; if (k !== prev) { rank = i + 1; prev = k; } t.rank = rank; });
  return teams;
}
