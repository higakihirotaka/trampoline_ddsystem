import test from 'node:test';
import assert from 'node:assert/strict';
import { loadEsm } from './helpers.mjs';

const { DEFAULT_DISPLAY, BASE_DISPLAY, isValidDisplayName, displayNameFromParam, tsMs, baseOf, resolveScene, effectiveTour, programPosition } = await loadEsm('venue_scene.js');

const ts = ms => ({ toMillis: () => ms });
const doc = o => ({ venueScreen: 'logo', venueScreenAt: ts(1000), ...o });
const disp = (name, d) => ({ venueDisplays: { [name]: d } });

test('名前: 使えるか・URLからの決め方', () => {
  assert.equal(isValidDisplayName('サブ'), true);
  assert.equal(isValidDisplayName('Sub 2'), true);
  for (const bad of ['', ' サブ', 'サブ ', 'a.b', 'a/b', 'a[1]', 'a*', 'a~', 'a`b', 'x'.repeat(21), BASE_DISPLAY]) assert.equal(isValidDisplayName(bad), false, JSON.stringify(bad));
  assert.equal(displayNameFromParam(null), DEFAULT_DISPLAY);
  assert.equal(displayNameFromParam('  '), DEFAULT_DISPLAY);
  assert.equal(displayNameFromParam('サブ'), 'サブ');
  assert.equal(displayNameFromParam('a.b/c'), 'a_b_c');
  assert.equal(displayNameFromParam(BASE_DISPLAY), BASE_DISPLAY);
});

test('tsMs: Timestamp・数値・無し', () => {
  assert.equal(tsMs(ts(5)), 5); assert.equal(tsMs(7), 7); assert.equal(tsMs(null), null); assert.equal(tsMs(undefined), null); assert.equal(tsMs({}), null);
});

test('baseOf: 巡回が動いていれば carousel、なければ venueScreen、どちらも無ければ score', () => {
  assert.deepEqual(baseOf(doc({})), { screen: 'logo', at: 1000 });
  assert.equal(baseOf(doc({ rankingCarousel: { active: true } })).screen, 'carousel');
  assert.deepEqual(baseOf({}), { screen: 'score', at: null });
});

test('上書きが無ければ基準の画面（従来どおり）。同じオブジェクトを返す', () => {
  const t = doc({});
  assert.deepEqual(resolveScene(t, 'サブ'), { screen: 'logo', source: 'base', follow: true, finalStartlistTarget: null, announce: null, program: null });
  assert.equal(effectiveTour(t, 'サブ'), t);
  assert.equal(effectiveTour(doc({ ...disp('メイン', { follow: true }) }), 'サブ').venueScreen, 'logo');
});

test('追従中: 上書きの方が新しければ上書き、基準の方が新しければ基準（CJPの確定が勝つ）', () => {
  const ov = at => disp('サブ', { override: { screen: 'warmup', at: ts(at) } });
  assert.equal(resolveScene(doc(ov(2000)), 'サブ').screen, 'warmup');
  assert.equal(resolveScene(doc(ov(2000)), 'サブ').source, 'override');
  assert.equal(resolveScene(doc(ov(500)), 'サブ').screen, 'logo');       // CJP 等が後から基準を書いた
  assert.equal(resolveScene(doc(ov(1000)), 'サブ').screen, 'warmup');    // 同時刻は上書き
});

test('追従中: 上書きの書き込み時刻が確定前（null）、または基準に時刻が無いときは上書きが勝つ', () => {
  assert.equal(resolveScene(doc(disp('サブ', { override: { screen: 'title', at: null } })), 'サブ').screen, 'title');
  assert.equal(resolveScene({ venueScreen: 'logo', ...disp('サブ', { override: { screen: 'title', at: ts(1) } }) }, 'サブ').screen, 'title');
});

test('CJPに従わない: 基準が新しくても上書きを保つ。集計中・問い合わせは出さない', () => {
  const t = doc({ calculating: true, inquiry: true, ...disp('サブ', { follow: false, override: { screen: 'warmup', at: ts(10) } }) });
  const r = resolveScene(t, 'サブ');
  assert.deepEqual([r.screen, r.source, r.follow], ['warmup', 'override', false]);
  const x = effectiveTour(t, 'サブ');
  assert.equal(x.venueScreen, 'warmup'); assert.equal(x.calculating, false); assert.equal(x.inquiry, false);
  // 他のディスプレイ（追従）は影響を受けない
  assert.equal(effectiveTour(t, 'メイン'), t);
  assert.equal(effectiveTour(t, 'メイン').calculating, true);
});

test('上書きが carousel: 巡回を有効にした画面にする（項目は共通設定のまま）', () => {
  const t = doc({ rankingCarousel: { active: false, items: [{ classVal: 'A' }] }, ...disp('サブ', { override: { screen: 'carousel', at: ts(2000) } }) });
  const x = effectiveTour(t, 'サブ');
  assert.equal(x.venueScreen, 'score');
  assert.equal(x.rankingCarousel.active, true);
  assert.deepEqual(x.rankingCarousel.items, [{ classVal: 'A' }]);
  assert.equal(t.rankingCarousel.active, false);          // 元のドキュメントは変えない
});

test('基準が巡回中で、上書きが別の画面: 巡回を止めた画面にする', () => {
  const t = doc({ rankingCarousel: { active: true, items: [] }, ...disp('サブ', { override: { screen: 'announce', at: ts(2000) } }) });
  const x = effectiveTour(t, 'サブ');
  assert.equal(x.venueScreen, 'announce'); assert.equal(x.rankingCarousel.active, false);
  assert.equal(effectiveTour(t, 'メイン'), t);              // 上書きの無いディスプレイは巡回のまま
});

test('決勝スタートリストは、上書きの対象クラスを使う', () => {
  const target = { class: 'A', gender: '女子', type: 'individual' };
  const t = doc({ finalStartlistTarget: { class: 'B' }, ...disp('サブ', { override: { screen: 'final_startlist', at: ts(2000), finalStartlistTarget: target } }) });
  assert.deepEqual(effectiveTour(t, 'サブ').finalStartlistTarget, target);
  assert.deepEqual(effectiveTour(t, 'メイン').finalStartlistTarget, { class: 'B' });
});

test('プレビューが使う「全部」の名前は、上書きを持たない（基準そのもの）', () => {
  const t = doc({ ...disp('サブ', { override: { screen: 'warmup', at: ts(2000) } }) });
  assert.equal(effectiveTour(t, BASE_DISPLAY), t);
});

test('CJPが基準を書き直した後（団体順位）: 追従中のディスプレイは団体順位、固定中のディスプレイは上書きのまま', () => {
  const t = { venueScreen: 'teamRanking', venueScreenAt: ts(5000), venueDisplays: {
    メイン: { override: { screen: 'logo', at: ts(100) } },
    サブ: { follow: false, override: { screen: 'announce', at: ts(100) } } } };
  assert.equal(resolveScene(t, 'メイン').screen, 'teamRanking');
  assert.equal(resolveScene(t, 'サブ').screen, 'announce');
});

// ---------- プログラム ----------
const items = [
  { screen: 'logo', durationSec: 10 },
  { screen: 'title', durationSec: 5 },
  { screen: 'announce', durationSec: 20, announce: { line1: '休憩中です', line2: '', line3: '' } },
];   // 合計 35 秒

test('programPosition: 経過時間から項目と残り時間を求める', () => {
  const p = ms => programPosition(items, false, ms);
  assert.deepEqual(p(0), { index: 0, remainingMs: 10000, ended: false });
  assert.deepEqual(p(9999), { index: 0, remainingMs: 1, ended: false });
  assert.deepEqual(p(10000), { index: 1, remainingMs: 5000, ended: false });
  assert.deepEqual(p(15000), { index: 2, remainingMs: 20000, ended: false });
  assert.deepEqual(p(34999), { index: 2, remainingMs: 1, ended: false });
  assert.deepEqual(p(-5000), { index: 0, remainingMs: 10000, ended: false });     // 時計のずれで負になっても最初の項目
});

test('programPosition: ループしないと最後の項目のまま終了、ループすると先頭に戻る', () => {
  assert.deepEqual(programPosition(items, false, 35000), { index: 2, remainingMs: 0, ended: true });
  assert.deepEqual(programPosition(items, false, 9e9), { index: 2, remainingMs: 0, ended: true });
  assert.deepEqual(programPosition(items, true, 35000), { index: 0, remainingMs: 10000, ended: false });
  assert.deepEqual(programPosition(items, true, 35000 * 1000 + 12000), { index: 1, remainingMs: 3000, ended: false });
});

test('programPosition: 秒数が不正な項目は1秒として扱う', () => {
  const x = [{ screen: 'logo' }, { screen: 'title', durationSec: 0 }, { screen: 'ceremony', durationSec: 'abc' }];
  assert.equal(programPosition(x, true, 0).index, 0);
  assert.equal(programPosition(x, true, 1000).index, 1);
  assert.equal(programPosition(x, true, 2000).index, 2);
  assert.equal(programPosition(x, true, 3000).index, 0);
});

test('全体のプログラム: 時刻とともに画面が進み、お知らせ文は項目の文になる', () => {
  const t = { venueScreen: 'logo', venueScreenAt: ts(1000), venueProgram: { at: ts(1000), name: '昼休み', loop: false, items } };
  const at = ms => resolveScene(t, 'メイン', ms);
  assert.equal(at(1000).screen, 'logo');
  assert.equal(at(1000).program.name, '昼休み');
  assert.equal(at(12000).screen, 'title');
  assert.deepEqual([at(20000).screen, at(20000).announce, at(20000).program.index, at(20000).program.count], ['announce', items[2].announce, 2, 3]);
  const x = effectiveTour({ ...t, announceSettings: { line1: '元', fontSize: 6 } }, 'メイン', 20000);
  assert.equal(x.venueScreen, 'announce'); assert.equal(x.announceSettings.line1, '休憩中です'); assert.equal(x.announceSettings.fontSize, 6);
});

test('全体のプログラム: 基準があとから書き直された（CJPの確定など）ら、プログラムは終わる', () => {
  const t = { venueScreen: 'score', venueScreenAt: ts(5000), venueProgram: { at: ts(1000), loop: true, items } };
  const r = resolveScene(t, 'メイン', 6000);
  assert.equal(r.screen, 'score'); assert.equal(r.program, null);
  assert.equal(effectiveTour(t, 'メイン', 6000), t);
});

test('全体のプログラム: 開始と同じ書き込み（同時刻）なら有効。巡回の項目は巡回を有効にした画面になる', () => {
  const t = { venueScreen: 'logo', venueScreenAt: ts(1000), rankingCarousel: { active: false, items: [{ classVal: 'A' }] },
    venueProgram: { at: ts(1000), loop: true, items: [{ screen: 'carousel', durationSec: 30 }, { screen: 'logo', durationSec: 5 }] } };
  const x = effectiveTour(t, 'メイン', 2000);
  assert.equal(x.venueScreen, 'score'); assert.equal(x.rankingCarousel.active, true); assert.deepEqual(x.rankingCarousel.items, [{ classVal: 'A' }]);
  assert.equal(effectiveTour(t, 'メイン', 1000 + 31000).venueScreen, 'logo');
  assert.equal(effectiveTour(t, 'メイン', 1000 + 31000).rankingCarousel.active, false);
});

test('ディスプレイごとのプログラム: その名前だけが進む。基準の方が新しければ終わる', () => {
  const t = { venueScreen: 'logo', venueScreenAt: ts(1000), venueDisplays: { サブ: { override: { screen: 'logo', at: ts(2000), program: { loop: true, items } } } } };
  assert.equal(resolveScene(t, 'サブ', 2000 + 12000).screen, 'title');
  assert.equal(resolveScene(t, 'メイン', 2000 + 12000).screen, 'logo');
  assert.equal(resolveScene(t, 'サブ', 2000 + 12000).program.index, 1);
  const t2 = { ...t, venueScreen: 'score', venueScreenAt: ts(9000) };
  assert.equal(resolveScene(t2, 'サブ', 12000).screen, 'score');          // CJP が後から書いた
  assert.equal(resolveScene(t2, 'サブ', 12000).program, null);
  const pinned = { ...t2, venueDisplays: { サブ: { follow: false, override: t.venueDisplays.サブ.override } } };
  assert.equal(resolveScene(pinned, 'サブ', 2000 + 12000).screen, 'title'); // 固定中は基準が新しくても続く
});

test('プログラムの開始時刻が確定前（null）の端末では、いま始まったものとして先頭の項目', () => {
  const t = { venueScreen: 'logo', venueScreenAt: ts(1000), venueProgram: { at: null, loop: true, items } };
  assert.equal(resolveScene(t, 'メイン', 99999).screen, 'logo');
  assert.equal(resolveScene(t, 'メイン', 99999).program.index, 0);
});

test('項目が空のプログラムは無視する', () => {
  const t = { venueScreen: 'title', venueScreenAt: ts(1000), venueProgram: { at: ts(1000), items: [] } };
  assert.equal(resolveScene(t, 'メイン').screen, 'title');
  assert.equal(resolveScene(t, 'メイン').program, null);
});
