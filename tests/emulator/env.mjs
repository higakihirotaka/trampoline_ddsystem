// Firestore エミュレータを使う通しテストの共通部品。
// 実行: npm run test:emulator（firebase emulators:exec がエミュレータを起動して、終わったら止める。Java が必要）
// 本物の Firebase Web SDK（ブラウザで動いているものと同じ 10.7.1）と、本物の firestore.rules を使い、
// 認証なし（審判・会場ディスプレイ）／管理者／管理者ではないログイン、の3種類の立場で読み書きして確かめる。
import fs from 'node:fs';
import path from 'node:path';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import * as F from 'firebase/firestore';
import { ROOT } from '../helpers.mjs';

export { assertFails, assertSucceeds, F };

// プロジェクトIDはファイルごとに変える（エミュレータの中でデータが分かれる。テストファイルは同時に動くため、同じIDだと、お互いのデータを消し合う）
export async function makeEnv(projectId = 'demo-trampoline') {
  const env = await initializeTestEnvironment({
    projectId,
    firestore: { rules: fs.readFileSync(path.join(ROOT, 'firestore.rules'), 'utf8'), host: '127.0.0.1', port: 8080 },
  });
  // 管理者の登録（admins/{uid} があれば管理者）は、ルールを無効にして直接入れる
  await env.withSecurityRulesDisabled(async ctx => { await F.setDoc(F.doc(ctx.firestore(), 'admins', 'adm1'), { email: 'admin@example.com' }); });
  const admin = env.authenticatedContext('adm1').firestore();       // 管理者（CJP・操作画面）
  const anon = env.unauthenticatedContext().firestore();            // 認証なし（審判・会場ディスプレイ）
  const user = env.authenticatedContext('user1').firestore();       // ログインしているが管理者ではない
  /** ルールを無効にして、直接ドキュメントを入れる・読む */
  const seed = (fn) => env.withSecurityRulesDisabled(async ctx => { await fn(ctx.firestore()); });
  const read = async (...p) => { let d; await seed(async db => { const s = await F.getDoc(F.doc(db, ...p)); d = s.exists() ? s.data() : undefined; }); return d; };
  return { env, admin, anon, user, seed, read, F, clear: () => env.clearFirestore().then(() => env.withSecurityRulesDisabled(async ctx => { await F.setDoc(F.doc(ctx.firestore(), 'admins', 'adm1'), { email: 'admin@example.com' }); })) };
}
