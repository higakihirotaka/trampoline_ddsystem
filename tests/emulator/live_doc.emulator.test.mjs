// live_doc.js（大会ドキュメントの分割）を、本物の Firebase Web SDK・ルール・エミュレータで確かめる。
// 疑似 Firestore では確かめられない、本物の挙動（ドット区切りの項目パスと日本語の名前、サーバー時刻、削除、配列の更新、
// 監視の応答、ルール）を見る。書き込みの形は、操作画面・CJP・タイマーが実際に書くものと同じ形にしてある。
import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { makeEnv, assertSucceeds, F } from './env.mjs';
import { loadEsm } from '../helpers.mjs';

const { liveFirestore, LIVE_MARK } = await loadEsm('live_doc.js');
let t;
before(async () => { t = await makeEnv('demo-trampoline-live'); });
after(async () => { await t.env.cleanup(); });
beforeEach(async () => { await t.clear(); });

const fsOf = () => ({ doc: F.doc, getDoc: F.getDoc, setDoc: F.setDoc, updateDoc: F.updateDoc, onSnapshot: F.onSnapshot, serverTimestamp: F.serverTimestamp });
const TOUR = db => F.doc(db, 'tournaments', 'E1');
const apiFor = (db, mode) => liveFirestore(fsOf(), db, { mode: () => mode });
const seedTour = (extra = {}) => t.seed(db => F.setDoc(TOUR(db), { name: 'テスト大会', classRules: { individual: {} }, venueScreen: 'logo', titleSettings: { line1: '既存タイトル' }, ...extra }));
const liveDoc = k => t.read('tournaments', 'E1', 'live', k);
const mainDoc = () => t.read('tournaments', 'E1');
// 条件がそろうまで待つ（監視の応答用）
const until = async (fn, ms = 4000) => { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) throw new Error('timeout'); await new Promise(r => setTimeout(r, 30)); } };

test('dual（管理者）: 主に従来どおり書き、live/venue にも写す。日本語のディスプレイ名・サーバー時刻・削除・配列の更新が、本物の SDK で通る', async () => {
  await seedTour();
  const api = apiFor(t.admin, 'dual');
  // 操作画面の writeScene（ディスプレイ名の上書き）と同じ形
  await assertSucceeds(api.updateDoc(TOUR(t.admin), {
    'venueDisplays.サブ.override': { screen: 'announce', at: F.serverTimestamp() },
    venueScreenAt: F.serverTimestamp(),
    venueScreen: 'title', 'rankingCarousel.active': false,
  }));
  await assertSucceeds(api.updateDoc(TOUR(t.admin), { venueDisplayNames: F.arrayUnion('サブ', 'ロビー') }));
  await assertSucceeds(api.updateDoc(TOUR(t.admin), { 'venueDisplays.サブ.follow': false, displaySettings: { colorTheme: 'red' } }));
  const main = await mainDoc(), venue = await liveDoc('venue');
  assert.equal(main.venueScreen, 'title'); assert.equal(main.venueDisplays['サブ'].override.screen, 'announce');
  assert.deepEqual(main.venueDisplayNames, ['サブ', 'ロビー']); assert.equal(main.displaySettings.colorTheme, 'red');
  assert.equal(venue.venueScreen, 'title'); assert.equal(venue.venueDisplays['サブ'].follow, false);
  assert.deepEqual(venue.venueDisplayNames, ['サブ', 'ロビー']);
  assert.deepEqual(venue.titleSettings, { line1: '既存タイトル' });            // 初回に、主の値を写した
  assert.ok(venue[LIVE_MARK]); assert.equal(venue.displaySettings, undefined);
  // 削除（上書きを消す）
  await api.updateDoc(TOUR(t.admin), { 'venueDisplays.サブ.override': F.deleteField() });
  assert.equal((await mainDoc()).venueDisplays['サブ'].override, undefined);
  assert.equal((await liveDoc('venue')).venueDisplays['サブ'].override, undefined);
});

test('live（管理者）: 会場・審判の項目は live にだけ書く。設定は主へ。CJP と同じ setDoc(merge) の形も通る', async () => {
  await seedTour({ liveState: { A: { athleteId: 'old' } }, calculating: true });
  const api = apiFor(t.admin, 'live');
  await assertSucceeds(api.updateDoc(TOUR(t.admin), { venueScreen: 'ceremony', venueScreenAt: F.serverTimestamp(), displaySettings: { rankingRows: 10 } }));
  // CJP: 選手切り替え（liveState）と、確定（calculating など）
  await assertSucceeds(api.setDoc(TOUR(t.admin), { liveState: { A: { athleteId: 'a1', round: 'pre1', locked: false } } }, { merge: true }));
  await assertSucceeds(api.setDoc(TOUR(t.admin), { calculating: false, inquiry: false, venueScreen: 'score', venueScreenAt: F.serverTimestamp() }, { merge: true }));
  await assertSucceeds(api.setDoc(TOUR(t.admin), { liveState: { A: { locked: true } }, calculating: false }, { merge: true }));
  const main = await mainDoc(), venue = await liveDoc('venue'), judging = await liveDoc('judging');
  assert.equal(main.venueScreen, 'logo');                                      // 主の会場項目は、書かれていない（古いまま）
  assert.deepEqual(main.displaySettings, { rankingRows: 10 });
  assert.equal(venue.venueScreen, 'score'); assert.equal(venue.calculating, false); assert.ok(venue[LIVE_MARK]);
  assert.deepEqual(judging.liveState, { A: { athleteId: 'a1', round: 'pre1', locked: true } });   // 古い値に重ねてマージされた
});

test('live（認証なしの読み手）: 3つをまとめて読み、live だけの変更に追従する。消した項目は、古い主の値で復活しない', async () => {
  await seedTour({ liveState: { A: { athleteId: 'old' } }, calculatingAthleteId: 'x' });
  const writer = apiFor(t.admin, 'live');
  await writer.updateDoc(TOUR(t.admin), { venueScreen: 'title' });                    // バックフィルして live/venue を作る
  await writer.setDoc(TOUR(t.admin), { liveState: { A: { athleteId: 'new' } } }, { merge: true });
  const reader = apiFor(t.anon, 'live');
  let last; const un = reader.onSnapshot(TOUR(t.anon), s => { last = s.data(); });
  const d = await until(() => last);
  assert.equal(d.venueScreen, 'title'); assert.deepEqual(d.liveState, { A: { athleteId: 'new' } });
  assert.deepEqual(d.classRules, { individual: {} }); assert.equal(d[LIVE_MARK], undefined);
  await writer.updateDoc(TOUR(t.admin), { 'warmupSettings.timerPaused': true, 'warmupSettings.timerRemainingMs': 120000 });
  await until(() => last.warmupSettings && last.warmupSettings.timerPaused === true);
  await writer.updateDoc(TOUR(t.admin), { calculatingAthleteId: F.deleteField() });
  await until(() => !('calculatingAthleteId' in last));
  assert.equal((await mainDoc()).calculatingAthleteId, 'x');                            // 主には古い値が残っているが、読み取りには出ない
  un();
});

test('印の無い大会（live が無い）は、live モードでも、従来どおり主を読む（既存の大会が、そのまま表示される）', async () => {
  await seedTour({ liveState: { A: { athleteId: 'a1' } }, warmupSettings: { class1: 'Aクラス' } });
  const reader = apiFor(t.anon, 'live');
  let last; const un = reader.onSnapshot(TOUR(t.anon), s => { last = s.data(); });
  await until(() => last);
  assert.equal(last.venueScreen, 'logo'); assert.deepEqual(last.liveState, { A: { athleteId: 'a1' } }); assert.deepEqual(last.warmupSettings, { class1: 'Aクラス' });
  assert.equal((await reader.getTournamentMerged('E1')).venueScreen, 'logo');
  assert.equal(await reader.getTournamentMerged('NOPE'), null);
  un();
});

test('dual で書いた大会を live モードで読んでも同じ。切り替え後の live だけの書き込みも反映される（dual → live の切り替え）', async () => {
  await seedTour({ warmupSettings: { class1: 'A' } });
  const dual = apiFor(t.admin, 'dual');
  await dual.updateDoc(TOUR(t.admin), { venueScreen: 'announce', 'announceSettings.line1': 'お知らせ' });
  await dual.setDoc(TOUR(t.admin), { liveState: { A: { athleteId: 'a1' } }, calculating: true }, { merge: true });
  const before = await mainDoc();
  const live = apiFor(t.anon, 'live');
  const merged = await live.getTournamentMerged('E1');
  for (const k of Object.keys(before)) assert.deepEqual(merged[k], before[k], k);   // 切り替え前後で、読み取り結果が一致
  await apiFor(t.admin, 'live').updateDoc(TOUR(t.admin), { venueScreen: 'ceremony' });
  assert.equal((await live.getTournamentMerged('E1')).venueScreen, 'ceremony');
  assert.equal((await mainDoc()).venueScreen, 'announce');
});

test('プログラムの開始（全部）と同じ形: 入れ子の時刻・上書きの削除・タイマーの開始が、1回の書き込みで通る', async () => {
  await seedTour({ venueDisplays: { サブ: { override: { screen: 'logo', at: F.Timestamp.now() } } } });
  const api = apiFor(t.admin, 'live');
  const run = { name: '昼休み', loop: true, items: [{ screen: 'logo', durationSec: 10 }, { screen: 'announce', durationSec: 15, announce: { line1: '休憩中', line2: '', line3: '' } }] };
  await assertSucceeds(api.updateDoc(TOUR(t.admin), {
    venueProgram: { at: F.serverTimestamp(), ...run }, venueScreen: 'logo', 'rankingCarousel.active': false, venueScreenAt: F.serverTimestamp(),
    'venueDisplays.サブ.override': F.deleteField(),
    'warmupSettings.timerDefaultMs': 600000, 'warmupSettings.timerRemainingMs': 600000, 'warmupSettings.timerPaused': false,
    'warmupSettings.timerRef': F.serverTimestamp(), 'warmupSettings.timerEndMs': Date.now() + 600000, 'warmupSettings.overlayEnabled': true,
  }));
  const v = await liveDoc('venue');
  assert.equal(v.venueProgram.items.length, 2); assert.ok(v.venueProgram.at.toMillis);
  // 開始と同じ書き込みなので、時刻が一致する（プログラムが有効と判定される条件）
  assert.equal(v.venueProgram.at.toMillis(), v.venueScreenAt.toMillis());
  assert.equal(v.venueDisplays['サブ'].override, undefined);
  assert.equal(v.warmupSettings.overlayEnabled, true); assert.ok(v.warmupSettings.timerRef.toMillis);
});

test('大会の複製の読み取り（getTournamentMerged）は、live モードでも、タイトル・お知らせ文などの設定を含む', async () => {
  await seedTour();
  const api = apiFor(t.admin, 'live');
  await api.updateDoc(TOUR(t.admin), { 'titleSettings.line2': '2行目', announcePhrases: [{ line1: '休憩中です', line2: '', line3: '' }] });
  const merged = await apiFor(t.anon, 'live').getTournamentMerged('E1');
  assert.deepEqual(merged.titleSettings, { line1: '既存タイトル', line2: '2行目' });
  assert.equal(merged.announcePhrases.length, 1); assert.deepEqual(merged.classRules, { individual: {} });
});

test('認証なしでは、dual・live のどちらでも、大会ドキュメントに書けない（ルール）', async () => {
  await seedTour();
  for (const mode of ['dual', 'live']) {
    const api = apiFor(t.anon, mode);
    await assert.rejects(() => api.updateDoc(TOUR(t.anon), { venueScreen: 'x' }));
    await assert.rejects(() => api.setDoc(TOUR(t.anon), { liveState: {} }, { merge: true }));
  }
  assert.equal((await mainDoc()).venueScreen, 'logo');
});
