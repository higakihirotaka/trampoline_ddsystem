// ログインなしの審判画面が results に書く項目 と firestore.rules の judgeKeys() の照合。
// 画面の変更で新しい項目を書くようになったのに judgeKeys() に足し忘れると、本番でその審判の保存が 403 で失敗する。
// それを npm test の段階で検出する（通信は不要）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readJudgeKeys, findResultsWrites, listResultsWriterPages, objectKeys } from './judge_writes.mjs';

// ログインなしで results に書き込む審判画面と、そこで見つかるはずの書き込み箇所の数（解析の取りこぼし検出用）
const JUDGE_PAGES = { 'judge_e.html': 3, 'judge_tof_hd.html': 1, 'judge_panel.html': 3 };

test('解析の動作確認: オブジェクトのキー抽出', () => {
  assert.deepEqual(objectKeys('{ a, b: 1, "c": [1,2], \'d\': { x: 1, y: 2 }, e: f(1, 2), g: `${h}` }'), ['a', 'b', 'c', 'd', 'e', 'g']);
  assert.deepEqual(objectKeys('{ ...rest, [k]: 1 }'), ['<unknown>', '<unknown>']);
});

test('firestore.rules の judgeKeys() を読み取れる', () => {
  const keys = readJudgeKeys();
  assert.ok(keys.length >= 8, `judgeKeys が少なすぎます: ${keys}`);
  assert.ok(keys.includes('execution') && keys.includes('tofByPanel'));
  assert.ok(!keys.includes('published') && !keys.includes('tof'), '確定フィールドが judgeKeys に入っています');
});

for (const [file, expected] of Object.entries(JUDGE_PAGES)) {
  test(`${file}: results への書き込み項目がすべて judgeKeys() に含まれる`, () => {
    const allowed = new Set(readJudgeKeys());
    const writes = findResultsWrites(file);
    assert.equal(writes.length, expected, `書き込み箇所の数が想定(${expected})と違います（解析の取りこぼし、または書き込みの追加・削除）: ${writes.map(w => 'L' + w.line).join(',')}`);
    for (const w of writes) {
      const bad = w.keys.filter(k => !allowed.has(k));
      assert.deepEqual(bad, [],
        `${file}:${w.line} が judgeKeys() にない項目を書きます: ${bad.join(', ')}\n` +
        `→ 審判がログインなしで書いてよい項目なら firestore.rules の judgeKeys() に追加（その後 RULES_TEST=1 npm test と rules のデプロイ）。` +
        `書いてはいけない項目（確定値など）なら、管理者ログインが必要な画面で書くようにしてください。`);
    }
  });
}

test('管理者ログインなしで results に書き込む画面は、上の審判画面だけ（新しい画面が増えたら検出）', () => {
  const unauth = listResultsWriterPages().filter(p => !p.admin).map(p => p.file).sort();
  assert.deepEqual(unauth, Object.keys(JUDGE_PAGES).sort(),
    'ログインなしで results に書き込む画面が変わりました。この画面は firestore.rules の judgeKeys() の範囲でしか書けません。' +
    'JUDGE_PAGES（このテスト）に追加して、書き込み項目を確認してください。');
});
