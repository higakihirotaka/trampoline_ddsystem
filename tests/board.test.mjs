import test from 'node:test';
import assert from 'node:assert/strict';
import { loadEsm } from './helpers.mjs';

const B = await loadEsm('board.js');
const S = await loadEsm('shared.js');
const {
  f1, f2, f2r, fmtEDeduction, indexSkills, findUnresolvedSkills, buildRoutine, groupKey, ruleOf, publicRule,
  listGroups, buildIndex, buildMeta, buildSkeleton, isAdoptable, buildAll, rowPath, nest, createBoardWriter,
  rankGroup, rankTeams, INDEX_ID, resultTime,
} = B;
const sharedFns = { calcQualifyingScore: S.calcQualifyingScore, calcQualifyingTb: S.calcQualifyingTb, calcFinalScore: S.calcFinalScore, compareRankEntries: S.compareRankEntries, assignRanks: S.assignRanks, extractTbScores: S.extractTbScores };
const dd = { calcCardDD: S.calcCardDD, parseDDRule: S.parseDDRule };

// ---------- 共通の入力 ----------
const MASTER = [
  { id: '1', symbol: 'ハーフシート', displaySymbol: 'H.Seat', dd: 0.1, isTriple: false },
  { id: '2', symbol: 'バック', displaySymbol: 'o', dd: 0.5, isTriple: false },
  { id: '3', symbol: 'トリプル', displaySymbol: '3<', dd: 3.0, isTriple: true },
  { id: '4', symbol: '記号のみ', dd: 0.4, isTriple: false },
];
const tenSkills = ['1', '2', '3', '2', '4', '', '', '', '', ''];
const baseRes = (over = {}) => ({
  published: true, validCount: 5,
  officialSkills: tenSkills, officialD: 4.1, officialE: 17.3, tof: 12.345, hd: { total: 9.5 }, penalty: 0.4, officialTotal: 42.7,
  officialEPerSkill: [0.1, 0.2, 0.0, 0.3, 0.1], officialELanding: 0.2,
  penaltyItems: [{ ja: '枠外', en: 'Out', display: 'x', points: 0.4 }],
  execution: { judges: { A_E1: {}, A_E2: {}, B_E1: {} } },
  hdtsPerSkillByPanel: { A: { tof: [1.2, 1.234, 1.1, 1.0, 1.05], hd: [0, 1, 0, 0, 2] }, B: { tof: [9, 9, 9, 9, 9], hd: [9, 9, 9, 9, 9] } },
  ...over,
});
const ctx = (over = {}) => ({ at: 1000, synchro: false, gender: '男子', rule: {}, round: 'pre1', skills: MASTER, ...dd, ...over });

// ---------- 整形 ----------
test('整形: 小数の桁と、E減点（個人は10倍の整数、シンクロは10倍の小数第2位）', () => {
  assert.equal(f1(17.34), '17.3'); assert.equal(f2(9.5), '9.50'); assert.equal(f1(null), null);
  assert.equal(f2r(1.005), '1.01'); assert.equal(f2r(17.345), '17.35');
  assert.equal(fmtEDeduction(0.3, false), '3'); assert.equal(fmtEDeduction(0.25, true), '2.50'); assert.equal(fmtEDeduction(null, false), '–');
});

// ---------- 技マスタ ----------
test('技マスタ: IDでも記号でも引ける。オブジェクト形式も受け付ける。未解決の技を数える', () => {
  const idx = indexSkills(MASTER);
  assert.equal(idx.find('2').displaySymbol, 'o');
  assert.equal(idx.find('バック').id, '2');
  assert.equal(idx.find(''), null);
  const idx2 = indexSkills({ 7: { symbol: 'X', dd: 1 } });
  assert.equal(idx2.find('7').symbol, 'X');
  assert.deepEqual(findUnresolvedSkills(baseRes({ officialSkills: ['1', '999', '2', '', '77'] }), MASTER), ['999', '77']);
  // 有効技数より後ろの技は見ない
  assert.deepEqual(findUnresolvedSkills(baseRes({ validCount: 2, officialSkills: ['1', '2', '999'] }), MASTER), []);
});

// ---------- routine ----------
test('routine: 個人の数値・表示用文字列・技ごとの内訳（重複は難度0.0、ToFは小数第3位、パネルは人数の多い方）', () => {
  const r = buildRoutine(baseRes(), ctx());
  assert.equal(r.at, 1000);
  assert.equal(r.total, 42.7); assert.equal(r.vl, 5); assert.equal(r.pen, 0.4);
  assert.deepEqual(r.s, { total: '42.70', d: '4.1', e: '17.3', tof: '12.35', hd: '9.50', pen: '0.4' });
  assert.equal(r.sk.length, 10);
  assert.deepEqual(r.sk[0], { sym: 'H.Seat', dd: '0.1', e: '1', tof: '1.200', hd: '0' });
  assert.deepEqual(r.sk[1], { sym: 'o', dd: '0.5', e: '2', tof: '1.234', hd: '1' });
  assert.equal(r.sk[3].sym, 'o'); assert.equal(r.sk[3].dd, '0.0', '同じ技の2回目は難度0.0');
  assert.equal(r.sk[4].sym, '記号のみ', 'displaySymbol が無ければ symbol');
  assert.equal(r.sk[5], null, '有効技数より後ろは null');
  assert.equal(r.land, '', '有効技数が10未満なら着地は無し');
  assert.deepEqual(r.pr, ['x −0.4']);   // 会場ディスプレイと同じ: 英字の表示名 − 減点
});

test('routine: 10本そろった演技は着地を持つ。減点が0なら表示は空', () => {
  const r = buildRoutine(baseRes({ validCount: 10, penalty: 0, officialELanding: 0.3, officialSkills: ['1', '2', '3', '4', '1', '2', '3', '4', '1', '2'], penaltyItems: [] }), ctx());
  assert.equal(r.land, '3'); assert.equal(r.s.pen, ''); assert.deepEqual(r.pr, []);
});

test('routine: シンクロは E が小数第2位、Syn・HD は2人分', () => {
  const res = baseRes({
    officialE: 17.345, hdtsPerSkillByPanel: { A: { isSynchro: true, syn: [8.5, 8.25], hd1: [1, 2], hd2: [0, null] } }, validCount: 2,
    officialEPerSkill: [0.15, 0.2], officialELanding: 0,
  });
  const r = buildRoutine(res, ctx({ synchro: true }));
  assert.equal(r.s.e, '17.35');
  assert.deepEqual(r.sk[0], { sym: 'H.Seat', dd: '0.1', e: '1.50', tof: '8.50', hd: '1 / 0' });
  assert.equal(r.sk[1].hd, '2 / –');
  assert.equal(r.sk[1].tof, '8.25');
});

test('routine: 紙運用クラスは技の記号と難度を持たない（E減点は持つ）', () => {
  const r = buildRoutine(baseRes(), ctx({ rule: { useOnlineCard: false } }));
  assert.equal('sym' in r.sk[0], false); assert.equal('dd' in r.sk[0], false);
  assert.equal(r.sk[0].e, '1');
});

test('routine: 技マスタに無い技は記号 ?、技が空欄なら –', () => {
  const r = buildRoutine(baseRes({ officialSkills: ['1', '999', '', '2', '2'] }), ctx());
  assert.equal(r.sk[1].sym, '?'); assert.equal(r.sk[2].sym, '–');
  assert.equal(r.sk[1].dd, '–');
});

test('routine: D手動入力の結果は、保存されている各技のDD値をそのまま使う', () => {
  const r = buildRoutine(baseRes({ officialDDValues: [0.1, 0.5, 3, 0, 0.4], officialTotalDD: 4.0 }), ctx());
  assert.deepEqual(r.sk.slice(0, 5).map(x => x.dd), ['0.1', '0.5', '3.0', '0.0', '0.4']);
});

test('routine: 指定難度では、指定されなかった技の難度は –', () => {
  const rule = { qualifyingRoutines: 2, scoreMode: 'total', designatedDDCount: 2 };
  const r = buildRoutine(baseRes({ officialDesignatedDDIndices: [0, 2] }), ctx({ rule }));
  assert.deepEqual(r.sk.slice(0, 5).map(x => x.dd), ['0.1', '–', '3.0', '–', '–']);
});

test('routine: 棄権は dns と時刻だけ', () => {
  assert.deepEqual(buildRoutine({ dns: true, published: true }, ctx()), { at: 1000, dns: true });
});

test('routine: Firestore に書ける（undefined を含まない）。再構築しても、技マスタの後からの変更で変わらない（凍結）', () => {
  const r = buildRoutine(baseRes(), ctx());
  assert.deepEqual(JSON.parse(JSON.stringify(r)), r);
  const frozen = JSON.stringify(r);
  const changed = MASTER.map(m => ({ ...m, displaySymbol: 'CHANGED', dd: 9 }));
  buildRoutine(baseRes(), ctx({ skills: changed })); // 別の技マスタで作り直しても、保存済みの routine は別物
  assert.equal(JSON.stringify(r), frozen);
});

test('routine: 値が欠けた結果でも、落ちずに0と空欄で埋める', () => {
  const r = buildRoutine({ published: true }, ctx());
  assert.equal(r.total, 0); assert.equal(r.s.total, '0.00'); assert.equal(r.sk.length, 10);
  assert.deepEqual(JSON.parse(JSON.stringify(r)), r);
});

// ---------- グループ・名簿・目次 ----------
const TOUR = {
  name: '第1回', venue: '体育館', start_date: '2026-11-01', end_date: '2026-11-02', qualifyingRoutines: 2,
  displaySettings: { colorTheme: 'red' },
  classes: { individual: [{ name: 'Bクラス', display_order: 2 }, { name: 'Aクラス', display_order: 1 }], synchro: [{ name: 'Aクラス', display_order: 1 }] },
  classRules: {
    individual: { Aクラス: { qualifyingRoutines: 2, scoreMode: 'total', finalScoreMode: 'combined' }, Bクラス: { qualifyingRoutines: 1, hasFinal: false, useOnlineCard: false } },
    synchro: { Aクラス: { qualifyingRoutines: 1, finalOnly: true } },
  },
};
const ATH = [
  { id: 'a1', name1: '山田', club1: '甲大', type: 'individual', class: 'Aクラス', gender: '女子', finalOrder: 2 },
  { id: 'a2', name1: '鈴木', club1: '乙大', type: 'individual', class: 'Aクラス', gender: '男子' },
  { id: 'a3', name1: '佐藤', club1: '丙大', type: 'individual', class: 'Aクラス', gender: '男子' },
  { id: 'b1', name1: '田中', club1: '丁大', type: 'individual', category: 'Bクラス', gender: '男子' },
  { id: 's1', name1: '高橋', name2: '伊藤', club1: '戊大', club2: '戊大', type: 'synchro', class: 'Aクラス', gender: '男子' },
];
const TEAMS = [{ id: 't1', class: 'Aクラス', gender: '男子', teamName: '甲大A', memberIds: ['a2', 'a3'] }];

test('groupKey: 区切りは __、/ は置き換える', () => {
  assert.equal(groupKey('individual', 'Aクラス', '男子'), 'individual__Aクラス__男子');
  assert.equal(groupKey('individual', 'A/B', '男子'), 'individual__A／B__男子');
});

test('ルール: 新旧の classRules の形式を読み、公開に必要な設定だけにする', () => {
  assert.deepEqual(publicRule(TOUR, 'individual', 'Aクラス'), { numPre: 2, scoreMode: 'total', finalScoreMode: 'combined', hasFinal: true, finalOnly: false, useOnlineCard: true });
  assert.equal(publicRule(TOUR, 'individual', 'Bクラス').useOnlineCard, false);
  assert.equal(publicRule(TOUR, 'synchro', 'Aクラス').finalOnly, true);
  const old = { classRules: { Aクラス: { qualifyingRoutines: 1 } } };
  assert.equal(ruleOf(old, 'individual', 'Aクラス').qualifyingRoutines, 1);
  assert.deepEqual(ruleOf(old, 'synchro', 'Aクラス'), {});
  assert.equal(publicRule({ qualifyingRoutines: 2 }, 'individual', 'X').numPre, 2, '大会の既定の本数');
  assert.equal(publicRule({}, 'individual', 'X').numPre, 1);
});

test('グループ: 個人→シンクロ、クラスの表示順、男子→女子', () => {
  const g = listGroups(TOUR, ATH);
  assert.deepEqual(g.map(x => x.key), ['individual__Aクラス__男子', 'individual__Aクラス__女子', 'individual__Bクラス__男子', 'synchro__Aクラス__男子']);
});

test('目次: 大会情報とグループ（ラベル・決勝の有無・団体の有無）', () => {
  const ix = buildIndex(TOUR, ATH, TEAMS);
  assert.deepEqual(ix.tournament, { name: '第1回', venue: '体育館', startDate: '2026-11-01', endDate: '2026-11-02', colorTheme: 'red' });
  assert.equal(ix.groups[0].label, '個人 Aクラス 男子');
  assert.deepEqual(ix.groups.map(g => g.hasTeam), [true, false, false, false]);
  assert.deepEqual(ix.groups.map(g => g.hasFinal), [true, true, false, true]);
  assert.deepEqual(ix.groups.map(g => g.finalOnly), [false, false, false, true]);
  assert.deepEqual(ix.groups.map(g => g.order), [0, 1, 2, 3]);
  assert.equal(ix.v, 1);
});

test('名簿: 氏名・所属・決勝試技順。決勝試技順は別管理の値が優先。チームは個人グループに入る', () => {
  const g = listGroups(TOUR, ATH)[0];
  const m = buildMeta(TOUR, ATH, TEAMS, g, { a2: { finalOrder: 5 } });
  assert.deepEqual(m.roster.a2, { n1: '鈴木', n2: '', c1: '乙大', c2: '', fo: 5 });
  assert.equal(m.roster.a3.fo, null);
  assert.deepEqual(m.teams, [{ name: '甲大A', members: ['a2', 'a3'] }]);
  const women = buildMeta(TOUR, ATH, TEAMS, listGroups(TOUR, ATH)[1]);
  assert.equal(women.teams, undefined); assert.equal(women.roster.a1.fo, 2);
  const sk = buildSkeleton(TOUR, ATH, TEAMS, g);
  assert.deepEqual(sk.rows, {}); assert.equal(sk.v, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(sk)), sk);
});

// ---------- 再生成 ----------
test('結果の採用条件: 確定済み、または 修正中（前の値が残っている）', () => {
  assert.equal(isAdoptable({ published: true, officialTotal: 1 }), true);
  assert.equal(isAdoptable({ published: true, dns: true }), true);
  assert.equal(isAdoptable({ published: false, officialTotal: 40 }), true);
  assert.equal(isAdoptable({ published: false }), false, '入力途中');
  assert.equal(isAdoptable({}), false);
  assert.equal(isAdoptable(null), false);
});

test('再生成: 結果を、選手のグループ・ラウンドに振り分ける。修正中の前の値も入る。入力途中は入らない', () => {
  const results = [
    { athleteId: 'a2', round: 'pre1', ...baseRes() },
    { athleteId: 'a2', round: 'pre2', ...baseRes({ published: false, officialTotal: 40 }) },   // 修正中
    { athleteId: 'a3', round: 'pre1', published: false },                                      // 入力途中
    { athleteId: 'a3', round: 'pre2', dns: true, published: true },                            // 棄権
    { athleteId: 'zz', round: 'pre1', ...baseRes() },                                          // 名簿に無い選手
    { athleteId: 'a2', round: 'oops', ...baseRes() },
  ];
  const out = buildAll({ tour: TOUR, athletes: ATH, teams: TEAMS, results, skills: MASTER, now: 5, ...dd });
  const doc = out.groups['individual__Aクラス__男子'];
  assert.equal(doc.rows.a2.pre1.total, 42.7);
  assert.equal(doc.rows.a2.pre2.total, 40);
  assert.equal(doc.rows.a3.pre1, undefined);
  assert.deepEqual(doc.rows.a3.pre2, { at: 5, dns: true });
  assert.equal(Object.keys(out.groups).length, 4);
  const st = out.stats.find(s => s.key === 'individual__Aクラス__男子');
  assert.equal(st.confirmed, 2); assert.equal(st.dns, 1); assert.ok(st.bytes > 100);
  assert.equal(out.index.groups.length, 4);
  assert.deepEqual(JSON.parse(JSON.stringify(out.groups)), out.groups, 'undefined を含まない');
});

// ---------- 書き込み ----------
function fakeSdk() {
  const store = new Map(), log = [];
  const DEL = { __del: true };
  const ref = (...p) => p.join('/');
  const setPath = (obj, path, v) => { const ks = path.split('.'); let o = obj; ks.slice(0, -1).forEach(k => { o = (o[k] ||= {}); }); v === DEL ? delete o[ks.at(-1)] : (o[ks.at(-1)] = v); };
  const merge = (t, s) => { for (const [k, v] of Object.entries(s)) { if (v === DEL) delete t[k]; else if (v && typeof v === 'object' && !Array.isArray(v) && !v.__ts) { t[k] = t[k] && typeof t[k] === 'object' ? t[k] : {}; merge(t[k], v); } else t[k] = v; } };
  return {
    store, log,
    doc: (_db, ...p) => ref(...p),
    serverTimestamp: () => ({ __ts: 1 }),
    deleteField: () => DEL,
    async updateDoc(r, fields) { log.push(['update', r]); if (!store.has(r)) { const e = new Error('nf'); e.code = 'not-found'; throw e; } for (const [p, v] of Object.entries(fields)) setPath(store.get(r), p, v); },
    async setDoc(r, data, opt) { log.push(['set', r, !!opt?.merge]); if (opt?.merge && store.has(r)) merge(store.get(r), data); else { const t = {}; merge(t, data); store.set(r, t); } },
    async deleteDoc(r) { store.delete(r); },
    async getDoc(r) { log.push(['get', r]); return { exists: () => store.has(r), data: () => store.get(r) }; },
  };
}

test('書込: パスは rows.<選手ID>.<ラウンド>。不正なIDやラウンドは拒否', () => {
  assert.equal(rowPath('abc', 'pre1'), 'rows.abc.pre1');
  assert.throws(() => rowPath('a.b', 'pre1')); assert.throws(() => rowPath('', 'pre1')); assert.throws(() => rowPath('abc', 'x'));
  assert.deepEqual(nest({ 'a.b.c': 1, 'a.d': 2, e: 3 }), { a: { b: { c: 1 }, d: 2 }, e: 3 });
});

test('書込: ドキュメントがあれば、その1本だけをフィールド単位で更新する（他の本は触らない）', async () => {
  const sdk = fakeSdk(); const w = createBoardWriter({}, sdk); const key = 'individual__Aクラス__男子';
  const path = `tournaments/E/publicBoard/${key}`;
  sdk.store.set(path, { rows: { a3: { pre1: { total: 1 } } }, meta: { roster: {} } });
  await w.writeRoutine('E', key, 'a2', 'pre1', { total: 42.7 });
  assert.deepEqual(sdk.store.get(path).rows, { a3: { pre1: { total: 1 } }, a2: { pre1: { total: 42.7 } } });
  assert.deepEqual(sdk.log, [['update', path]]);
});

test('書込: ドキュメントが無ければ、名簿・ルール・チームの骨組みごと作る。同時に作っても、別の本は消えない', async () => {
  const sdk = fakeSdk(); const w = createBoardWriter({}, sdk); const key = 'individual__Aクラス__男子';
  const g = listGroups(TOUR, ATH)[0];
  const skeleton = () => buildSkeleton(TOUR, ATH, TEAMS, g);
  await w.writeRoutine('E', key, 'a2', 'pre1', { total: 42.7 }, skeleton);
  const d = sdk.store.get(`tournaments/E/publicBoard/${key}`);
  assert.equal(d.rows.a2.pre1.total, 42.7); assert.equal(d.meta.roster.a3.n1, '佐藤'); assert.equal(d.meta.teams[0].name, '甲大A'); assert.equal(d.v, 1);
  // 台Bも、初回だと思って骨組みごと書く（merge なので、台Aの本は残る）
  sdk.log.length = 0; sdk.store.delete(`tournaments/E/publicBoard/${key}`);
  const w2 = createBoardWriter({}, sdk);
  await Promise.all([
    w.writeRoutine('E', key, 'a2', 'pre1', { total: 1 }, skeleton),
    (async () => { await new Promise(r => setTimeout(r, 0)); await w2.writeRoutine('E', key, 'a3', 'pre1', { total: 2 }, skeleton); })(),
  ]);
  const d2 = sdk.store.get(`tournaments/E/publicBoard/${key}`);
  assert.equal(d2.rows.a2.pre1.total, 1); assert.equal(d2.rows.a3.pre1.total, 2);
});

test('書込: 削除はフィールド単位。ドキュメントが無ければ何もしない。他のエラーは投げる', async () => {
  const sdk = fakeSdk(); const w = createBoardWriter({}, sdk); const key = 'k'; const path = `tournaments/E/publicBoard/${key}`;
  await w.deleteRoutine('E', key, 'a2', 'pre1');   // 無くても落ちない
  sdk.store.set(path, { rows: { a2: { pre1: { total: 1 }, pre2: { total: 2 } } } });
  await w.deleteRoutine('E', key, 'a2', 'pre1');
  assert.deepEqual(sdk.store.get(path).rows, { a2: { pre2: { total: 2 } } });
  sdk.updateDoc = async () => { const e = new Error('denied'); e.code = 'permission-denied'; throw e; };
  await assert.rejects(() => w.deleteRoutine('E', key, 'a2', 'pre2'), /denied/);
  await assert.rejects(() => w.writeRoutine('E', key, 'a2', 'pre2', {}), /denied/);
});

test('書込: meta の一部（名簿・チーム・ルール）を書き直す。目次はドキュメント全体を書く', async () => {
  const sdk = fakeSdk(); const w = createBoardWriter({}, sdk); const path = 'tournaments/E/publicBoard/k';
  sdk.store.set(path, { meta: { roster: { a: { n1: '旧' } }, rule: { numPre: 1 } }, rows: { a: { pre1: { total: 3 } } } });
  await w.writeMeta('E', 'k', 'roster', { a: { n1: '新' } });
  assert.equal(sdk.store.get(path).meta.roster.a.n1, '新'); assert.equal(sdk.store.get(path).meta.rule.numPre, 1);
  assert.equal(sdk.store.get(path).rows.a.pre1.total, 3, '得点は触らない');
  assert.throws(() => w.writeMeta('E', 'k', 'rows', {}));
  await w.writeIndex('E', { v: 1, groups: [] });
  assert.equal(sdk.store.get(`tournaments/E/publicBoard/${INDEX_ID}`).v, 1);
});

// ---------- 順位 ----------
const rt = (total, o = {}) => ({ at: 1, total, d: o.d ?? 4, e: 0, tof: o.tof ?? 12, hd: o.hd ?? 9, pen: 0, vl: 10, s: {}, sk: [], land: '', pr: [], ...o });
const doc = (rule, roster, rows, teams) => ({ v: 1, meta: { rule: { numPre: 1, scoreMode: 'best', finalScoreMode: 'zero', hasFinal: true, finalOnly: false, useOnlineCard: true, ...rule }, roster, teams }, rows });
const person = (n, fo = null) => ({ n1: n, n2: '', c1: n + '大', c2: '', fo });

test('順位: 予選（1本）。降順、同点は ToF→HD→D、棄権と演技待ちは別枠', () => {
  const d = doc({ numPre: 1 }, { a: person('A'), b: person('B'), c: person('C'), d: person('D'), e: person('E') }, {
    a: { pre1: rt(50, { tof: 12 }) }, b: { pre1: rt(50, { tof: 13 }) }, c: { pre1: rt(55) }, d: { pre1: { at: 1, dns: true } },
  });
  const r = rankGroup(d, 'qual', sharedFns);
  assert.deepEqual(r.ranked.map(x => [x.id, x.rank]), [['c', 1], ['b', 2], ['a', 3]]);
  assert.deepEqual(r.dns.map(x => x.id), ['d']); assert.deepEqual(r.waiting.map(x => x.id), ['e']); assert.equal(r.total, 5);
});

test('順位: 完全な同点は同順位（次は飛ばす）', () => {
  const d = doc({}, { a: person('A'), b: person('B'), c: person('C') }, { a: { pre1: rt(50) }, b: { pre1: rt(50) }, c: { pre1: rt(40) } });
  assert.deepEqual(rankGroup(d, 'qual', sharedFns).ranked.map(x => x.rank), [1, 1, 3]);
});

test('順位: ベスト方式は2本のうち良い方、採用した本を示す。合計方式は合算', () => {
  const roster = { a: person('A'), b: person('B') };
  const rows = { a: { pre1: rt(40), pre2: rt(45) }, b: { pre1: rt(44), pre2: rt(30) } };
  const best = rankGroup(doc({ numPre: 2, scoreMode: 'best' }, roster, rows), 'qual', sharedFns);
  assert.deepEqual(best.ranked.map(x => [x.id, x.qualScore, x.adopted]), [['a', 45, 1], ['b', 44, 0]]);
  const total = rankGroup(doc({ numPre: 2, scoreMode: 'total' }, roster, rows), 'qual', sharedFns);
  assert.deepEqual(total.ranked.map(x => [x.id, x.qualScore, x.adopted]), [['b', 74, -1], ['a', 85, -1]].sort((x, y) => y[1] - x[1]));
});

test('順位: ベスト方式で同点なら、2本の合計で決める', () => {
  const roster = { a: person('A'), b: person('B') };
  const rows = { a: { pre1: rt(40), pre2: rt(45) }, b: { pre1: rt(45), pre2: rt(10) } };
  assert.deepEqual(rankGroup(doc({ numPre: 2, scoreMode: 'best' }, roster, rows), 'qual', sharedFns).ranked.map(x => x.id), ['a', 'b']);
});

test('順位: 1本目だけ確定の途中経過でも順位が付く。修正中（前の確定値が残る）でも、その値で順位が付く', () => {
  const roster = { a: person('A'), b: person('B') };
  const rows = { a: { pre1: rt(40) }, b: { pre1: rt(41), pre2: rt(10) } };
  const r = rankGroup(doc({ numPre: 2, scoreMode: 'best' }, roster, rows), 'qual', sharedFns);
  assert.deepEqual(r.ranked.map(x => [x.id, x.qualScore]), [['b', 41], ['a', 40]]);
});

test('Qマーク: 予選で、決勝試技順がある選手。決勝のないクラス・決勝のみのクラスには付けない', () => {
  const roster = { a: person('A', 1), b: person('B') };
  const rows = { a: { pre1: rt(50) }, b: { pre1: rt(40) } };
  assert.deepEqual(rankGroup(doc({}, roster, rows), 'qual', sharedFns).ranked.map(x => x.showQ), [true, false]);
  assert.deepEqual(rankGroup(doc({ hasFinal: false }, roster, rows), 'qual', sharedFns).ranked.map(x => x.showQ), [false, false]);
  assert.deepEqual(rankGroup(doc({ finalOnly: true }, roster, rows), 'qual', sharedFns).ranked.map(x => x.showQ), [false, false]);
});

test('決勝: 決勝試技順のある選手だけ。決勝点のみ（zero）／予選点との合計（combined）', () => {
  const roster = { a: person('A', 1), b: person('B', 2), c: person('C') };
  const rows = { a: { pre1: rt(50), final: rt(40) }, b: { pre1: rt(45), final: rt(46) }, c: { pre1: rt(60) } };
  const zero = rankGroup(doc({ finalScoreMode: 'zero' }, roster, rows), 'final', sharedFns);
  assert.deepEqual(zero.ranked.map(x => [x.id, x.qualScore]), [['b', 46], ['a', 40]]);
  assert.equal(zero.total, 2);
  const comb = rankGroup(doc({ finalScoreMode: 'combined' }, roster, rows), 'final', sharedFns);
  assert.deepEqual(comb.ranked.map(x => [x.id, x.qualScore, x.qualPart]), [['a', 90, 50], ['b', 91, 45]].sort((x, y) => y[1] - x[1]));
});

test('決勝: まだ誰も確定していなければ、全員が「演技待ち」', () => {
  const roster = { a: person('A', 1), b: person('B', 2) };
  const r = rankGroup(doc({}, roster, {}), 'final', sharedFns);
  assert.equal(r.ranked.length, 0); assert.equal(r.waiting.length, 2);
});

test('団体（ベスト方式）: 各選手のベストの上位3名の合計。採用した本と、数えた3名が分かる', () => {
  const roster = { a: person('A'), b: person('B'), c: person('C'), d: person('D'), e: person('E') };
  const rows = { a: { pre1: rt(40), pre2: rt(48) }, b: { pre1: rt(45) }, c: { pre1: rt(30) }, d: { pre1: rt(20) }, e: { pre1: rt(35), pre2: rt(10) } };
  const teams = [{ name: '甲', members: ['a', 'b', 'c', 'd'] }, { name: '乙', members: ['e'] }];
  const t = rankTeams(doc({ numPre: 2, scoreMode: 'best' }, roster, rows, teams));
  assert.deepEqual(t.map(x => [x.name, x.rank, x.score]), [['甲', 1, 123], ['乙', 2, 35]]);
  const m = t[0].members;
  assert.deepEqual(m.map(x => [x.id, x.score, x.adopt, x.counted]), [['a', 48, 2, true], ['b', 45, 1, true], ['c', 30, 1, true], ['d', 20, 1, false]]);
});

test('団体（合計方式）: 1本目と2本目を、それぞれ上位3名。棄権は0点', () => {
  const roster = { a: person('A'), b: person('B'), c: person('C') };
  const rows = { a: { pre1: rt(10), pre2: rt(20) }, b: { pre1: rt(30), pre2: { at: 1, dns: true } }, c: { pre1: rt(5), pre2: rt(25) } };
  const t = rankTeams(doc({ numPre: 2, scoreMode: 'total' }, roster, rows, [{ name: '甲', members: ['a', 'b', 'c'] }]));
  assert.equal(t[0].score, (10 + 30 + 5) + (20 + 0 + 25));
});

test('団体: 完全な同点は同順位。チームが無いクラスは空', () => {
  const roster = { a: person('A'), b: person('B') };
  const rows = { a: { pre1: rt(40) }, b: { pre1: rt(40) } };
  const t = rankTeams(doc({}, roster, rows, [{ name: '甲', members: ['a'] }, { name: '乙', members: ['b'] }]));
  assert.deepEqual(t.map(x => x.rank), [1, 1]);
  assert.deepEqual(rankTeams(doc({}, roster, rows)), []);
});

test('書込: 戻り値で、新規に作ったか分かる。目次は、無いときだけ書く（読むのは1回）', async () => {
  const sdk = fakeSdk(); const w = createBoardWriter({}, sdk); const key = 'k';
  assert.equal(await w.writeRoutine('E', key, 'a1', 'pre1', { total: 1 }, () => ({ v: 1, meta: {}, rows: {} })), 'created');
  assert.equal(await w.writeRoutine('E', key, 'a2', 'pre1', { total: 2 }), 'updated');
  let n = 0; const indexFn = () => { n++; return { v: 1, groups: [] }; };
  assert.equal(await w.ensureIndex('E', indexFn), true);
  assert.equal(await w.ensureIndex('E', indexFn), false);
  assert.equal(n, 1, '2回目は作らない');
  assert.equal(sdk.log.filter(l => l[0] === 'get').length, 2);
});

test('書込: 準備中の公開を避けるため、すでにあるドキュメントだけを書き直す（無ければ作らない）。teams が無くなれば項目を消す', async () => {
  const sdk = fakeSdk(); const w = createBoardWriter({}, sdk); const path = 'tournaments/E/publicBoard/k';
  assert.equal(await w.updateMeta('E', 'k', { roster: { a: {} } }), false);
  assert.equal(sdk.store.has(path), false, '作らない');
  assert.equal(await w.updateIndex('E', { v: 1, groups: [] }), false);
  assert.equal(sdk.store.has('tournaments/E/publicBoard/' + INDEX_ID), false);
  sdk.store.set(path, { meta: { roster: { old: {} }, rule: { numPre: 1 }, teams: [{ name: '甲' }] }, rows: { old: { pre1: { total: 3 } } } });
  assert.equal(await w.updateMeta('E', 'k', { roster: { a: { n1: '新' } }, rule: { numPre: 2 }, teams: undefined }), true);
  const d = sdk.store.get(path);
  assert.deepEqual(Object.keys(d.meta.roster), ['a']); assert.equal(d.meta.rule.numPre, 2); assert.equal('teams' in d.meta, false);
  assert.equal(d.rows.old.pre1.total, 3, '得点は触らない');
  await w.updateMeta('E', 'k', { roster: { b: {} } });   // 渡さなかった項目は、そのまま
  assert.equal(sdk.store.get(path).meta.rule.numPre, 2);
  assert.equal(await w.updateMeta('E', 'k', {}), true);
  sdk.store.set('tournaments/E/publicBoard/' + INDEX_ID, { v: 1, groups: [{ key: 'old' }] });
  assert.equal(await w.updateIndex('E', { v: 1, groups: [{ key: 'new' }] }), true);
  assert.deepEqual(sdk.store.get('tournaments/E/publicBoard/' + INDEX_ID).groups, [{ key: 'new' }]);
});

test('再生成: 各本の時刻は、結果の確定時刻（publishedAt）を引き継ぐ', () => {
  assert.equal(resultTime({ publishedAt: { toMillis: () => 123 } }, 9), 123);
  assert.equal(resultTime({ publishedAt: { seconds: 5 } }, 9), 5000);
  assert.equal(resultTime({ publishedAt: '2026-08-21T00:00:00Z' }, 9), Date.parse('2026-08-21T00:00:00Z'));
  assert.equal(resultTime({}, 9), 9);
  const out = buildAll({ tour: TOUR, athletes: ATH, teams: [], skills: MASTER, ...dd, now: 5, results: [{ athleteId: 'a2', round: 'pre1', ...baseRes(), publishedAt: { seconds: 7 } }] });
  assert.equal(out.groups['individual__Aクラス__男子'].rows.a2.pre1.at, 7000);
});
