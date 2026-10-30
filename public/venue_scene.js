/**
 * 会場ディスプレイごとの「表示する画面」の決め方（純粋な計算。display.html / venue_control.html で共用）
 *
 * 大会ドキュメント（tournaments/{id}）の項目:
 *   venueScreen / venueScreenAt   全体の基準の画面と、その書き込み時刻（CJP・操作画面の「全部」が書く）
 *   rankingCarousel.active        順位表巡回が動いているか（true の間は基準の画面は 'carousel' 扱い）
 *   venueDisplays.{名前}.override { screen, at, finalStartlistTarget? }  その会場ディスプレイだけの画面指定
 *   venueDisplays.{名前}.follow   CJP に従うか（既定 true。false = 操作画面で選んだ画面を保つ）
 *   venueDisplayNames             操作画面に並べる会場ディスプレイの名前
 *
 * 会場ディスプレイは URL の &screen=名前 で自分の名前を持つ（無ければ「メイン」）。
 * 基準の画面と、自分の上書きのうち「新しい方」を表示する。CJP に従わない（follow=false）ときは、上書きを保つ。
 */

export const DEFAULT_DISPLAY = 'メイン';
export const BASE_DISPLAY = '__base';   // 上書きを持たない名前。プレビューが「全部」の状態を見るために使う

const BAD_CHARS = /[.~*/\[\]`]/;        // Firestore の項目パスに使えない文字

/** 操作画面で付けてよい名前か（1〜20文字、前後に空白なし、使えない文字なし） */
export function isValidDisplayName(n) {
  return typeof n === 'string' && n.length >= 1 && n.length <= 20 && n.trim() === n && !BAD_CHARS.test(n) && n !== BASE_DISPLAY;
}

/** URL の &screen= の値から、使う名前を決める（空は「メイン」、使えない文字は _ に置き換える） */
export function displayNameFromParam(v) {
  const n = String(v ?? '').trim().replace(new RegExp(BAD_CHARS.source, 'g'), '_').slice(0, 20);
  return n || DEFAULT_DISPLAY;
}

/** Firestore の Timestamp / ミリ秒 / 無し を、ミリ秒または null にそろえる */
export function tsMs(v) {
  if (v == null) return null;
  if (typeof v === 'number') return v;
  if (typeof v.toMillis === 'function') return v.toMillis();
  return null;
}

/** 全体の基準の画面 */
export function baseOf(t) {
  const x = t || {};
  return { screen: x.rankingCarousel?.active ? 'carousel' : (x.venueScreen || 'score'), at: tsMs(x.venueScreenAt) };
}

/**
 * 名前 name の会場ディスプレイが出す画面を決める。
 * @returns {{ screen:string, source:'base'|'override', follow:boolean, finalStartlistTarget:object|null }}
 */
export function resolveScene(t, name) {
  const base = baseOf(t);
  const d = (name && t?.venueDisplays?.[name]) || null;
  const follow = !d || d.follow !== false;
  const ov = d?.override;
  if (!ov || !ov.screen) return { screen: base.screen, source: 'base', follow, finalStartlistTarget: null };
  const ovAt = tsMs(ov.at);
  // 上書きが選ばれる条件: CJP に従わない／書き込み時刻が確定前（書いた直後の端末）／基準に時刻が無い／上書きの方が新しい
  const wins = !follow || ovAt === null || base.at === null || ovAt >= base.at;
  return wins
    ? { screen: ov.screen, source: 'override', follow, finalStartlistTarget: ov.finalStartlistTarget || null }
    : { screen: base.screen, source: 'base', follow, finalStartlistTarget: null };
}

/**
 * 大会ドキュメントのコピーに、その会場ディスプレイの画面指定を反映したものを返す。
 * 上書きも「CJP に従わない」指定も無ければ、同じオブジェクト（t）をそのまま返す（従来どおりの動作）。
 *   ・上書きが選ばれたとき: venueScreen / rankingCarousel.active / finalStartlistTarget を、その画面に合わせる
 *   ・CJP に従わないとき: 集計中・問い合わせの表示を出さない
 */
export function effectiveTour(t, name) {
  const r = resolveScene(t, name);
  if (r.source !== 'override' && r.follow) return t;
  const x = { ...t };
  if (r.source === 'override') {
    x.venueScreen = r.screen === 'carousel' ? 'score' : r.screen;
    x.rankingCarousel = { ...(t.rankingCarousel || {}), active: r.screen === 'carousel' };
    if (r.finalStartlistTarget) x.finalStartlistTarget = r.finalStartlistTarget;
  }
  if (!r.follow) { x.calculating = false; x.inquiry = false; }
  return x;
}
