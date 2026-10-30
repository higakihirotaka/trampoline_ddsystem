/**
 * 大会ドキュメントの分割（会場の操作状態・審判の進行状態を、別ドキュメントへ）
 *
 * これまで tournaments/{id} 1つに、設定（classRules など）と、頻繁に変わる状態（会場の画面・タイマー・
 * 集計中・審判の liveState）が同居していて、CJP の操作のたびに、全画面の監視が反応していた。
 * 次のように分ける:
 *   tournaments/{id}              設定（今のまま）
 *   tournaments/{id}/live/venue   会場の操作状態（LIVE_VENUE_FIELDS）
 *   tournaments/{id}/live/judging 審判の進行状態（LIVE_JUDGING_FIELDS = liveState）
 *
 * 移行は、2つのモードで行う（切り替えは、下の DEFAULT_MODE を変えて再デプロイ。試験は ?split=live または
 * localStorage の liveSplitMode で、その端末だけ切り替えられる）:
 *   'dual'          書込は、従来の tournaments/{id} に、そのまま書き、あわせて live/* にも写す。
 *                   読込は、従来どおり tournaments/{id} だけを監視する（＝画面の動作は、これまでと同じ）。
 *   'live'（既定）  書込は、live/* にだけ書く（設定は tournaments/{id}）。読込は、3つを監視して、まとめて返す。
 *                   読み込み側の画面は、これまでと同じ形（snap.exists() / snap.data()）のまま使える。
 * live/* の先頭の書込時に、tournaments/{id} の現在の値を丸ごと写し（バックフィル）、_migratedAt の印を付ける。
 * 読込側は、この印がある live/* だけを信用する（印が無い大会は、従来どおり tournaments/{id} を使う）。
 * これにより、live/* で消した項目が、古い tournaments/{id} の値で復活しない。
 */

export const LIVE_VENUE_FIELDS = new Set([
  'venueScreen', 'venueScreenAt', 'venueDisplays', 'venueDisplayNames', 'venueProgram', 'venuePrograms',
  'warmupSettings', 'titleSettings', 'ceremonySettings', 'announceSettings', 'announcePhrases',
  'rankingCarousel', 'introSettings', 'finalStartlistTarget', 'teamRankingTarget',
  'calculating', 'calculatingAthleteId', 'calculatingRound', 'inquiry', 'inquiryAthleteId', 'inquiryRound',
]);
export const LIVE_JUDGING_FIELDS = new Set(['liveState']);
export const LIVE_MARK = '_migratedAt';
export const DEFAULT_MODE = 'live';   // 2026-10-30 に dual から切り替え。戻すときは 'dual'（docs/venue-control-spec.md の移行手順を参照）

/** いまのモード。URL の ?split=（dual|live）、無ければ localStorage の liveSplitMode、無ければ既定 */
export function splitMode() {
  try {
    const q = new URLSearchParams(globalThis.location?.search || '').get('split');
    if (q === 'live' || q === 'dual') return q;
  } catch (e) { /* 無視 */ }
  try {
    const v = globalThis.localStorage?.getItem('liveSplitMode');
    if (v === 'live' || v === 'dual') return v;
  } catch (e) { /* 無視 */ }
  return DEFAULT_MODE;
}

const topKey = k => String(k).split('.')[0];
/** 項目（ドット区切りなら最上位の名前）が、どのドキュメントに属するか */
export function groupOf(key) {
  const k = topKey(key);
  return LIVE_VENUE_FIELDS.has(k) ? 'venue' : LIVE_JUDGING_FIELDS.has(k) ? 'judging' : 'main';
}
/** 書き込みデータを、主・会場・審判に仕分ける（キーは元のまま。ドット区切りも最上位の名前で判定） */
export function partitionData(data) {
  const out = { main: {}, venue: {}, judging: {} };
  for (const [k, v] of Object.entries(data || {})) out[groupOf(k)][k] = v;
  return out;
}

/** live ドキュメントの内容から、印を除く */
function stripMark(d) { const { [LIVE_MARK]: _m, ...rest } = d || {}; return rest; }

/**
 * 主・会場・審判の3つのドキュメントの内容から、従来と同じ形の大会データを作る。
 * 印のある live ドキュメントだけを信用し、その項目は、主の値を捨てて live の値を使う（消した項目が復活しないように）。
 */
export function mergeFor(main, venue, judging) {
  const out = { ...(main || {}) };
  if (venue && venue[LIVE_MARK] !== undefined) {
    LIVE_VENUE_FIELDS.forEach(k => { delete out[k]; });
    Object.assign(out, stripMark(venue));
  }
  if (judging && judging[LIVE_MARK] !== undefined) {
    LIVE_JUDGING_FIELDS.forEach(k => { delete out[k]; });
    Object.assign(out, stripMark(judging));
  }
  return out;
}

const KINDS = { venue: 'venue', judging: 'judging' };

/**
 * firestore の関数一式 fs（doc / getDoc / setDoc / updateDoc / onSnapshot / serverTimestamp）と db から、
 * 大会ドキュメントに限って、分割に対応した onSnapshot / updateDoc / setDoc を作る。
 * 大会ドキュメント以外の参照には、何もせず、元の関数をそのまま呼ぶ。
 * opts.mode: モードを返す関数（試験用。既定は splitMode）
 */
export function liveFirestore(fs, db, opts = {}) {
  const mode = opts.mode || splitMode;
  const isTour = ref => !!ref && typeof ref.path === 'string' && /^tournaments\/[^/]+$/.test(ref.path);
  const eventIdOf = ref => ref.path.split('/')[1];
  const liveRef = (eventId, kind) => fs.doc(db, 'tournaments', eventId, 'live', KINDS[kind]);
  const ensured = new Map();

  // live ドキュメントに印が無ければ、主の現在の値を写して、印を付ける（1ページにつき1回）
  function ensureLive(eventId, kind) {
    const key = eventId + ':' + kind;
    if (ensured.has(key)) return ensured.get(key);
    const p = (async () => {
      const ref = liveRef(eventId, kind);
      const cur = await fs.getDoc(ref);
      if (cur.exists() && cur.data()[LIVE_MARK] !== undefined) return;
      const main = await fs.getDoc(fs.doc(db, 'tournaments', eventId));
      const fields = {};
      for (const [k, v] of Object.entries(main.exists() ? main.data() : {})) if (groupOf(k) === kind) fields[k] = v;
      await fs.setDoc(ref, { ...fields, [LIVE_MARK]: fs.serverTimestamp() }, { merge: true });
    })();
    ensured.set(key, p);
    p.catch(() => ensured.delete(key));   // 失敗したら、次の書き込みでやり直す
    return p;
  }
  const liveUpdate = async (eventId, kind, fields) => { await ensureLive(eventId, kind); await fs.updateDoc(liveRef(eventId, kind), fields); };
  const liveSet = async (eventId, kind, fields) => { await ensureLive(eventId, kind); await fs.setDoc(liveRef(eventId, kind), fields, { merge: true }); };
  const nonEmpty = o => Object.keys(o).length > 0;
  const quiet = p => p.catch(e => { try { console.warn('live ドキュメントへの写しに失敗（従来の書き込みは成功）:', e && e.message); } catch (x) { /* 無視 */ } });

  async function updateDoc(ref, data, ...rest) {
    if (!isTour(ref) || rest.length || !data || typeof data !== 'object') return fs.updateDoc(ref, data, ...rest);
    const eventId = eventIdOf(ref), parts = partitionData(data);
    if (mode() === 'dual') {
      await fs.updateDoc(ref, data);      // 従来どおり（主に全部）
      await Promise.all(['venue', 'judging'].filter(k => nonEmpty(parts[k])).map(k => quiet(liveUpdate(eventId, k, parts[k]))));
      return;
    }
    const ops = [];
    if (nonEmpty(parts.main)) ops.push(fs.updateDoc(ref, parts.main));
    ['venue', 'judging'].forEach(k => { if (nonEmpty(parts[k])) ops.push(liveUpdate(eventId, k, parts[k])); });
    await Promise.all(ops);
  }

  async function setDoc(ref, data, options) {
    if (!isTour(ref) || !options || !options.merge || !data || typeof data !== 'object') return fs.setDoc(ref, data, options);
    const eventId = eventIdOf(ref), parts = partitionData(data);
    if (mode() === 'dual') {
      await fs.setDoc(ref, data, options);
      await Promise.all(['venue', 'judging'].filter(k => nonEmpty(parts[k])).map(k => quiet(liveSet(eventId, k, parts[k]))));
      return;
    }
    const ops = [];
    if (nonEmpty(parts.main)) ops.push(fs.setDoc(ref, parts.main, options));
    ['venue', 'judging'].forEach(k => { if (nonEmpty(parts[k])) ops.push(liveSet(eventId, k, parts[k])); });
    await Promise.all(ops);
  }

  // 'live' モード: 主・会場・審判の3つを監視して、従来と同じ形でまとめて返す（3つとも最初の応答が揃ってから）
  function onSnapshot(ref, onNext, onError) {
    if (!isTour(ref) || mode() === 'dual') return fs.onSnapshot(ref, onNext, onError);
    const eventId = eventIdOf(ref);
    let main = null, venue = null, judging = null;
    const got = { m: false, v: false, j: false };
    const emit = () => {
      if (!(got.m && got.v && got.j)) return;
      onNext({
        id: main.id, ref,
        exists: () => main.exists(),
        data: () => mergeFor(main.data(), venue && venue.exists() ? venue.data() : null, judging && judging.exists() ? judging.data() : null),
        metadata: main.metadata,
      });
    };
    const subs = [
      fs.onSnapshot(ref, s => { main = s; got.m = true; emit(); }, onError),
      fs.onSnapshot(liveRef(eventId, 'venue'), s => { venue = s; got.v = true; emit(); }, () => { venue = null; got.v = true; emit(); }),
      fs.onSnapshot(liveRef(eventId, 'judging'), s => { judging = s; got.j = true; emit(); }, () => { judging = null; got.j = true; emit(); }),
    ];
    return () => subs.forEach(u => { try { u(); } catch (e) { /* 無視 */ } });
  }

  /** 1回だけ読む（'live' モードでは、会場・審判もまとめる）。cache.js・大会の複製が使う */
  async function getTournamentMerged(eventId) {
    const main = await fs.getDoc(fs.doc(db, 'tournaments', eventId));
    if (!main.exists()) return null;
    if (mode() === 'dual') return main.data();
    const [v, j] = await Promise.all([
      fs.getDoc(liveRef(eventId, 'venue')).catch(() => null),
      fs.getDoc(liveRef(eventId, 'judging')).catch(() => null),
    ]);
    return mergeFor(main.data(), v && v.exists() ? v.data() : null, j && j.exists() ? j.data() : null);
  }

  return { onSnapshot, updateDoc, setDoc, getTournamentMerged, ensureLive };
}
