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

/**
 * トランポリン競技ボーナス点計算 (FIG規則)
 *   男子: 5本超のトリプル 1本につき +0.3（6本目以降）
 *   女子: 2本超のトリプル 1本につき +0.3（3本目以降）
 */
export function calcBonus(gender, tripleCount) {
  if (gender === '男子' && tripleCount > 5) return (tripleCount - 5) * 0.3;
  if (gender === '女子' && tripleCount >= 3) return (tripleCount - 2) * 0.3;
  return 0;
}
