/**
 * 公開スコアボードへの書込の、画面側の共通部品（docs/realtime-score-spec.md 4章）。
 * CJP・棄権の管理・選手管理などの画面が、本来の保存のあとに呼ぶ。ここでの失敗は、本来の処理を止めない:
 * 順番に書き（同じ項目の順序を守る）、失敗したら数回やり直し、それでもだめなら、画面の隅に通知を出す。
 * 通知が出たら、管理画面の「公開データを再生成」で直せる。
 *
 * 画面が大会・選手・チームのデータを持っていれば tour / athletes / teams として渡す（読み込みを増やさないため）。
 * 渡さなければ、必要になったときだけ、Firestore から読む。
 */
import { db } from "./firebase-config.js";
import { doc, getDoc, getDocs, collection, query, where, setDoc, updateDoc, deleteDoc, deleteField, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { calcCardDD, parseDDRule } from "./shared.js";
import * as Board from "./board.js";

export const writer = Board.createBoardWriter(db, { doc, getDoc, setDoc, updateDoc, deleteDoc, deleteField, serverTimestamp });

/** 画面の隅の、消えていく通知（操作を止めない） */
export function notice(msg) {
  try {
    let box = document.getElementById('board-notice');
    if (!box) {
      box = document.createElement('div');
      box.id = 'board-notice';
      box.style.cssText = 'position:fixed;right:12px;bottom:12px;z-index:99999;display:flex;flex-direction:column;gap:6px;max-width:min(92vw,380px);';
      document.body.appendChild(box);
    }
    const el = document.createElement('div');
    el.style.cssText = 'background:#7c2d12;color:#fff;padding:10px 12px;border-radius:8px;font-size:12px;line-height:1.5;box-shadow:0 4px 14px rgba(0,0,0,.3);';
    el.textContent = msg;
    box.appendChild(el);
    setTimeout(() => el.remove(), 12000);
  } catch { /* 通知が出せなくても、本来の処理には影響させない */ }
}

const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('TIMEOUT')), ms))]);
let chain = Promise.resolve();
/** 書込を、順番に実行する。失敗したら、少し待ってやり直す。戻り値は、終わるまで待てる Promise（待たなくてよい） */
export function enqueue(label, fn, timeoutMs = 15000) {
  const run = async () => {
    let last;
    for (const wait of [0, 1500, 4000]) {
      if (wait) await new Promise(r => setTimeout(r, wait));
      try { return await withTimeout(fn(), timeoutMs); } catch (e) { last = e; }
    }
    console.warn('[board]', label, last);
    notice(`公開スコアの更新に失敗しました（${label}）。管理画面の「公開データを再生成」で直せます。`);
  };
  chain = chain.then(run, run);
  return chain;
}

// ---------- 大会・選手・チームの読み込み（画面が渡さなかったときだけ） ----------
const docsOf = snap => snap.docs.map(d => ({ id: d.id, ...d.data() }));
async function fetchTeams(eventId) { try { return docsOf(await getDocs(collection(db, 'tournaments', eventId, 'teams'))); } catch { return []; } }
/** 最新の大会設定・選手（決勝試技順を含む）・チーム */
export async function loadContext(eventId) {
  const [t, a, teams] = await Promise.all([getDoc(doc(db, 'tournaments', eventId)), getDocs(collection(db, 'tournaments', eventId, 'athletes')), fetchTeams(eventId)]);
  if (!t.exists()) throw new Error('大会データが見つかりません');
  return { tour: t.data(), athletes: docsOf(a), teams };
}
/**
 * 渡されたデータを使い、足りなければ必要になったときに読む。
 * fresh(): ドキュメントを新しく作るとき（名簿の骨組み・目次）は、最新の大会・選手（決勝試技順を含む）・チームを読み直す。
 * 画面が持っているデータは古いことがあり（キャッシュ・読み込み後の変更）、決勝試技順を持たない画面もあるため。1グループにつき、ほぼ1回だけ。
 */
function lazyContext(p) {
  let base = p.tour && p.athletes ? { tour: p.tour, athletes: p.athletes } : null, fresh = null;
  return {
    async get() { return base ||= await loadContext(p.eventId); },
    async fresh() { return fresh ||= await loadContext(p.eventId).catch(async () => (await this.get())); },
  };
}

/** 選手から、書き込み先のグループを決める */
function targetOf(c, athleteId, lc) {
  const ath = (c.athletes || []).find(a => a.id === athleteId);
  if (!ath) return null;
  const g = { type: Board.athleteType(ath), cls: Board.athleteClass(ath), gender: ath.gender || '' };
  g.key = Board.groupKey(g.type, g.cls, g.gender);
  return { ath, g, key: g.key, rule: Board.ruleOf(c.tour, g.type, g.cls), skeleton: async () => { const f = await lc.fresh(); return Board.buildSkeleton(f.tour, f.athletes, f.teams || [], g); } };
}

async function fetchSkillMaster() {
  const snap = await getDocs(collection(db, 'skillMaster'));
  return snap.docs.map(d => {
    const x = d.data();
    return { id: d.id, symbol: x.symbol, displaySymbol: x.displaySymbol || '', note: x.note || '', dd: parseFloat(x.dd) || 0, isTriple: x.isTriple === true, direction: x.direction || '', displayOrder: x.displayOrder ?? parseInt(d.id) };
  });
}

/** 書込のあと、グループのドキュメントを新しく作ったときは、目次も（無ければ）作る */
async function afterWrite(result, eventId, lc) {
  if (result === 'created') await writer.ensureIndex(eventId, async () => { const f = await lc.fresh(); return Board.buildIndex(f.tour, f.athletes, f.teams || []); });
}

/** 確定した結果から、1本分の公開データを作って書く（確定・修正中の前の値の復元に共通） */
function publishRoutine(label, p) {
  const lc = lazyContext(p);
  const at = Date.now();
  const res = JSON.parse(JSON.stringify(p.res));   // 確定の瞬間の値で固定する（後から画面が変わっても影響しない）
  return enqueue(label, async () => {
    const c = await lc.get();
    const t = targetOf(c, p.athleteId, lc);
    if (!t) return;
    let skills = Board.indexSkills(p.skillMaster);
    if (Board.findUnresolvedSkills(res, skills).length) {
      // 試合中に技マスタへ技が追加された場合: 取り直す。それでも無ければ、記号は ? にして、通知する（確定は止めない）
      try { const list = await fetchSkillMaster(); skills = Board.indexSkills(list); p.onSkillMaster?.(list); } catch { /* 取り直せなければ、手元の技マスタで続ける */ }
      const still = Board.findUnresolvedSkills(res, skills);
      if (still.length) notice(`技マスタに無い技があります（${still.join('、')}）。公開ページでは記号が「?」になります。技マスタを直したあと、この本を再確定してください。`);
    }
    const routine = Board.buildRoutine(res, {
      at, synchro: t.g.type === 'synchro', gender: t.ath.gender, rule: t.rule, round: p.round, skills, panel: p.panel, calcCardDD, parseDDRule,
    });
    await afterWrite(await writer.writeRoutine(p.eventId, t.key, p.athleteId, p.round, routine, t.skeleton), p.eventId, lc);
  });
}

/**
 * 確定した1本を、公開データに書く。
 * @param {object} p
 *   eventId, athleteId, round,
 *   tour, athletes, teams   （省略可。省略すると必要なときだけ読む）
 *   res          確定した結果（結果ドキュメントの内容。確定時にCJPの画面が書く値と同じ形）
 *   skillMaster  いまの技マスタ（配列または { id: {...} }。省略可）
 *   panel        ToF・HDを読む審判パネル（省略可）
 *   onSkillMaster(list)  技マスタを取り直したときに呼ばれる（画面側の技マスタを更新する用）
 */
function _boardPublish(p) { return publishRoutine('得点の公開', p); }

/** 棄権を、公開データに書く */
function _boardDns(p) {
  const lc = lazyContext(p);
  const at = Date.now();
  return enqueue('棄権の公開', async () => {
    const c = await lc.get();
    const t = targetOf(c, p.athleteId, lc);
    if (!t) return;
    await afterWrite(await writer.writeRoutine(p.eventId, t.key, p.athleteId, p.round, { at, dns: true }, t.skeleton), p.eventId, lc);
  });
}

/** 1本を、公開データから消す（棄権の取消・得点の削除） */
function _boardRemove(p) {
  const lc = lazyContext(p);
  return enqueue('公開データの削除', async () => {
    const t = targetOf(await lc.get(), p.athleteId, lc);
    if (t) await writer.deleteRoutine(p.eventId, t.key, p.athleteId, p.round);
  });
}

/**
 * 名簿・チーム・ルール・目次を、すでにある公開ドキュメントに書き直す（選手管理・決勝試技順・チーム・ルールの保存のあと）。
 * 最新のデータを読み直して作る。公開ドキュメントが無いグループには書かない（大会の準備中に、選手名が公開されないように）。
 * 戻り値の Promise は、終わるまで待てる（画面を移動する前などに待つ）。
 */
function _boardSyncMeta(p) {
  return enqueue('名簿・設定の公開', async () => {
    const c = await loadContext(p.eventId);
    const groups = Board.listGroups(c.tour, c.athletes);
    await Promise.all(groups.map(g => {
      const m = Board.buildMeta(c.tour, c.athletes, c.teams, g);
      return writer.updateMeta(p.eventId, g.key, { roster: m.roster, rule: m.rule, teams: m.teams });
    }));
    await writer.updateIndex(p.eventId, Board.buildIndex(c.tour, c.athletes, c.teams));
  }, 30000);
}

/**
 * 公開データを、結果から作り直す（管理画面の「公開データを再生成」）。大会・選手・チーム・クラス設定・技マスタ・確定済みの得点を
 * すべて読み、目次と全グループを書き、もう無いグループの公開データを消す。
 * @param {string} eventId
 * @param {(msg:string)=>void} [onProgress]
 * @returns {Promise<{ stats: Array, stale: string[], results: number }>}
 */
export async function regenerateBoard(eventId, onProgress = () => {}) {
  onProgress('大会・選手・チームを読み込み中…');
  const c = await loadContext(eventId);
  onProgress('確定済みの得点と技マスタを読み込み中…');
  const [resSnap, skills] = await Promise.all([getDocs(query(collection(db, 'results'), where('eventId', '==', eventId))), fetchSkillMaster()]);
  const results = resSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  onProgress('公開データを作成中…');
  const out = Board.buildAll({ tour: c.tour, athletes: c.athletes, teams: c.teams, results, skills, calcCardDD, parseDDRule });
  onProgress('書き込み中…');
  const existing = await getDocs(collection(db, 'tournaments', eventId, Board.BOARD_COLLECTION));
  await writer.writeIndex(eventId, out.index);
  for (const [key, d] of Object.entries(out.groups)) await writer.writeGroup(eventId, key, d);
  // 選手がいなくなったグループの、古い公開データを消す
  const stale = existing.docs.map(d => d.id).filter(id => id !== Board.INDEX_ID && !(id in out.groups));
  for (const id of stale) await writer.removeGroup(eventId, id);
  return { stats: out.stats, stale, results: results.length };
}

// 公開スコアボードへの書込は、本来の処理（確定・削除など）の邪魔をしない。同期的な例外も、ここで止める
const safe = (fn, label) => p => { try { return fn(p); } catch (e) { console.warn('[board]', label, e); notice(`公開スコアの更新に失敗しました（${label}）。管理画面の「公開データを再生成」で直せます。`); return Promise.resolve(); } };
export const boardPublish = safe(_boardPublish, '得点の公開');
export const boardDns = safe(_boardDns, '棄権の公開');
export const boardRemove = safe(_boardRemove, '公開データの削除');
export const boardSyncMeta = safe(_boardSyncMeta, '名簿・設定の公開');
