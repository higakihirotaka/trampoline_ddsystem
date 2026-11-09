// board.js（公開スコアボード）の書込を、本物の Firebase Web SDK・ルール・エミュレータで確かめる。
// 確かめること: 認証なしで読める・書けない／管理者は書ける／フィールド単位の更新が他の本を壊さない／
// 同時に別の本を書いても両方残る／削除が効く／ドキュメントが無いときの骨組み込みの作成／本物の SDK が受け付ける形（undefined なし）。
import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { makeEnv, assertSucceeds, assertFails, F } from './env.mjs';
import { loadEsm } from '../helpers.mjs';

const B = await loadEsm('board.js');
const S = await loadEsm('shared.js');
let t;
before(async () => { t = await makeEnv('demo-trampoline-board'); });
after(async () => { await t.env.cleanup(); });
beforeEach(async () => { await t.clear(); });

const sdk = { doc: F.doc, setDoc: F.setDoc, updateDoc: F.updateDoc, deleteField: F.deleteField, serverTimestamp: F.serverTimestamp, deleteDoc: F.deleteDoc };
const KEY = 'individual__Aクラス__男子';
const ref = (db, id = KEY) => F.doc(db, 'tournaments', 'E1', 'publicBoard', id);
const read = (id = KEY) => t.read('tournaments', 'E1', 'publicBoard', id);

const TOUR = { name: '試験大会', qualifyingRoutines: 1, classes: { individual: [{ name: 'Aクラス', display_order: 1 }] }, classRules: { individual: { Aクラス: {} } } };
const ATH = [
  { id: 'a1', name1: '山田', club1: '甲大', type: 'individual', class: 'Aクラス', gender: '男子' },
  { id: 'a2', name1: '鈴木', club1: '乙大', type: 'individual', class: 'Aクラス', gender: '男子' },
];
const skeleton = () => B.buildSkeleton(TOUR, ATH, [], B.listGroups(TOUR, ATH)[0]);
const routine = (total, o = {}) => B.buildRoutine({ published: true, validCount: 2, officialSkills: ['1', '2'], officialD: 1, officialE: 17, tof: 12, hd: { total: 9 }, penalty: 0, officialTotal: total, officialEPerSkill: [0.1, 0.2], hdtsPerSkillByPanel: { A: { tof: [1, 2], hd: [0, 0] } }, ...o },
  { at: Date.now(), synchro: false, gender: '男子', rule: {}, round: 'pre1', skills: [{ id: '1', symbol: 'a', dd: 0.5 }, { id: '2', symbol: 'b', dd: 0.6 }], calcCardDD: S.calcCardDD, parseDDRule: S.parseDDRule });

test('ルール: 認証なしで読める。書けない。ログインしているだけの人も書けない。管理者は書ける', async () => {
  await t.seed(db => F.setDoc(ref(db), { v: 1, rows: {} }));
  await assertSucceeds(F.getDoc(ref(t.anon)));
  await assertSucceeds(F.getDoc(ref(t.anon, B.INDEX_ID)));
  await assertFails(F.updateDoc(ref(t.anon), { 'rows.a1.pre1': { total: 1 } }));
  await assertFails(F.setDoc(ref(t.anon, B.INDEX_ID), { v: 1 }));
  await assertFails(F.updateDoc(ref(t.user), { 'rows.a1.pre1': { total: 1 } }));
  await assertSucceeds(F.updateDoc(ref(t.admin), { 'rows.a1.pre1': { total: 1 } }));
  await assertFails(F.deleteDoc(ref(t.anon)));
});

test('書き手（管理者）: ドキュメントが無ければ骨組みごと作り、次からはその1本だけを更新する', async () => {
  const w = B.createBoardWriter(t.admin, sdk);
  await assertSucceeds(w.writeRoutine('E1', KEY, 'a1', 'pre1', routine(42.5), skeleton));
  let d = await read();
  assert.equal(d.v, 1); assert.equal(d.meta.roster.a2.n1, '鈴木'); assert.equal(d.meta.rule.numPre, 1);
  assert.equal(d.rows.a1.pre1.total, 42.5); assert.equal(d.rows.a1.pre1.sk[0].sym, 'a');
  assert.ok(d.updatedAt, 'サーバー時刻が入る');
  await w.writeRoutine('E1', KEY, 'a2', 'pre1', routine(40), skeleton);
  d = await read();
  assert.equal(d.rows.a1.pre1.total, 42.5, '別の選手の本は残る'); assert.equal(d.rows.a2.pre1.total, 40);
  // 再確定: その本だけが丸ごと置き換わる（古い技の内訳が残らない）
  await w.writeRoutine('E1', KEY, 'a1', 'pre1', routine(43, { validCount: 1, officialSkills: ['1'] }), skeleton);
  d = await read();
  assert.equal(d.rows.a1.pre1.total, 43); assert.equal(d.rows.a1.pre1.sk[1], null);
  assert.equal(d.rows.a2.pre1.total, 40);
});

test('書き手: 台AとBが同時に、まだ無いドキュメントへ別の本を書いても、両方残る', async () => {
  const wa = B.createBoardWriter(t.admin, sdk), wb = B.createBoardWriter(t.admin, sdk);
  await assertSucceeds(Promise.all([
    wa.writeRoutine('E1', KEY, 'a1', 'pre1', routine(41), skeleton),
    wb.writeRoutine('E1', KEY, 'a2', 'pre1', routine(39), skeleton),
  ]));
  const d = await read();
  assert.equal(d.rows.a1.pre1.total, 41); assert.equal(d.rows.a2.pre1.total, 39);
  assert.equal(d.meta.roster.a1.n1, '山田');
});

test('書き手: 同じ選手の別の本（1本目・2本目）を、続けて書いても両方残る', async () => {
  const w = B.createBoardWriter(t.admin, sdk);
  await w.writeRoutine('E1', KEY, 'a1', 'pre1', routine(41), skeleton);
  await w.writeRoutine('E1', KEY, 'a1', 'pre2', routine(44), skeleton);
  const d = await read();
  assert.equal(d.rows.a1.pre1.total, 41); assert.equal(d.rows.a1.pre2.total, 44);
});

test('書き手: 棄権の書込と、取消（フィールドの削除）。ドキュメントが無いときの削除は何も起きない', async () => {
  const w = B.createBoardWriter(t.admin, sdk);
  await assertSucceeds(w.deleteRoutine('E1', KEY, 'a1', 'pre1'));
  assert.equal(await read(), undefined, '削除のためにドキュメントを作らない');
  await w.writeRoutine('E1', KEY, 'a1', 'pre1', { at: 1, dns: true }, skeleton);
  await w.writeRoutine('E1', KEY, 'a1', 'pre2', routine(44), skeleton);
  assert.equal((await read()).rows.a1.pre1.dns, true);
  await w.deleteRoutine('E1', KEY, 'a1', 'pre1');
  const d = await read();
  assert.equal(d.rows.a1.pre1, undefined); assert.equal(d.rows.a1.pre2.total, 44);
});

test('書き手: 名簿・チーム・ルールの書き直しは、得点に触れない。名簿からいなくなった選手は消える', async () => {
  const w = B.createBoardWriter(t.admin, sdk);
  await w.writeRoutine('E1', KEY, 'a1', 'pre1', routine(41), skeleton);
  await w.writeMeta('E1', KEY, 'roster', { a1: { n1: '山田（訂正）', n2: '', c1: '甲大', c2: '', fo: 3 } });
  await w.writeMeta('E1', KEY, 'teams', [{ name: '甲大A', members: ['a1'] }]);
  await w.writeMeta('E1', KEY, 'rule', { numPre: 2, scoreMode: 'total' });
  const d = await read();
  assert.deepEqual(Object.keys(d.meta.roster), ['a1']); assert.equal(d.meta.roster.a1.n1, '山田（訂正）'); assert.equal(d.meta.roster.a1.fo, 3);
  assert.equal(d.meta.teams[0].name, '甲大A'); assert.equal(d.meta.rule.numPre, 2);
  assert.equal(d.rows.a1.pre1.total, 41);
});

test('再生成: 目次とグループを、丸ごと書き直せる。認証なしでも読めて、順位が計算できる', async () => {
  const out = B.buildAll({
    tour: TOUR, athletes: ATH, teams: [], skills: [{ id: '1', symbol: 'a', dd: 0.5 }, { id: '2', symbol: 'b', dd: 0.6 }], ...{ calcCardDD: S.calcCardDD, parseDDRule: S.parseDDRule },
    results: [{ athleteId: 'a1', round: 'pre1', published: true, validCount: 2, officialSkills: ['1', '2'], officialTotal: 50, officialD: 1, officialE: 17, tof: 12, hd: { total: 9 }, penalty: 0 },
      { athleteId: 'a2', round: 'pre1', published: true, validCount: 2, officialSkills: ['1', '2'], officialTotal: 55, officialD: 1, officialE: 17, tof: 12, hd: { total: 9 }, penalty: 0 }],
  });
  const w = B.createBoardWriter(t.admin, sdk);
  await assertSucceeds(w.writeIndex('E1', out.index));
  for (const [k, doc] of Object.entries(out.groups)) await assertSucceeds(w.writeGroup('E1', k, doc));
  const ix = (await F.getDoc(ref(t.anon, B.INDEX_ID))).data();
  assert.equal(ix.groups[0].key, KEY); assert.equal(ix.tournament.name, '試験大会');
  const doc = (await F.getDoc(ref(t.anon))).data();
  const r = B.rankGroup(doc, 'qual', { calcQualifyingScore: S.calcQualifyingScore, calcQualifyingTb: S.calcQualifyingTb, calcFinalScore: S.calcFinalScore, compareRankEntries: S.compareRankEntries, assignRanks: S.assignRanks, extractTbScores: S.extractTbScores });
  assert.deepEqual(r.ranked.map(x => [x.id, x.rank]), [['a2', 1], ['a1', 2]]);
});

test('ルール: 公開データ以外（tournaments 直下の大会ドキュメント）の保護は変わっていない', async () => {
  await t.seed(db => F.setDoc(F.doc(db, 'tournaments', 'E1'), { name: 'x' }));
  await assertFails(F.updateDoc(F.doc(t.anon, 'tournaments', 'E1'), { name: 'y' }));
});
