/**
 * 共通ユーティリティ
 * 複数ページで使う関数をここに集約する
 */

/**
 * DD値を小数第1位に丸める。
 *
 * 難度上限（perSkillDDCap/routineDDCap）との比較は、表示精度（toFixed(1)）と
 * 揃えるためにこれを通してから行うこと。素の値のまま比較すると、複数の技のDDを
 * 順に加算していく過程で浮動小数点の丸め誤差が乗り（例: 0.6+0.1+1.5+...+0.3 の
 * 合計が数学的には7.9でも実際は7.900000000000001になる）、表示上は上限とちょうど
 * 同じ値なのに「上限超え」の色が付いてしまうことがある。
 */
export function round1(v) {
    return Math.round(v * 10) / 10;
}

/**
 * 「値が前回と実質的に変わっていなければ何もしない」ガード。
 *
 * tournaments/{id} のような、無関係な用途のフィールドが多数同居する巨大ドキュメントを
 * 丸ごと onSnapshot している画面（会場ディスプレイ・大会画面コントロール等）は、
 * 自分に無関係なフィールドの書き込みでもハンドラが毎回発火してしまう。
 * その中で「このサブフィールドは今回のスナップショットで本当に変わったか」を判定し、
 * 変わった時だけ apply を呼ぶことで、無関係な発火のたびに入力中のフォームを
 * 保存済みの値で上書きしたり、無駄な再描画をしたりするのを防ぐ。
 *
 * @param {object} cache  シグネチャを保持する入れ物（呼び出し側がモジュールスコープ等で用意する、
 *                        key ごとに複数の値を管理できる単なるオブジェクト）
 * @param {string} key    cache 内でこの値を識別するキー
 * @param {*} value       今回のスナップショットで得た値（比較対象。JSON化できる範囲のみ）
 * @param {(value:*) => void} apply  値が変化した時だけ呼ばれる反映関数
 */
export function applyIfChanged(cache, key, value, apply) {
  const sig = JSON.stringify(value ?? null);
  if (cache[key] === sig) return;
  cache[key] = sig;
  apply(value);
}

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
    // タイ判定はソート基準 (compareRankEntries) と完全一致させる
    // （独自の === 比較だと浮動小数誤差でソートと食い違い、同着の順位がずれることがある）
    r.rank = compareRankEntries(r, prev) === 0 ? prev.rank : idx + 1;
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
