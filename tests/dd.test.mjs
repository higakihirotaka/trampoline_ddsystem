import test from 'node:test';
import assert from 'node:assert/strict';
import { loadEsm } from './helpers.mjs';

const { parseDDRule, calcCardDD, calcBonus, round1 } = await loadEsm('shared.js');

// ---------- parseDDRule ----------
test('parseDDRule: 上限・下限・失格モード', () => {
  assert.deepEqual(parseDDRule(undefined, 'pre1'), {
    perSkillDDCap: null, perSkillDQ: false, routineDDCap: null, routineDQ: false, minRoutineDD: null, designatedDDCount: -1,
  });
  const r = parseDDRule({ perSkillDDCap: '1.9', perSkillDDCapMode: 'disqualify', routineDDCap: 3.9, minRoutineDD: '2.0' }, 'pre1');
  assert.equal(r.perSkillDDCap, 1.9);
  assert.equal(r.perSkillDQ, true);
  assert.equal(r.routineDDCap, 3.9);
  assert.equal(r.routineDQ, false);
  assert.equal(r.minRoutineDD, 2);
  assert.equal(parseDDRule({ perSkillDDCap: 'abc' }, 'pre1').perSkillDDCap, null);
  assert.equal(parseDDRule({ perSkillDDCap: 0 }, 'pre1').perSkillDDCap, 0);
});

test('parseDDRule: 指定難度は 2本合計・予選1本目のみ有効', () => {
  const base = { designatedDDCount: 3, qualifyingRoutines: 2, scoreMode: 'total' };
  assert.equal(parseDDRule(base, 'pre1').designatedDDCount, 3);
  assert.equal(parseDDRule(base, 'pre2').designatedDDCount, -1);
  assert.equal(parseDDRule(base, 'final').designatedDDCount, -1);
  assert.equal(parseDDRule({ ...base, scoreMode: 'best' }, 'pre1').designatedDDCount, -1);
  assert.equal(parseDDRule({ ...base, qualifyingRoutines: 1 }, 'pre1').designatedDDCount, -1);
  assert.equal(parseDDRule({ ...base, designatedDDCount: 0 }, 'pre1').designatedDDCount, 0);
  assert.equal(parseDDRule({ ...base, designatedDDCount: -1 }, 'pre1').designatedDDCount, -1);
  assert.equal(parseDDRule({ ...base, designatedDDCount: null }, 'pre1').designatedDDCount, -1);
});

// ---------- calcCardDD の基本動作 ----------
const sk = (key, dd, isTriple = false) => ({ key, dd, isTriple });
const rule = o => parseDDRule(o, 'pre1');
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);

test('calcCardDD: 合計 = 基礎点 + ボーナス、空欄は0', () => {
  const r = calcCardDD({ skills: [sk('a', 1.0), sk('b', 1.5, true), null, sk('c', 0.6)], gender: '男子', ddRule: rule({}) });
  near(r.baseDD, 3.1); near(r.bonus, 0); near(r.total, 3.1);
  assert.equal(r.rows[2].blank, true);
  assert.equal(r.rows.length, 10);
});

test('calcCardDD: 同じ技は2回目以降0点・基礎点にもトリプル数にも入らない', () => {
  const r = calcCardDD({ skills: [sk('a', 1.0, true), sk('a', 1.0, true), sk('b', 0.5)], gender: '女子', ddRule: rule({}) });
  near(r.baseDD, 1.5); assert.equal(r.tripleCount, 1);
  assert.deepEqual(r.rows.slice(0, 3).map(x => [x.isDupRow, x.isDupZero, x.usedDD]), [[true, false, 1], [true, true, 0], [false, false, 0.5]]);
});

test('calcCardDD: ボーナス（男子は6本目から、女子は3本目から）', () => {
  const six = Array.from({ length: 6 }, (_, i) => sk('t' + i, 1, true));
  near(calcCardDD({ skills: six, gender: '男子', ddRule: rule({}) }).bonus, 0.3);
  near(calcCardDD({ skills: six.slice(0, 3), gender: '女子', ddRule: rule({}) }).bonus, 0.3);
});

test('calcCardDD: 1技あたり上限は丸め込み、失格モードは丸め込まず overCap と skillOverCapDQ を立てる', () => {
  const skills = [sk('a', 2.4), sk('b', 1.0)];
  const cap = calcCardDD({ skills, gender: '', ddRule: rule({ perSkillDDCap: 1.9 }) });
  near(cap.baseDD, 2.9); assert.equal(cap.rows[0].isCapped, true); assert.equal(cap.skillOverCapDQ, false);
  const dq = calcCardDD({ skills, gender: '', ddRule: rule({ perSkillDDCap: 1.9, perSkillDDCapMode: 'disqualify' }) });
  near(dq.baseDD, 3.4); assert.equal(dq.rows[0].overCap, true); assert.equal(dq.rows[0].isCapped, false); assert.equal(dq.skillOverCapDQ, true);
});

test('calcCardDD: 上限ちょうど（浮動小数の誤差があっても）は超過にならない', () => {
  const r = calcCardDD({ skills: [sk('a', 0.1 + 0.2 + 1.6)], gender: '', ddRule: rule({ perSkillDDCap: 1.9 }) });
  assert.equal(r.rows[0].overCap, false);
  const s = Array.from({ length: 10 }, (_, i) => sk('k' + i, [0.6, 0.1, 1.5, 0.3, 0.9, 1.2, 0.8, 1.0, 0.7, 0.8][i]));
  assert.equal(calcCardDD({ skills: s, gender: '', ddRule: rule({ routineDDCap: 7.9 }) }).routineOverCap, false);
});

test('calcCardDD: 構成上限は合計で頭打ち、失格モードは丸め込まず routineOverDQ', () => {
  const skills = [sk('a', 1.5), sk('b', 1.5), sk('c', 1.5)];
  const cap = calcCardDD({ skills, gender: '', ddRule: rule({ routineDDCap: 3.9 }) });
  near(cap.total, 3.9); near(cap.rawTotal, 4.5); assert.equal(cap.routineCapped, true);
  const dq = calcCardDD({ skills, gender: '', ddRule: rule({ routineDDCap: 3.9, routineDDCapMode: 'disqualify' }) });
  near(dq.total, 4.5); assert.equal(dq.routineOverDQ, true); assert.equal(dq.routineCapped, false);
});

test('calcCardDD: 指定難度（選んだ技のみ有効 / 0本指定は全技0）', () => {
  const skills = [sk('a', 1.0), sk('b', 2.0), sk('c', 3.0)];
  const d = { designatedDDCount: 2, qualifyingRoutines: 2, scoreMode: 'total' };
  const r = calcCardDD({ skills, gender: '', ddRule: rule(d), designatedIndices: [0, 2] });
  near(r.baseDD, 4.0); assert.deepEqual(r.rows.slice(0, 3).map(x => x.isDesignated), [true, false, true]);
  near(calcCardDD({ skills, gender: '', ddRule: rule({ ...d, designatedDDCount: 0 }) }).baseDD, 0);
  near(calcCardDD({ skills, gender: '', ddRule: rule({ ...d, designatedDDCount: 2 }), designatedIndices: new Set([1]) }).baseDD, 2.0);
});

test('calcCardDD: 有効本数（中断）以降は計算・重複判定の対象外', () => {
  const skills = [sk('a', 1.0), sk('b', 1.0), sk('a', 1.0)];
  const r = calcCardDD({ skills, gender: '', ddRule: rule({}), validLimit: 2 });
  near(r.baseDD, 2.0);
  assert.equal(r.rows[2].beyondLimit, true);
  assert.equal(r.rows[0].isDupRow, false);        // 3本目の a は有効本数の外なので重複扱いにならない
});

test('calcCardDD: dd が無い技（マスタ未解決）は基礎点に入らないが重複・トリプルの扱いは変わらない', () => {
  const r = calcCardDD({ skills: [sk('x', null, true), sk('y', 1.0)], gender: '', ddRule: rule({}) });
  near(r.baseDD, 1.0); assert.equal(r.tripleCount, 1);
});

// ---------- 各ページの旧ロジックとの照合（差分テスト） ----------
// 共通化の前に各ページへ書かれていた計算を、そのまま純粋関数にしたもの。結果が一致することを乱数入力で確認する。
function refEntry(skills, gender, cr, desigCount, checked) {   // entry.html calcTotal / admin_card_check（丸め込みのみ。失格モードは null）
  const psc = parseFloat(cr.perSkillDDCap), rtc = parseFloat(cr.routineDDCap);
  const perSkillDDCap = (cr.perSkillDDCap != null && !isNaN(psc) && cr.perSkillDDCapMode !== 'disqualify') ? psc : null;
  const routineDDCap  = (cr.routineDDCap  != null && !isNaN(rtc) && cr.routineDDCapMode  !== 'disqualify') ? rtc : null;
  const seen = new Set(); let baseDD = 0, tripleCount = 0; const used = [];
  for (let i = 0; i < 10; i++) {
    const s = skills[i];
    if (!s) { used.push(0); continue; }
    const isDesignated = desigCount < 0 || (desigCount > 0 && checked.has(i));
    if (seen.has(s.key)) { used.push(0); continue; }
    seen.add(s.key);
    const isCapped = perSkillDDCap != null && round1(s.dd) > perSkillDDCap;
    const usedDD = isCapped ? perSkillDDCap : s.dd;
    used.push(usedDD);
    if (isDesignated) { baseDD += usedDD; if (s.isTriple) tripleCount++; }
  }
  const bonus = calcBonus(gender, tripleCount);
  let total = baseDD + bonus;
  if (routineDDCap != null && round1(total) > routineDDCap) total = routineDDCap;
  return { baseDD, bonus, total, used };
}
function refPanel(skills, gender, cr, desigCount, indices, validLimit) {   // judge_panel.html calcTotal（失格フラグあり・有効本数あり）
  const psc = parseFloat(cr.perSkillDDCap), rtc = parseFloat(cr.routineDDCap);
  const perSkillDDCap = (cr.perSkillDDCap != null && !isNaN(psc)) ? psc : null;
  const routineDDCap  = (cr.routineDDCap  != null && !isNaN(rtc)) ? rtc : null;
  const perSkillDQ = cr.perSkillDDCapMode === 'disqualify', routineDQ = cr.routineDDCapMode === 'disqualify';
  const seen = new Set(); let baseDD = 0, tripleCount = 0, skillOverCapDQ = false;
  for (let i = 0; i < 10; i++) {
    if (i >= validLimit) continue;
    const s = skills[i];
    if (!s) continue;
    if (seen.has(s.key)) continue;
    seen.add(s.key);
    const isDesig = desigCount < 0 || (desigCount > 0 && indices.includes(i));
    if (isDesig) {
      const overCap = perSkillDDCap != null && round1(s.dd) > perSkillDDCap;
      const isCapped = overCap && !perSkillDQ;
      if (overCap && perSkillDQ) skillOverCapDQ = true;
      baseDD += isCapped ? perSkillDDCap : s.dd;
      if (s.isTriple) tripleCount++;
    }
  }
  const bonus = calcBonus(gender, tripleCount);
  let total = baseDD + bonus;
  const over = routineDDCap != null && round1(total) > routineDDCap;
  const capped = over && !routineDQ, overDQ = over && routineDQ;
  if (capped) total = routineDDCap;
  return { baseDD, bonus, total, skillOverCapDQ, routineOverDQ: overDQ, routineCapped: capped };
}

function rng(seed) { let x = seed; return () => (x = (x * 1664525 + 1013904223) % 4294967296) / 4294967296; }

test('差分テスト: entry / admin_card_check の旧ロジックと一致（乱数 5000 件）', () => {
  const rand = rng(1);
  const pool = Array.from({ length: 12 }, (_, i) => ({ key: 'k' + i, dd: Math.round((0.1 + rand() * 2.4) * 10) / 10, isTriple: rand() < 0.3 }));
  for (let n = 0; n < 5000; n++) {
    const skills = Array.from({ length: 10 }, () => rand() < 0.15 ? null : pool[Math.floor(rand() * pool.length)]);
    const gender = ['男子', '女子', '混合', ''][Math.floor(rand() * 4)];
    const cr = {
      perSkillDDCap: rand() < 0.5 ? String(Math.round(rand() * 20) / 10 + 0.5) : undefined,
      perSkillDDCapMode: rand() < 0.4 ? 'disqualify' : 'round',
      routineDDCap: rand() < 0.5 ? Math.round(rand() * 80) / 10 + 2 : undefined,
      routineDDCapMode: rand() < 0.4 ? 'disqualify' : 'round',
      designatedDDCount: [undefined, -1, 0, 2, 4][Math.floor(rand() * 5)], qualifyingRoutines: 2, scoreMode: 'total',
    };
    const ddRule = parseDDRule(cr, 'pre1');
    const checked = new Set(Array.from({ length: 10 }, (_, i) => i).filter(() => rand() < 0.4));
    const exp = refEntry(skills, gender, cr, ddRule.designatedDDCount, checked);
    // 失格モードは丸め込まない（旧ロジックでは cap を null にしていた）→ 共通関数では isCapped が立たないので usedDD は元の値になる
    const got = calcCardDD({ skills, gender, ddRule, designatedIndices: checked });
    near(got.baseDD, exp.baseDD); near(got.bonus, exp.bonus); near(got.total, exp.total);
    got.rows.forEach((row, i) => near(row.usedDD, exp.used[i]));
  }
});

test('差分テスト: judge_panel の旧ロジックと一致（失格フラグ・有効本数込み、乱数 5000 件）', () => {
  const rand = rng(2);
  const pool = Array.from({ length: 12 }, (_, i) => ({ key: 'k' + i, dd: Math.round((0.1 + rand() * 2.4) * 10) / 10, isTriple: rand() < 0.3 }));
  for (let n = 0; n < 5000; n++) {
    const skills = Array.from({ length: 10 }, () => rand() < 0.15 ? null : pool[Math.floor(rand() * pool.length)]);
    const gender = ['男子', '女子', '混合', ''][Math.floor(rand() * 4)];
    const cr = {
      perSkillDDCap: rand() < 0.5 ? String(Math.round(rand() * 20) / 10 + 0.5) : undefined,
      perSkillDDCapMode: rand() < 0.5 ? 'disqualify' : 'round',
      routineDDCap: rand() < 0.5 ? Math.round(rand() * 80) / 10 + 2 : undefined,
      routineDDCapMode: rand() < 0.5 ? 'disqualify' : 'round',
      designatedDDCount: [undefined, -1, 0, 2, 4][Math.floor(rand() * 5)], qualifyingRoutines: 2, scoreMode: 'total',
    };
    const ddRule = parseDDRule(cr, 'pre1');
    const indices = Array.from({ length: 10 }, (_, i) => i).filter(() => rand() < 0.4);
    const validLimit = 1 + Math.floor(rand() * 10);
    const exp = refPanel(skills, gender, cr, ddRule.designatedDDCount, indices, validLimit);
    const got = calcCardDD({ skills, gender, ddRule, designatedIndices: indices, validLimit });
    near(got.baseDD, exp.baseDD); near(got.bonus, exp.bonus); near(got.total, exp.total);
    assert.equal(got.skillOverCapDQ, exp.skillOverCapDQ);
    assert.equal(got.routineOverDQ, exp.routineOverDQ);
    assert.equal(got.routineCapped, exp.routineCapped);
  }
});
