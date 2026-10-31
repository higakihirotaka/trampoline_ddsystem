import test from 'node:test';
import assert from 'node:assert/strict';
import { loadEsm } from './helpers.mjs';

const L = await loadEsm('live_doc.js');
const { LIVE_MARK, DEFAULT_MODE, groupOf, partitionData, mergeFor, liveFirestore, splitMode } = L;

// ---------- メモリ上の疑似 Firestore（updateDoc のドット区切り・setDoc の merge・削除・監視の最小限） ----------
function makeFake() {
  const store = new Map(), listeners = new Map();
  let tsN = 0;
  const DEL = { __del: true };
  const isPlain = v => v && typeof v === 'object' && !Array.isArray(v) && !('__ts' in v) && !('__del' in v);
  const clone = x => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));
  const strip = o => { const r = {}; for (const [k, v] of Object.entries(o)) { if (v === DEL) continue; r[k] = isPlain(v) ? strip(v) : v; } return r; };
  function deepMerge(t, s) {
    for (const [k, v] of Object.entries(s)) {
      if (v === DEL) delete t[k];
      else if (isPlain(v)) { if (!isPlain(t[k])) t[k] = {}; deepMerge(t[k], v); }
      else t[k] = v;
    }
  }
  const snap = path => ({ id: path.split('/').pop(), exists: () => store.has(path), data: () => clone(store.get(path)), metadata: {} });
  const notify = path => (listeners.get(path) || []).forEach(cb => cb(snap(path)));
  const fs = {
    doc: (db, ...p) => ({ path: p.join('/'), id: p[p.length - 1] }),
    serverTimestamp: () => ({ __ts: ++tsN }),
    deleteField: () => DEL,
    async getDoc(ref) { return snap(ref.path); },
    async setDoc(ref, data, opts) {
      if (opts && opts.merge) { const cur = store.get(ref.path) || {}; deepMerge(cur, data); store.set(ref.path, cur); }
      else store.set(ref.path, strip(data));
      notify(ref.path);
    },
    async updateDoc(ref, data) {
      if (!store.has(ref.path)) throw new Error('NOT_FOUND ' + ref.path);
      const cur = store.get(ref.path);
      for (const [k, v] of Object.entries(data)) {
        const parts = k.split('.'); let o = cur;
        for (let i = 0; i < parts.length - 1; i++) { if (!isPlain(o[parts[i]])) o[parts[i]] = {}; o = o[parts[i]]; }
        const last = parts[parts.length - 1];
        if (v === DEL) delete o[last]; else o[last] = v;
      }
      notify(ref.path);
    },
    onSnapshot(ref, cb) {
      const arr = listeners.get(ref.path) || []; arr.push(cb); listeners.set(ref.path, arr);
      Promise.resolve().then(() => cb(snap(ref.path)));
      return () => { listeners.set(ref.path, (listeners.get(ref.path) || []).filter(x => x !== cb)); };
    },
  };
  return { fs, store, listeners, DEL, listenerCount: path => (listeners.get(path) || []).length };
}
const TOUR = { path: 'tournaments/E1', id: 'E1' };
const setup = (mode, initial) => {
  const f = makeFake();
  if (initial) f.store.set('tournaments/E1', JSON.parse(JSON.stringify(initial)));
  const m = { mode };
  const api = liveFirestore(f.fs, {}, { mode: () => m.mode });
  return { ...f, api, m };
};
const wait = () => new Promise(r => setTimeout(r, 5));

// ---------- 純粋な部分 ----------
test('既定のモードは live（大会ドキュメントを分割して使う）', () => {
  assert.equal(DEFAULT_MODE, 'live');
  assert.equal(splitMode(), 'live');
});

test('groupOf / partitionData: 会場・審判・設定に仕分ける（ドット区切りは最上位の名前で）', () => {
  assert.equal(groupOf('venueScreen'), 'venue');
  assert.equal(groupOf('warmupSettings.timerRef'), 'venue');
  assert.equal(groupOf('venueDisplays.サブ.override'), 'venue');
  assert.equal(groupOf('calculating'), 'venue');
  assert.equal(groupOf('liveState'), 'judging');
  assert.equal(groupOf('classRules'), 'main');
  assert.equal(groupOf('displaySettings'), 'main');
  const p = partitionData({ 'warmupSettings.timerRef': 1, calculating: false, liveState: { A: {} }, classRules: {}, name: 'x' });
  assert.deepEqual(Object.keys(p.venue).sort(), ['calculating', 'warmupSettings.timerRef']);
  assert.deepEqual(Object.keys(p.judging), ['liveState']);
  assert.deepEqual(Object.keys(p.main).sort(), ['classRules', 'name']);
});

test('mergeFor: 印のある live だけを信用し、その項目は主の値を捨てる。印が無ければ主のまま', () => {
  const main = { name: 'x', classRules: { a: 1 }, venueScreen: 'old', warmupSettings: { class1: 'A', timerRef: 'old' }, liveState: { A: { athleteId: 'old' } } };
  const venue = { [LIVE_MARK]: 1, venueScreen: 'new', warmupSettings: { class1: 'A' } };
  const m = mergeFor(main, venue, null);
  assert.equal(m.venueScreen, 'new');
  assert.deepEqual(m.warmupSettings, { class1: 'A' });          // 主の timerRef は復活しない
  assert.equal(m.name, 'x'); assert.deepEqual(m.liveState, { A: { athleteId: 'old' } });   // 審判の live が無いので主のまま
  assert.equal(m[LIVE_MARK], undefined);
  assert.deepEqual(mergeFor(main, { venueScreen: 'new' }, null).venueScreen, 'old');   // 印が無い live は無視
  assert.deepEqual(mergeFor(main, null, { [LIVE_MARK]: 1, liveState: { A: { athleteId: 'new' } } }).liveState, { A: { athleteId: 'new' } });
});

// ---------- dual: 従来どおり主に書き、live に写す ----------
test('dual: updateDoc は、従来どおり主にすべて書き、会場・審判の項目を live にも写す。初回に、主の現在値を live に写して印を付ける', async () => {
  const t = setup('dual', { name: 'T', classRules: { a: 1 }, titleSettings: { line1: '既存' }, venueScreen: 'logo' });
  await t.api.updateDoc(TOUR, { venueScreen: 'title', 'warmupSettings.timerPaused': true, displaySettings: { x: 1 } });
  const main = t.store.get('tournaments/E1'), venue = t.store.get('tournaments/E1/live/venue');
  assert.equal(main.venueScreen, 'title'); assert.equal(main.warmupSettings.timerPaused, true); assert.deepEqual(main.displaySettings, { x: 1 });   // 従来どおり
  assert.equal(venue.venueScreen, 'title'); assert.equal(venue.warmupSettings.timerPaused, true);
  assert.deepEqual(venue.titleSettings, { line1: '既存' });       // 初回に写した（書き込んでいない項目も、そろう）
  assert.ok(venue[LIVE_MARK]);
  assert.equal(venue.displaySettings, undefined); assert.equal(venue.classRules, undefined);
  assert.equal(t.store.has('tournaments/E1/live/judging'), false);   // 審判の項目を書いていないので作らない
});

test('dual: setDoc(merge) の liveState は、主と live/judging の両方に入る', async () => {
  const t = setup('dual', { name: 'T', liveState: { B: { athleteId: 'b' } } });
  await t.api.setDoc(TOUR, { liveState: { A: { athleteId: 'a', locked: false } }, calculating: false }, { merge: true });
  assert.deepEqual(t.store.get('tournaments/E1').liveState, { B: { athleteId: 'b' }, A: { athleteId: 'a', locked: false } });
  assert.deepEqual(t.store.get('tournaments/E1/live/judging').liveState, { B: { athleteId: 'b' }, A: { athleteId: 'a', locked: false } });
  assert.equal(t.store.get('tournaments/E1/live/venue').calculating, false);
});

test('dual: live への写しが失敗しても、従来の書き込みは成功して、例外にならない', async () => {
  const t = setup('dual', { name: 'T' });
  const orig = t.fs.setDoc; let n = 0;
  t.fs.setDoc = async (ref, ...a) => { if (ref.path.includes('/live/')) { n++; throw new Error('permission-denied'); } return orig(ref, ...a); };
  await t.api.updateDoc(TOUR, { venueScreen: 'logo' });
  assert.equal(t.store.get('tournaments/E1').venueScreen, 'logo');
  assert.ok(n >= 1);
});

test('dual: 大会ドキュメント以外の参照・オブジェクト以外の引数は、そのまま通す', async () => {
  const t = setup('dual', { name: 'T' });
  t.store.set('results/R1', { a: 1 });
  await t.api.updateDoc({ path: 'results/R1' }, { venueScreen: 'x' });
  assert.equal(t.store.get('results/R1').venueScreen, 'x');
  assert.equal(t.store.has('tournaments/E1/live/venue'), false);
  await t.api.setDoc({ path: 'results/R2' }, { warmupSettings: 1 });
  assert.equal(t.store.get('results/R2').warmupSettings, 1);
});

test('dual: onSnapshot は、従来どおり主だけを監視する（live は監視しない）', async () => {
  const t = setup('dual', { name: 'T', venueScreen: 'logo' });
  const got = [];
  const un = t.api.onSnapshot(TOUR, s => got.push(s.data().venueScreen));
  await wait();
  assert.deepEqual(got, ['logo']);
  assert.equal(t.listenerCount('tournaments/E1'), 1);
  assert.equal(t.listenerCount('tournaments/E1/live/venue'), 0);
  assert.equal(t.listenerCount('tournaments/E1/live/judging'), 0);
  un();
  assert.equal(t.listenerCount('tournaments/E1'), 0);
});

// ---------- live: live にだけ書き、3つをまとめて読む ----------
test('live: 会場・審判の項目は live にだけ、設定は主に書く。初回に、主の値を live に写してから書く', async () => {
  const t = setup('live', { name: 'T', classRules: { a: 1 }, venueScreen: 'logo', warmupSettings: { class1: 'A', timerRemainingMs: 5 }, liveState: { A: { athleteId: 'a' } } });
  await t.api.updateDoc(TOUR, { venueScreen: 'title', 'warmupSettings.timerPaused': true, displaySettings: { x: 1 } });
  const main = t.store.get('tournaments/E1'), venue = t.store.get('tournaments/E1/live/venue');
  assert.equal(main.venueScreen, 'logo');                       // 主の会場項目は書かない（古いまま）
  assert.equal(main.warmupSettings.timerPaused, undefined);
  assert.deepEqual(main.displaySettings, { x: 1 });             // 設定は主へ
  assert.equal(venue.venueScreen, 'title');
  assert.deepEqual(venue.warmupSettings, { class1: 'A', timerRemainingMs: 5, timerPaused: true });   // 写した値に重ねて書いた
  assert.ok(venue[LIVE_MARK]);
});

test('live: setDoc(merge) は、liveState → live/judging、calculating → live/venue（同時に書く）', async () => {
  const t = setup('live', { name: 'T', liveState: { B: { athleteId: 'b' } }, calculating: true });
  await t.api.setDoc(TOUR, { liveState: { A: { locked: true } }, calculating: false }, { merge: true });
  assert.deepEqual(t.store.get('tournaments/E1/live/judging').liveState, { B: { athleteId: 'b' }, A: { locked: true } });
  assert.equal(t.store.get('tournaments/E1/live/venue').calculating, false);
  assert.equal(t.store.get('tournaments/E1').calculating, true);   // 主は触らない
});

test('live: onSnapshot は、3つをまとめて従来と同じ形で返し、どれかが変わると呼ぶ。最初は3つ揃ってから', async () => {
  const t = setup('live', { name: 'T', classRules: { a: 1 }, venueScreen: 'logo', liveState: { A: { athleteId: 'old' } } });
  await t.api.updateDoc(TOUR, { venueScreen: 'title' });                 // バックフィル込みで live/venue を作る
  await t.api.setDoc(TOUR, { liveState: { A: { athleteId: 'new' } } }, { merge: true });
  const seen = [];
  const un = t.api.onSnapshot(TOUR, s => seen.push({ exists: s.exists(), d: s.data() }));
  await wait();
  assert.equal(seen.length, 1);                                          // 3つ揃った後に1回
  assert.equal(seen[0].d.venueScreen, 'title'); assert.deepEqual(seen[0].d.liveState, { A: { athleteId: 'new' } });
  assert.deepEqual(seen[0].d.classRules, { a: 1 }); assert.equal(seen[0].d[LIVE_MARK], undefined);
  await t.api.updateDoc(TOUR, { 'warmupSettings.timerPaused': false });  // 会場の変更 → 呼ばれる
  await t.api.updateDoc(TOUR, { displaySettings: { y: 2 } });            // 設定の変更 → 呼ばれる
  assert.equal(seen.length, 3);
  assert.equal(seen[1].d.warmupSettings.timerPaused, false); assert.deepEqual(seen[2].d.displaySettings, { y: 2 });
  un();
  assert.equal(t.listenerCount('tournaments/E1/live/venue'), 0);
});

test('live: live で消した項目は、古い主の値で復活しない', async () => {
  const t = setup('live', { name: 'T', venueDisplays: { サブ: { override: { screen: 'logo' }, follow: false } }, rankingCarousel: { active: true } });
  await t.api.updateDoc(TOUR, { 'venueDisplays.サブ.override': t.DEL });
  let last;
  const un = t.api.onSnapshot(TOUR, s => { last = s.data(); }); await wait();
  assert.equal(last.venueDisplays.サブ.override, undefined);
  assert.equal(last.venueDisplays.サブ.follow, false);
  assert.deepEqual(last.rankingCarousel, { active: true });              // 写された値
  un();
});

test('live: 印の無い大会（live が無い）は、従来どおり主の値を読む', async () => {
  const t = setup('live', { name: 'T', venueScreen: 'logo', liveState: { A: {} } });
  let d; const un = t.api.onSnapshot(TOUR, s => { d = s.data(); }); await wait();
  assert.equal(d.venueScreen, 'logo'); assert.deepEqual(d.liveState, { A: {} });
  un();
  assert.equal(await t.api.getTournamentMerged('E1').then(x => x.venueScreen), 'logo');
  assert.equal(await t.api.getTournamentMerged('NOPE'), null);
});

test('dual で書いた大会を、live モードで読んでも、同じ内容（切り替えで画面が変わらない）', async () => {
  const t = setup('dual', { name: 'T', classRules: { a: 1 }, venueScreen: 'logo', titleSettings: { line1: 'タイトル' } });
  await t.api.updateDoc(TOUR, { venueScreen: 'announce', 'announceSettings.line1': 'お知らせ' });
  await t.api.setDoc(TOUR, { liveState: { A: { athleteId: 'a' } }, calculating: true }, { merge: true });
  const mainData = t.store.get('tournaments/E1');
  t.m.mode = 'live';
  const merged = await t.api.getTournamentMerged('E1');
  assert.deepEqual(merged, JSON.parse(JSON.stringify(mainData)));         // 切り替え前後で、読み取り結果が一致
});

test('dual → live の切り替え後に、live だけへ書いた変更が、live モードの読み取りに反映される', async () => {
  const t = setup('dual', { name: 'T', venueScreen: 'logo', warmupSettings: { class1: 'A' } });
  await t.api.updateDoc(TOUR, { venueScreen: 'title' });
  t.m.mode = 'live';
  await t.api.updateDoc(TOUR, { venueScreen: 'ceremony', 'warmupSettings.timerPaused': true });
  const merged = await t.api.getTournamentMerged('E1');
  assert.equal(merged.venueScreen, 'ceremony');
  assert.deepEqual(merged.warmupSettings, { class1: 'A', timerPaused: true });
  assert.equal(t.store.get('tournaments/E1').venueScreen, 'title');       // 主は、切り替え前のまま
});

test('live: 最上位の項目を live で削除しても、古い主の値で復活しない', async () => {
  const t = setup('live', { name: 'T', calculating: true, calculatingAthleteId: 'x', inquiryAthleteId: 'y' });
  await t.api.updateDoc(TOUR, { calculatingAthleteId: t.DEL });
  let d; const un = t.api.onSnapshot(TOUR, s => { d = s.data(); }); await wait();
  assert.equal('calculatingAthleteId' in d, false);                       // 主には古い値が残っているが、読み取りには出ない
  assert.equal(d.inquiryAthleteId, 'y'); assert.equal(d.calculating, true);
  assert.equal(t.store.get('tournaments/E1').calculatingAthleteId, 'x');
  un();
});
