/**
 * 共通ユーティリティ
 * 複数ページで使う関数をここに集約する
 */

/**
 * classRules を新旧フォーマットに統一して返す
 *   旧形式: { クラス名: { ... } }
 *   新形式: { individual: { クラス名: {...} }, synchro: { クラス名: {...} } }
 */
export function normalizeClassRules(raw) {
  if (!raw) return { individual: {}, synchro: {} };
  if ('individual' in raw || 'synchro' in raw) return raw;
  if (Object.keys(raw).length > 0) return { individual: raw, synchro: {} };
  return { individual: {}, synchro: {} };
}

// ============================================================
//  順位計算ユーティリティ（ranking.html / display.html / admin_final_order.html 共用）
// ============================================================

/**
 * 結果オブジェクトからタイブレーク用スコアを抽出
 * @param {object|null} result  Firestore result document data
 * @returns {{ tof: number|null, hd: number|null, diff: number|null }}
 */
export function extractTbScores(result) {
  if (!result) return { tof: null, hd: null, diff: null };
  return {
    tof:  result.tof                    ?? null,
    hd:   result.hd?.total              ?? null,
    diff: result.officialD ?? result.dd ?? null   // dd は旧フィールド名フォールバック
  };
}

/**
 * 予選スコア計算（numPre / scoreMode に応じて）
 * @param {number|null} pre1
 * @param {number|null} pre2
 * @param {number} numPre     予選本数
 * @param {'best'|'total'} scoreMode
 * @returns {number|null}
 */
export function calcQualifyingScore(pre1, pre2, numPre, scoreMode) {
  if (numPre === 1) return pre1 ?? null;
  if (pre1 != null && pre2 != null)
    return scoreMode === 'total' ? pre1 + pre2 : Math.max(pre1, pre2);
  return pre1 ?? pre2 ?? null;
}

/**
 * 予選タイブレーク用データ計算
 *   best採用: tbSum = 2本合計、tb = ベスト演技の T/H/D
 *   total採用: tbSum = null（qualScore が既に合計）、tb = 2本合計の T/H/D
 * @param {number|null} pre1
 * @param {number|null} pre2
 * @param {object|null} pre1r  pre1 の Firestore result document data
 * @param {object|null} pre2r  pre2 の Firestore result document data
 * @param {number} numPre
 * @param {'best'|'total'} scoreMode
 * @returns {{ tbSum: number|null, tb: { tof, hd, diff } }}
 */
export function calcQualifyingTb(pre1, pre2, pre1r, pre2r, numPre, scoreMode) {
  if (numPre < 2 || pre1 == null || pre2 == null) {
    return { tbSum: null, tb: extractTbScores(pre1 != null ? pre1r : pre2r) };
  }
  if (scoreMode === 'best') {
    return {
      tbSum: pre1 + pre2,
      tb:    extractTbScores(pre1 >= pre2 ? pre1r : pre2r)
    };
  } else {
    const s1 = extractTbScores(pre1r), s2 = extractTbScores(pre2r);
    return {
      tbSum: null,
      tb: {
        tof:  (s1.tof  ?? 0) + (s2.tof  ?? 0),
        hd:   (s1.hd   ?? 0) + (s2.hd   ?? 0),
        diff: (s1.diff ?? 0) + (s2.diff ?? 0)
      }
    };
  }
}

/**
 * 決勝スコア計算（finalScoreMode に応じて）
 * @param {number|null} qualPre       予選スコア（combined モード時に使用）
 * @param {number|null} final         決勝スコア
 * @param {'zero'|'combined'} finalScoreMode
 * @returns {number|null}
 */
export function calcFinalScore(qualPre, final, finalScoreMode) {
  if (finalScoreMode === 'combined') {
    if (qualPre != null && final != null) return qualPre + final;
    return final ?? qualPre ?? null;
  }
  // zero: 決勝スコア単体（未確定時は null → 末尾へ）
  return final ?? null;
}

/**
 * ランキング用ソート比較関数（降順、null 末尾）
 * TR2025 §4.4.4: 主スコア → 2本合計（best採用時のみ）→ T → H → D
 *
 * 各エントリは以下を持つこと:
 *   { qualScore: number|null, tbSum: number|null, tb: { tof, hd, diff } }
 *
 * @returns {number}  負 = a が上位
 */
export function compareRankEntries(a, b) {
  if (a.qualScore == null && b.qualScore == null) return 0;
  if (a.qualScore == null) return  1;
  if (b.qualScore == null) return -1;
  // ① 主スコア（小数第 3 位で比較）
  const as2 = Math.round(a.qualScore * 1000) / 1000;
  const bs2 = Math.round(b.qualScore * 1000) / 1000;
  if (bs2 !== as2) return bs2 - as2;
  // ② 2本合計（best採用時のみ; total採用時は tbSum = null なので skip）
  if (a.tbSum != null && b.tbSum != null && Math.abs(b.tbSum - a.tbSum) > 1e-9) return b.tbSum - a.tbSum;
  // ③ T（個人=ToF / シンクロ=Syn）→ H → D
  for (const k of ['tof', 'hd', 'diff']) {
    const va = a.tb?.[k], vb = b.tb?.[k];
    if (va != null && vb != null && Math.abs(vb - va) > 1e-9) return vb - va;
  }
  return 0;
}

/**
 * ランク番号割り当て（同点タイ対応）
 * compareRankEntries でソート済みの配列を受け取り、各エントリに .rank を付与する
 * @param {Array} entries  mutable, ソート済み
 * @returns {Array}  同一参照（チェーン用）
 */
export function assignRanks(entries) {
  entries.forEach((r, idx) => {
    if (idx === 0) { r.rank = 1; return; }
    const prev = entries[idx - 1];
    if (r.qualScore == null || prev.qualScore == null) { r.rank = idx + 1; return; }
    const isTied =
      Math.round(r.qualScore * 1000) / 1000 === Math.round(prev.qualScore * 1000) / 1000 &&
      (r.tbSum      == null || r.tbSum      === prev.tbSum)      &&
      (r.tb?.tof    == null || r.tb.tof     === prev.tb?.tof)    &&
      (r.tb?.hd     == null || r.tb.hd      === prev.tb?.hd)     &&
      (r.tb?.diff   == null || r.tb.diff    === prev.tb?.diff);
    r.rank = isTied ? prev.rank : idx + 1;
  });
  return entries;
}

// ============================================================

/**
 * トランポリン競技ボーナス点計算 (FIG規則)
 *   男子: 5本超のトリプル 1本につき +0.3（6本目以降）
 *   女子・混合: 2本超のトリプル 1本につき +0.3（3本目以降）
 */
export function calcBonus(gender, tripleCount) {
  if (gender === '男子' && tripleCount > 5) return (tripleCount - 5) * 0.3;
  if ((gender === '女子' || gender === '混合') && tripleCount >= 3) return (tripleCount - 2) * 0.3;
  return 0;
}
