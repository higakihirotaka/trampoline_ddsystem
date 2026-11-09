// 会場ディスプレイが書く接続状況の項目 と firestore.rules の validPresence() の照合。
// 足し忘れ・名前の食い違いがあると、本番で接続状況の書き込みが拒否される（画面の表示には影響しないが、操作画面に出なくなる）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { findPresenceWrites, readPresenceKeys } from './judge_writes.mjs';

test('display.html の接続状況の書き込みは1か所で、項目が validPresence() に含まれる', () => {
  const allowed = new Set(readPresenceKeys());
  const writes = findPresenceWrites('display.html');
  assert.equal(writes.length, 1, '接続状況の書き込み箇所が1つではありません（解析の取りこぼし、または追加・削除）');
  const keys = writes[0].keys;
  assert.deepEqual(keys.filter(k => !allowed.has(k)), [],
    `display.html:${writes[0].line} が validPresence() にない項目を書きます。firestore.rules に足して、RULES_TEST=1 npm test のあと、ルールをデプロイしてください`);
  for (const must of ['name', 'instance', 'lastSeen']) assert.ok(keys.includes(must), `必須の項目 ${must} を書いていません`);
});

test('validPresence() の許可項目を読み取れる', () => {
  const keys = readPresenceKeys();
  assert.ok(keys.includes('name') && keys.includes('instance') && keys.includes('lastSeen'));
  assert.ok(!keys.includes('published'));
});
