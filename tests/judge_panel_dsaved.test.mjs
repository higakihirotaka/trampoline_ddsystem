import test from 'node:test';
import assert from 'node:assert/strict';
import { extractFunction } from './helpers.mjs';

// judge_panel.html: D審判の入力画面が「D確定済み（修正するボタン・入力ロック）」になる条件
const hasDData = extractFunction('judge_panel.html', 'hasDData');

test('結果ドキュメントが無い／空なら D確定済みではない', () => {
  assert.equal(hasDData(undefined), false);
  assert.equal(hasDData(null), false);
  assert.equal(hasDData({}), false);
});

test('E審判・TOF/HD審判が先に書き込んだだけ（Dのデータなし）は D確定済みではない', () => {
  const eOnly = { eventId: 'E', athleteId: 'A', round: 'pre1', execution: { judges: { A_E1: { totalDeduction: 1, confirmedAt: 't' } } } };
  assert.equal(hasDData(eOnly), false);
  assert.equal(hasDData({ ...eOnly, tofByPanel: { A: 10.2 }, hdByPanel: { A: 9 }, updatedAt: 't' }), false);
  assert.equal(hasDData({ ...eOnly, validCount: 7 }), false);          // CJPが有効本数だけ設定した場合
  assert.equal(hasDData({ ...eOnly, officialSkills: [] }), false);      // 空配列は入力なし
});

test('D審判が確定した・入力した・CJPが手動確定した場合は D確定済み', () => {
  assert.equal(hasDData({ dConfirmedAt: 't' }), true);
  assert.equal(hasDData({ officialTotalDD: 5.2 }), true);
  assert.equal(hasDData({ officialTotalDD: 0 }), true);                  // 合計0でも入力あり（紙運用）
  assert.equal(hasDData({ officialSkills: ['a'] }), true);               // D確定を解除して修正中
  assert.equal(hasDData({ officialDDValues: [0.5] }), true);
});
