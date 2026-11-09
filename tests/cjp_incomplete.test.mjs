import test from 'node:test';
import assert from 'node:assert/strict';
import { extractFunction } from './helpers.mjs';

// judge_cjp.html の一覧の黄色枠（確定時に未完了）: 保存フラグが true でも、最新データが「そろっている」なら出さない
const isResultStillIncomplete = extractFunction('judge_cjp.html', 'isResultStillIncomplete');

const complete = () => ({
  dConfirmedAt: 't', tof: 10.5, hd: { total: 9.5 },
  execution: { judges: { A_E1: { confirmedAt: 't' }, A_E2: { confirmedAt: 't' } } },
});

test('すべてそろっていれば未完了ではない', () => {
  assert.equal(isResultStillIncomplete(complete()), false);
});

test('データなしは未完了とみなさない（印を新たに付けない）', () => {
  assert.equal(isResultStillIncomplete(null), false);
  assert.equal(isResultStillIncomplete(undefined), false);
});

test('D審判が未確定なら未完了', () => {
  const r = complete(); delete r.dConfirmedAt;
  assert.equal(isResultStillIncomplete(r), true);
});

test('CJPがDを手動入力して保存した場合は確定扱い', () => {
  const r = complete(); delete r.dConfirmedAt;
  r.officialDDValues = [0.5, 0.6]; r.officialTotalDD = 1.1;
  assert.equal(isResultStillIncomplete(r), false);
});

test('ToF / HD が 0 または未入力なら未完了', () => {
  for (const patch of [{ tof: 0 }, { tof: undefined }, { hd: { total: 0 } }, { hd: undefined }]) {
    assert.equal(isResultStillIncomplete({ ...complete(), ...patch }), true, JSON.stringify(patch));
  }
});

test('確定していないE審判がいれば未完了', () => {
  const r = complete(); r.execution.judges.A_E2.confirmedAt = null;
  assert.equal(isResultStillIncomplete(r), true);
});
