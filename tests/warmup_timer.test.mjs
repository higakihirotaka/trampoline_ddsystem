import test from 'node:test';
import assert from 'node:assert/strict';
import { loadEsm } from './helpers.mjs';

const m = await loadEsm('warmup_timer.js');
const { calcWarmupRem } = m;

const ts = ms => ({ toMillis: () => ms });
const T0 = 1_000_000;
const w = (o) => ({ timerPaused: false, timerRef: ts(T0), timerRemainingMs: 10000, ...o });
const r = (o) => w({ timerRepeat: true, timerDefaultMs: 5000, ...o });   // 1周 5秒 + 待ち1.5秒

test('停止中は保存された残り時間をそのまま返す', () => {
  assert.deepEqual(calcWarmupRem({ timerPaused: true, timerRemainingMs: 7000 }, T0), { rem: 7000, running: false });
});

test('稼働中: 開始時の残りから経過時間を引く', () => {
  assert.deepEqual(calcWarmupRem(w(), T0), { rem: 10000, running: true, nextMs: 1000 });
  assert.deepEqual(calcWarmupRem(w(), T0 + 2300), { rem: 7700, running: true, nextMs: 700 });
  assert.deepEqual(calcWarmupRem(w(), T0 + 9000), { rem: 1000, running: true, nextMs: 1000 });
});

test('0になったら終了（繰り返しなし）。書き戻しがなくても、古い値で残り数秒が出ない', () => {
  assert.deepEqual(calcWarmupRem(w(), T0 + 10000), { rem: 0, running: false });
  assert.deepEqual(calcWarmupRem(w(), T0 + 99999), { rem: 0, running: false });
});

test('端末の時計が先行して経過が負になっても、残り時間は最大でも開始時の値', () => {
  assert.deepEqual(calcWarmupRem(w(), T0 - 500), { rem: 10000, running: true, nextMs: 1000 });
});

test('繰り返し: 1周目 → 1.5秒待ち → 2周目 → 3周目', () => {
  assert.deepEqual(calcWarmupRem(r(), T0 + 4000), { rem: 6000, running: true, nextMs: 1000 });
  assert.deepEqual(calcWarmupRem(r(), T0 + 10500), { rem: 0, running: true, nextMs: 1000 });          // 待ち時間
  assert.deepEqual(calcWarmupRem(r(), T0 + 11499), { rem: 0, running: true, nextMs: 1 });
  assert.deepEqual(calcWarmupRem(r(), T0 + 11500), { rem: 5000, running: true, nextMs: 1000 });       // 2周目開始
  assert.deepEqual(calcWarmupRem(r(), T0 + 13700), { rem: 2800, running: true, nextMs: 800 });
  assert.deepEqual(calcWarmupRem(r(), T0 + 11500 + 4999), { rem: 1, running: true, nextMs: 1 });
  assert.deepEqual(calcWarmupRem(r(), T0 + 11500 + 5000 + 1500), { rem: 5000, running: true, nextMs: 1000 });   // 3周目開始
});

test('繰り返し: 何周しても同じ位相で計算できる', () => {
  assert.deepEqual(calcWarmupRem(r(), T0 + 10000 + 6500 * 100 + 1500 + 1000), { rem: 4000, running: true, nextMs: 1000 });
});

test('繰り返し: timerDefaultMs が無い場合は5分', () => {
  const x = calcWarmupRem(r({ timerDefaultMs: undefined }), T0 + 10000 + 1500);
  assert.equal(x.rem, 5 * 60 * 1000);
});

test('timerRef が未確定（書き込んだ端末の直後）は、その端末の時計の timerEndMs で暫定表示', () => {
  const w0 = { timerPaused: false, timerEndMs: 5000, timerRemainingMs: 9000 };
  assert.deepEqual(calcWarmupRem(w0, 0, 2500), { rem: 2500, running: true, nextMs: 500 });
  assert.deepEqual(calcWarmupRem(w0, 0, 6000), { rem: 0, running: false });
});

test('空・null', () => {
  assert.deepEqual(calcWarmupRem({}, 0), { rem: 0, running: false });
  assert.deepEqual(calcWarmupRem(null, 0), { rem: 0, running: false });
});

test('nextMs の後に再計算すると、表示の秒がちょうど1つ進む（更新が秒の切り替わりに合う）', () => {
  for (const cfg of [w(), r()]) {
    for (let el = 0; el < 9800; el += 137) {
      const a = calcWarmupRem(cfg, T0 + el);
      if (!a.running || a.rem === 0) continue;
      const b = calcWarmupRem(cfg, T0 + el + a.nextMs + 5);
      assert.equal(Math.ceil(b.rem / 1000), Math.ceil(a.rem / 1000) - 1, `el=${el}`);
    }
  }
});

test('サーバー時刻の同期: Dateヘッダの秒の切り替わりから、端末とサーバーの差を誤差150ms未満で求める', async () => {
  const skew = 1234;                    // サーバーの時計は端末より 1.234 秒進んでいる
  let now = 5_000_000;
  const saved = { now: Date.now, st: globalThis.setTimeout, fetch: globalThis.fetch, loc: globalThis.location };
  Date.now = () => now;
  globalThis.location = { pathname: '/display.html' };
  globalThis.fetch = async () => {
    now += 20;                          // 往路
    const serverMs = now + skew;
    now += 20;                          // 復路
    return { headers: { get: () => new Date(Math.floor(serverMs / 1000) * 1000).toUTCString() } };
  };
  globalThis.setTimeout = (fn, ms) => { now += ms; return saved.st(fn, 0); };
  try {
    await m.syncServerClock();
    assert.ok(Math.abs(m.getServerOffset() - skew) < 150, `offset=${m.getServerOffset()}`);
  } finally {
    Date.now = saved.now; globalThis.setTimeout = saved.st; globalThis.fetch = saved.fetch; globalThis.location = saved.loc;
  }
});

// ---- 重ね表示（オーバーレイ） ----
const { overlayConfig, overlayVisible } = m;
const RUN = { rem: 5000, running: true };

test('overlayConfig: 既定は出さない・バッジ・右上・等倍・スコア画面には出さない', () => {
  assert.deepEqual(overlayConfig(undefined), { enabled: false, style: 'badge', position: 'tr', scale: 1, onScore: false });
  assert.deepEqual(overlayConfig({}), { enabled: false, style: 'badge', position: 'tr', scale: 1, onScore: false });
});

test('overlayConfig: 設定値の読み取りと、不正な値の補正', () => {
  assert.deepEqual(overlayConfig({ overlayEnabled: true, overlayStyle: 'band', overlayPosition: 'bl', overlayScale: 1.5, overlayOnScore: true }),
    { enabled: true, style: 'band', position: 'bl', scale: 1.5, onScore: true });
  const bad = overlayConfig({ overlayEnabled: 'yes', overlayStyle: 'x', overlayPosition: 'zz', overlayScale: 9 });
  assert.deepEqual(bad, { enabled: false, style: 'badge', position: 'tr', scale: 1, onScore: false });
  assert.equal(overlayConfig({ overlayScale: 0.1 }).scale, 1);
});

test('overlayVisible: 無効・停止中・0秒以下は出さない', () => {
  const on = overlayConfig({ overlayEnabled: true });
  assert.equal(overlayVisible(overlayConfig({}), { screen: 'logo' }, RUN), false);
  assert.equal(overlayVisible(on, { screen: 'logo' }, { rem: 5000, running: false }), false);
  assert.equal(overlayVisible(on, { screen: 'logo' }, { rem: 0, running: true }), false);
  assert.equal(overlayVisible(on, { screen: 'logo' }, undefined), false);
});

test('overlayVisible: ロゴ・タイトル・表彰式・順位表巡回・決勝スタートリスト・団体順位には重ねる', () => {
  const on = overlayConfig({ overlayEnabled: true });
  for (const screen of ['logo', 'title', 'ceremony', 'final_startlist', 'teamRanking']) {
    assert.equal(overlayVisible(on, { screen }, RUN), true, screen);
  }
  assert.equal(overlayVisible(on, { screen: 'score', carousel: true }, RUN), true);   // 巡回中は venueScreen が score のまま
});

test('overlayVisible: 会場練習（全画面タイマー）と、スコア画面（集計中・問い合わせ含む）には、既定では重ねない', () => {
  const on = overlayConfig({ overlayEnabled: true });
  assert.equal(overlayVisible(on, { screen: 'warmup' }, RUN), false);
  assert.equal(overlayVisible(on, { screen: 'score' }, RUN), false);
  assert.equal(overlayVisible(on, {}, RUN), false);                                   // 画面の指定なし = スコア
  assert.equal(overlayVisible(on, { screen: 'logo', calculating: true }, RUN), false); // 集計中が前面に出る
  assert.equal(overlayVisible(on, { screen: 'logo', inquiry: true }, RUN), false);
});

test('overlayVisible: 「スコア画面にも重ねる」をオンにすると、スコア・集計中にも重ねる（会場練習は除く）', () => {
  const on = overlayConfig({ overlayEnabled: true, overlayOnScore: true });
  assert.equal(overlayVisible(on, { screen: 'score' }, RUN), true);
  assert.equal(overlayVisible(on, { screen: 'logo', calculating: true }, RUN), true);
  assert.equal(overlayVisible(on, { screen: 'warmup' }, RUN), false);
});

test('overlayVisible: 選手紹介は、一覧ページを除いて重ねる', () => {
  const on = overlayConfig({ overlayEnabled: true });
  assert.equal(overlayVisible(on, { screen: 'intro' }, RUN), true);
  assert.equal(overlayVisible(on, { screen: 'intro', introRoster: true }, RUN), false);
});
