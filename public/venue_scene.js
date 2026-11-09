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

/** 全体の基準の画面（プログラムは含まない。基準の書き込み時刻の比較に使う） */
export function baseOf(t) {
  const x = t || {};
  return { screen: x.rankingCarousel?.active ? 'carousel' : (x.venueScreen || 'score'), at: tsMs(x.venueScreenAt) };
}

// ---- プログラム（画面を決めた秒数ずつ、順に自動で切り替える） ----
// プログラム = { name, loop, items: [{ screen, durationSec, finalStartlistTarget?, announce? }] }
//   全体: 大会ドキュメントの venueProgram = { at(開始時刻), ...プログラム }
//   ディスプレイごと: venueDisplays.{名前}.override.program = プログラム（override.at が開始時刻）
// 開始時刻（サーバー時刻）と経過時間から、いま何番目の項目かを各ディスプレイが計算する。操作画面は何も書き続けない。
// 開始後に基準・上書きが書き直されたら（CJPの確定、操作画面での切り替え）、プログラムは自然に終わる（時刻の比較は上と同じ）。

/** 経過時間から、いま何番目の項目か。ループしないプログラムは、終わったら最後の項目のまま（ended=true） */
export function programPosition(items, loop, elapsedMs) {
  const durs = items.map(i => Math.max(1, Number(i.durationSec) || 1) * 1000);
  const total = durs.reduce((x, y) => x + y, 0);
  let e = Math.max(0, elapsedMs);
  if (!loop && e >= total) return { index: items.length - 1, remainingMs: 0, ended: true };
  if (loop) e %= total;
  let i = 0;
  while (e >= durs[i]) { e -= durs[i]; i++; }
  return { index: i, remainingMs: durs[i] - e, ended: false };
}

function validProgram(p) { return !!p && Array.isArray(p.items) && p.items.length > 0; }

/** プログラム p を atMs に開始して、nowMs にどの項目か（開始時刻が確定前なら、いま始まったものとして扱う） */
function runProgram(p, atMs, nowMs) {
  const pos = programPosition(p.items, p.loop === true, nowMs - (atMs ?? nowMs));
  const item = p.items[pos.index];
  return {
    screen: item.screen, finalStartlistTarget: item.finalStartlistTarget || null, announce: item.announce || null,
    program: { name: p.name || '', index: pos.index, count: p.items.length, remainingMs: pos.remainingMs, ended: pos.ended, loop: p.loop === true },
  };
}

/** 基準の画面（実行中のプログラムがあれば、その項目）。プログラムは、基準の書き込みより新しい間だけ有効 */
function resolveBase(t, nowMs) {
  const base = baseOf(t);
  const vp = t?.venueProgram;
  if (validProgram(vp)) {
    const pat = tsMs(vp.at);
    if (pat === null || base.at === null || pat >= base.at) {
      return { at: base.at, source: 'base', ...runProgram(vp, pat, nowMs) };
    }
  }
  return { screen: base.screen, at: base.at, source: 'base', finalStartlistTarget: null, announce: null, program: null };
}

/**
 * 名前 name の会場ディスプレイが出す画面を決める。nowMs はサーバー時刻（プログラムの現在位置の計算に使う）。
 * @returns {{ screen:string, source:'base'|'override', follow:boolean, finalStartlistTarget:object|null,
 *             announce:object|null, program:null|{name,index,count,remainingMs,ended,loop} }}
 */
export function resolveScene(t, name, nowMs = Date.now()) {
  const base = resolveBase(t, nowMs);
  const d = (name && t?.venueDisplays?.[name]) || null;
  const follow = !d || d.follow !== false;
  const ov = d?.override;
  const asBase = () => ({ screen: base.screen, source: 'base', follow, finalStartlistTarget: base.finalStartlistTarget, announce: base.announce, program: base.program });
  if (!ov || (!ov.screen && !validProgram(ov.program))) return asBase();
  const ovAt = tsMs(ov.at);
  // 上書きが選ばれる条件: CJP に従わない／書き込み時刻が確定前（書いた直後の端末）／基準に時刻が無い／上書きの方が新しい
  const wins = !follow || ovAt === null || base.at === null || ovAt >= base.at;
  if (!wins) return asBase();
  if (validProgram(ov.program)) return { source: 'override', follow, ...runProgram(ov.program, ovAt, nowMs) };
  return { screen: ov.screen, source: 'override', follow, finalStartlistTarget: ov.finalStartlistTarget || null, announce: null, program: null };
}

/**
 * 大会ドキュメントのコピーに、その会場ディスプレイの画面指定を反映したものを返す。
 * 上書き・プログラム・「CJP に従わない」指定のどれも無ければ、同じオブジェクト（t）をそのまま返す（従来どおりの動作）。
 *   ・上書きやプログラムが選ばれたとき: venueScreen / rankingCarousel.active / finalStartlistTarget / announceSettings を、その画面に合わせる
 *   ・CJP に従わないとき: 集計中・問い合わせの表示を出さない
 */
export function effectiveTour(t, name, nowMs = Date.now()) {
  const r = resolveScene(t, name, nowMs);
  if (r.source !== 'override' && r.follow && !r.program) return t;
  const x = { ...t };
  if (r.source === 'override' || r.program) {
    x.venueScreen = r.screen === 'carousel' ? 'score' : r.screen;
    x.rankingCarousel = { ...(t.rankingCarousel || {}), active: r.screen === 'carousel' };
    if (r.finalStartlistTarget) x.finalStartlistTarget = r.finalStartlistTarget;
    if (r.announce) x.announceSettings = { ...(t.announceSettings || {}), ...r.announce };
  }
  if (!r.follow) { x.calculating = false; x.inquiry = false; }
  return x;
}
