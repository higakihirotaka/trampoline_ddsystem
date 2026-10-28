import test from 'node:test';
import assert from 'node:assert/strict';
import { loadEsm } from './helpers.mjs';

const {
  round1, applyIfChanged, normalizeClassRules, extractTbScores, calcQualifyingScore, calcQualifyingTb,
  calcFinalScore, compareRankEntries, assignRanks, calcBonus, resolveEJudgeCount, getJudgeRoles,
  judgeRosterLeafKey, buildJudgeRosterGroups, applyJudgeRosterOrder, filterHiddenJudgeRosterGroups, buildIntroSteps,
} = await loadEsm('shared.js');

test('round1: 浮動小数の誤差を小数第1位に丸める', () => {
  assert.equal(round1(0.6 + 0.1 + 1.5 + 0.3 + 5.4), 7.9);
  assert.equal(round1(7.900000000000001), 7.9);
  assert.equal(round1(0.04), 0);
  assert.equal(round1(0.05), 0.1);
});

test('applyIfChanged: 値が変わったときだけ apply を呼ぶ', () => {
  const cache = {}, calls = [];
  applyIfChanged(cache, 'k', { a: 1 }, v => calls.push(v));
  applyIfChanged(cache, 'k', { a: 1 }, v => calls.push(v));
  applyIfChanged(cache, 'k', { a: 2 }, v => calls.push(v));
  applyIfChanged(cache, 'other', { a: 2 }, v => calls.push(v));
  assert.equal(calls.length, 3);
});

test('normalizeClassRules: 新旧フォーマットを統一', () => {
  assert.deepEqual(normalizeClassRules(null), { individual: {}, synchro: {} });
  assert.deepEqual(normalizeClassRules({}), { individual: {}, synchro: {} });
  assert.deepEqual(normalizeClassRules({ C: { a: 1 } }), { individual: { C: { a: 1 } }, synchro: {} });
  const neu = { individual: { C: {} }, synchro: { D: {} } };
  assert.equal(normalizeClassRules(neu), neu);
  assert.deepEqual(normalizeClassRules({ synchro: { D: {} } }).synchro, { D: {} });
});

test('extractTbScores: T/H/D の抽出と旧フィールド名のフォールバック', () => {
  assert.deepEqual(extractTbScores(null), { tof: null, hd: null, diff: null });
  assert.deepEqual(extractTbScores({ tof: 10, hd: { total: 9 }, officialD: 6 }), { tof: 10, hd: 9, diff: 6 });
  assert.deepEqual(extractTbScores({ dd: 5 }), { tof: null, hd: null, diff: 5 });
  assert.equal(extractTbScores({ tof: 0 }).tof, 0);
});

test('calcQualifyingScore: 本数とモード', () => {
  assert.equal(calcQualifyingScore(50, 60, 1, 'total'), 50);
  assert.equal(calcQualifyingScore(50, 60, 2, 'total'), 110);
  assert.equal(calcQualifyingScore(50, 60, 2, 'best'), 60);
  assert.equal(calcQualifyingScore(50, null, 2, 'total'), 50);
  assert.equal(calcQualifyingScore(null, 60, 2, 'best'), 60);
  assert.equal(calcQualifyingScore(null, null, 2, 'best'), null);
});

test('calcQualifyingTb: best は2本合計とベスト演技のT/H/D、total は2本合計のT/H/D', () => {
  const r1 = { tof: 10, hd: { total: 9 }, officialD: 6 }, r2 = { tof: 12, hd: { total: 8 }, officialD: 7 };
  const best = calcQualifyingTb(50, 60, r1, r2, 2, 'best');
  assert.equal(best.tbSum, 110);
  assert.deepEqual(best.tb, { tof: 12, hd: 8, diff: 7 });
  const total = calcQualifyingTb(50, 60, r1, r2, 2, 'total');
  assert.equal(total.tbSum, null);
  assert.deepEqual(total.tb, { tof: 22, hd: 17, diff: 13 });
  assert.deepEqual(calcQualifyingTb(50, null, r1, null, 2, 'best'), { tbSum: null, tb: { tof: 10, hd: 9, diff: 6 } });
  assert.deepEqual(calcQualifyingTb(null, 60, null, r2, 2, 'best').tb, { tof: 12, hd: 8, diff: 7 });
  assert.equal(calcQualifyingTb(50, 60, r1, r2, 1, 'best').tbSum, null);
});

test('calcFinalScore: zero / combined', () => {
  assert.equal(calcFinalScore(100, 50, 'zero'), 50);
  assert.equal(calcFinalScore(100, null, 'zero'), null);
  assert.equal(calcFinalScore(100, 50, 'combined'), 150);
  assert.equal(calcFinalScore(100, null, 'combined'), 100);
  assert.equal(calcFinalScore(null, 50, 'combined'), 50);
});

const E = (qualScore, tbSum = null, tb = {}) => ({ qualScore, tbSum, tb: { tof: null, hd: null, diff: null, ...tb } });

test('compareRankEntries: 主スコア降順・未確定は末尾', () => {
  assert.ok(compareRankEntries(E(60), E(50)) < 0);
  assert.ok(compareRankEntries(E(50), E(60)) > 0);
  assert.ok(compareRankEntries(E(null), E(50)) > 0);
  assert.ok(compareRankEntries(E(50), E(null)) < 0);
  assert.equal(compareRankEntries(E(null), E(null)), 0);
});

test('compareRankEntries: 同点は 2本合計 → T → H → D の順', () => {
  assert.ok(compareRankEntries(E(60, 110), E(60, 100)) < 0);
  assert.ok(compareRankEntries(E(60, null, { tof: 12 }), E(60, null, { tof: 11 })) < 0);
  assert.ok(compareRankEntries(E(60, null, { tof: 12, hd: 8 }), E(60, null, { tof: 12, hd: 9 })) > 0);
  assert.ok(compareRankEntries(E(60, null, { tof: 12, hd: 8, diff: 7 }), E(60, null, { tof: 12, hd: 8, diff: 6 })) < 0);
  assert.equal(compareRankEntries(E(60, null, { tof: 12 }), E(60, null, { tof: 12 })), 0);
  // 小数第3位までで比較: 60.0004 と 60.0001 は同点
  assert.equal(compareRankEntries(E(60.0004), E(60.0001)), 0);
});

test('assignRanks: 同点は同順位、次は人数分飛ぶ', () => {
  const list = [E(70), E(60), E(60), E(50), E(null), E(null)];
  assignRanks(list);
  assert.deepEqual(list.map(r => r.rank), [1, 2, 2, 4, 5, 6]);
});

test('assignRanks: 浮動小数の誤差で同点が崩れない', () => {
  const list = [E(0.1 + 0.2), E(0.3)];
  assignRanks(list);
  assert.deepEqual(list.map(r => r.rank), [1, 1]);
});

test('calcBonus: 男子は6本目から、女子・混合は3本目から +0.3', () => {
  const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);
  near(calcBonus('男子', 5), 0); near(calcBonus('男子', 6), 0.3); near(calcBonus('男子', 8), 0.9);
  near(calcBonus('女子', 2), 0); near(calcBonus('女子', 3), 0.3); near(calcBonus('女子', 4), 0.6);
  near(calcBonus('混合', 3), 0.3);
  near(calcBonus('その他', 9), 0);
});

test('resolveEJudgeCount: 新旧フォーマット', () => {
  assert.equal(resolveEJudgeCount(5, 'pre1'), 5);
  assert.equal(resolveEJudgeCount('4', 'final'), 4);
  assert.equal(resolveEJudgeCount({ pre: 4, final: 5 }, 'pre2'), 4);
  assert.equal(resolveEJudgeCount({ pre: 4, final: 5 }, 'final'), 5);
  assert.equal(resolveEJudgeCount({ pre: 4, final: 5 }, '決勝'), 5);
  assert.equal(resolveEJudgeCount({ pre: 4 }, 'final'), null);
  assert.equal(resolveEJudgeCount(0, 'pre1'), null);
  assert.equal(resolveEJudgeCount(undefined, 'pre1'), null);
});

test('getJudgeRoles: E人数・H5/H6・ラウンド別人数', () => {
  const keys = r => r.map(x => x[0]).join(',');
  assert.equal(keys(getJudgeRoles('C', 'individual', {})), 'cjp,e1,e2,e3,e4,d7,d8');
  const rules = { individual: { C: { eJudgeCount: { pre: 4, final: 5 }, hasH5H6: true } } };
  assert.equal(keys(getJudgeRoles('C', 'individual', rules, '予選')), 'cjp,e1,e2,e3,e4,h5,h6,d7,d8');
  assert.equal(keys(getJudgeRoles('C', 'individual', rules, '決勝')), 'cjp,e1,e2,e3,e4,e5,h5,h6,d7,d8');
});

test('審判構成: 同一構成のまとめ・表示順・非表示', () => {
  const cfg = { individual: {
    A: { 男子: { 予選: { cjp: 'x', e1: 'y' } } },
    B: { 男子: { 予選: { cjp: 'x', e1: 'y' } } },
    C: { 男子: { 予選: { cjp: 'z' } } },
  } };
  const groups = buildJudgeRosterGroups([{ name: 'A' }, { name: 'B' }, { name: 'C' }, { name: 'D' }], 'individual', cfg, {});
  assert.equal(groups.length, 2);                                  // A と B は同一構成、D は未設定で除外
  assert.deepEqual(groups[0].leafKeys, ['A::男子::予選', 'B::男子::予選']);
  assert.equal(judgeRosterLeafKey('A', '', ''), 'A');
  const reordered = applyJudgeRosterOrder(groups, ['C::男子::予選']);
  assert.deepEqual(reordered[0].leafKeys, ['C::男子::予選']);
  assert.equal(filterHiddenJudgeRosterGroups(groups, ['A::男子::予選']).length, 2);   // 一部だけ非表示 → 表示する
  assert.equal(filterHiddenJudgeRosterGroups(groups, ['A::男子::予選', 'B::男子::予選']).length, 1);
});

test('buildIntroSteps: 一覧ページはクラス・性別の切れ目に入る', () => {
  const a = [
    { class: 'C', gender: '男子', name1: '1' }, { class: 'C', gender: '男子', name1: '2' },
    { class: 'C', gender: '女子', name1: '3' },
  ];
  assert.equal(buildIntroSteps(a, false).length, 3);
  const steps = buildIntroSteps(a, true);
  assert.deepEqual(steps.map(s => s.type), ['athlete', 'athlete', 'classRoster', 'athlete', 'classRoster']);
  assert.equal(steps[2].className, 'C 男子');
  assert.equal(steps[2].athletes.length, 2);
});
