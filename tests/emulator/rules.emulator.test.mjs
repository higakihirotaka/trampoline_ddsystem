// firestore.rules を、本物の SDK・エミュレータで確かめる。
// （RULES_TEST=1 の試験APIでは作れなかった「サーバー時刻を使う接続状況の書き込み」や、実際のログイン状態も含む）
import test, { before, after, beforeEach } from 'node:test';
import { makeEnv, assertFails, assertSucceeds, F } from './env.mjs';

let t;
before(async () => { t = await makeEnv('demo-trampoline-rules'); });
after(async () => { await t.env.cleanup(); });
beforeEach(async () => { await t.clear(); });

const RES = (db) => F.doc(db, 'results', 'E1_A1_pre1');
const base = { eventId: 'E1', athleteId: 'A1', round: 'pre1', execution: { judges: { A_E1: { totalDeduction: 1, confirmedAt: 't' } } }, officialTotalDD: 5.5, dConfirmedAt: 't', tof: 10.5, hd: { total: 9.5 } };

test('審判（認証なし）: 公開前は、E・TOF・D の入力を書ける。確定値（tof・dns・published）は書けない', async () => {
  await t.seed(db => F.setDoc(RES(db), base));
  await assertSucceeds(F.setDoc(RES(t.anon), { execution: { judges: { A_E1: { totalDeduction: 2 } } } }, { merge: true }));
  await assertSucceeds(F.setDoc(RES(t.anon), { tofByPanel: { A: 10.2 }, updatedAt: F.serverTimestamp() }, { merge: true }));
  await assertSucceeds(F.setDoc(RES(t.anon), { officialSkills: ['a'], validCount: 10, officialTotalDD: 6.1, dConfirmedAt: F.serverTimestamp(), revisionCount: F.increment(1) }, { merge: true }));
  await assertFails(F.setDoc(RES(t.anon), { tof: 99 }, { merge: true }));
  await assertFails(F.setDoc(RES(t.anon), { dns: true }, { merge: true }));
  await assertFails(F.setDoc(RES(t.anon), { published: true }, { merge: true }));
  await assertFails(F.deleteDoc(RES(t.anon)));
});

test('審判（認証なし）: 公開後は、Eの確定（execution）だけ書ける', async () => {
  await t.seed(db => F.setDoc(RES(db), { ...base, published: true }));
  await assertSucceeds(F.setDoc(RES(t.anon), { execution: { judges: { A_E1: { confirmedAt: F.serverTimestamp() } } } }, { merge: true }));
  await assertFails(F.setDoc(RES(t.anon), { tofByPanel: { A: 1 } }, { merge: true }));
  await assertFails(F.setDoc(RES(t.anon), { officialTotalDD: 99 }, { merge: true }));
  await assertFails(F.setDoc(RES(t.anon), { dConfirmedAt: F.deleteField() }, { merge: true }));
});

test('管理者は results を何でも書ける。管理者ではないログインは、審判の入力も書けない（従来どおり）', async () => {
  await t.seed(db => F.setDoc(RES(db), { ...base, published: true }));
  await assertSucceeds(F.setDoc(RES(t.admin), { tof: 11, published: false }, { merge: true }));
  await assertSucceeds(F.deleteDoc(RES(t.admin)));
  await assertFails(F.setDoc(RES(t.user), { execution: { judges: {} } }, { merge: true }));
});

test('大会ドキュメント: 認証なしでは書けない。読める。管理者は書ける', async () => {
  const ref = db => F.doc(db, 'tournaments', 'E1');
  await t.seed(db => F.setDoc(ref(db), { name: 'T' }));
  await assertSucceeds(F.getDoc(ref(t.anon)));
  await assertFails(F.updateDoc(ref(t.anon), { venueScreen: 'logo' }));
  await assertSucceeds(F.updateDoc(ref(t.admin), { venueScreen: 'logo' }));
});

test('live ドキュメント（live/venue・live/judging）: 認証なしは読めるが書けない。管理者は書ける', async () => {
  const ref = (db, k) => F.doc(db, 'tournaments', 'E1', 'live', k);
  await t.seed(db => F.setDoc(ref(db, 'venue'), { venueScreen: 'logo' }));
  await assertSucceeds(F.getDoc(ref(t.anon, 'venue')));
  await assertFails(F.setDoc(ref(t.anon, 'venue'), { venueScreen: 'x' }, { merge: true }));
  await assertFails(F.setDoc(ref(t.anon, 'judging'), { liveState: {} }, { merge: true }));
  await assertSucceeds(F.setDoc(ref(t.admin, 'venue'), { venueScreen: 'title' }, { merge: true }));
  await assertSucceeds(F.setDoc(ref(t.admin, 'judging'), { liveState: { A: { athleteId: 'a' } } }, { merge: true }));
});

// ---- 会場ディスプレイの接続状況（validPresence） ----
const PRES = (db, id) => F.doc(db, 'tournaments', 'E1', 'venuePresence', id);
const presence = (o = {}) => ({ name: 'メイン', instance: 'abc123', screen: 'logo', follow: true, w: 1920, h: 1080, lastSeen: F.serverTimestamp(), ...o });

test('接続状況: 会場ディスプレイ（認証なし）が、サーバー時刻つきで書ける（作成・更新・日本語の名前）', async () => {
  await assertSucceeds(F.setDoc(PRES(t.anon, 'メイン__abc123'), presence()));
  await assertSucceeds(F.setDoc(PRES(t.anon, 'メイン__abc123'), presence({ screen: 'title' })));
  await assertSucceeds(F.setDoc(PRES(t.anon, 'Sub__zz'), presence({ name: 'Sub', instance: 'zz' })));
  await assertSucceeds(F.getDoc(PRES(t.anon, 'メイン__abc123')));
});

test('接続状況: 余計な項目・IDのずれ・長すぎる値・型違い・時刻の偽装・必須項目なし、は拒否される', async () => {
  await assertFails(F.setDoc(PRES(t.anon, 'メイン__abc123'), presence({ extra: 1 })));
  await assertFails(F.setDoc(PRES(t.anon, 'Other__abc123'), presence()));
  await assertFails(F.setDoc(PRES(t.anon, 'メイン__zzz'), presence()));
  await assertFails(F.setDoc(PRES(t.anon, 'メイン__abc123'), presence({ screen: 's'.repeat(31) })));
  await assertFails(F.setDoc(PRES(t.anon, 'メイン__abc123'), presence({ w: 'wide' })));
  await assertFails(F.setDoc(PRES(t.anon, 'メイン__abc123'), presence({ w: 99999 })));
  await assertFails(F.setDoc(PRES(t.anon, 'メイン__abc123'), presence({ lastSeen: F.Timestamp.fromDate(new Date('2030-01-01')) })));
  await assertFails(F.setDoc(PRES(t.anon, 'メイン__abc123'), { name: 'メイン', lastSeen: F.serverTimestamp() }));
  await assertFails(F.setDoc(PRES(t.anon, 'N'.repeat(21) + '__abc123'), presence({ name: 'N'.repeat(21) })));
});

test('接続状況: 認証なしでは削除できず、管理者は削除できる。管理者ではないログインは書けない', async () => {
  await t.seed(db => F.setDoc(PRES(db, 'メイン__abc123'), { name: 'メイン', instance: 'abc123', lastSeen: F.Timestamp.now() }));
  await assertFails(F.deleteDoc(PRES(t.anon, 'メイン__abc123')));
  await assertFails(F.setDoc(PRES(t.user, 'メイン__abc123'), presence()));
  await assertSucceeds(F.deleteDoc(PRES(t.admin, 'メイン__abc123')));
});

test('選手の申告（athletes）: 認証なしは、提出ステータスとふりがなだけ更新できる', async () => {
  const ref = db => F.doc(db, 'tournaments', 'E1', 'athletes', 'A1');
  await t.seed(db => F.setDoc(ref(db), { name1: '選手', submissions: {}, kana1: '' }));
  await assertSucceeds(F.updateDoc(ref(t.anon), { kana1: 'せんしゅ', submissions: { pre1: true } }));
  await assertFails(F.updateDoc(ref(t.anon), { name1: '書き換え' }));
});
