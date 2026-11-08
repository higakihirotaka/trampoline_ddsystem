/**
 * 公開スコアボードへの書込の、画面側の共通部品（docs/realtime-score-spec.md 4章）。
 * CJP・棄権の管理・選手管理などの画面が、本来の保存のあとに呼ぶ。ここでの失敗は、本来の処理を止めない:
 * 順番に書き（同じ項目の順序を守る）、失敗したら数回やり直し、それでもだめなら、画面の隅に通知を出す。
 * 通知が出たら、管理画面の「公開データを再生成」で直せる。
 */
import { db } from "./firebase-config.js";
import { doc, getDoc, getDocs, collection, setDoc, updateDoc, deleteDoc, deleteField, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { calcCardDD, parseDDRule } from "./shared.js";
import * as Board from "./board.js";

const writer = Board.createBoardWriter(db, { doc, getDoc, setDoc, updateDoc, deleteDoc, deleteField, serverTimestamp });

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
export function enqueue(label, fn) {
  const run = async () => {
    let last;
    for (const wait of [0, 1500, 4000]) {
      if (wait) await new Promise(r => setTimeout(r, wait));
      try { return await withTimeout(fn(), 15000); } catch (e) { last = e; }
    }
    console.warn('[board]', label, last);
    notice(`公開スコアの更新に失敗しました（${label}）。管理画面の「公開データを再生成」で直せます。`);
  };
  chain = chain.then(run, run);
  return chain;
}

/** 選手から、書き込み先のグループを決める */
function targetOf(tour, athletes, teams, athleteId) {
  const ath = (athletes || []).find(a => a.id === athleteId);
  if (!ath) return null;
  const g = { type: Board.athleteType(ath), cls: Board.athleteClass(ath), gender: ath.gender || '' };
  g.key = Board.groupKey(g.type, g.cls, g.gender);
  return { ath, g, key: g.key, rule: Board.ruleOf(tour, g.type, g.cls), skeleton: () => Board.buildSkeleton(tour, athletes, teams, g) };
}

async function fetchSkillMaster() {
  const snap = await getDocs(collection(db, 'skillMaster'));
  return snap.docs.map(d => {
    const x = d.data();
    return { id: d.id, symbol: x.symbol, displaySymbol: x.displaySymbol || '', note: x.note || '', dd: parseFloat(x.dd) || 0, isTriple: x.isTriple === true, direction: x.direction || '', displayOrder: x.displayOrder ?? parseInt(d.id) };
  });
}

/** 書込のあと、グループのドキュメントを新しく作ったときは、目次も（無ければ）作る */
async function afterWrite(result, eventId, tour, athletes, teams) {
  if (result === 'created') await writer.ensureIndex(eventId, () => Board.buildIndex(tour, athletes, teams));
}

/**
 * 確定した1本を、公開データに書く。
 * @param {object} p
 *   eventId, tour, athletes, teams（チームのドキュメント）, athleteId, round,
 *   res          確定した結果（結果ドキュメントの内容。確定時にCJPの画面が書く値と同じ形）
 *   skillMaster  いまの技マスタ（配列または { id: {...} }）
 *   panel        ToF・HDを読む審判パネル
 *   onSkillMaster(list)  技マスタを取り直したときに呼ばれる（画面側の技マスタを更新する用）
 */
function _boardPublish(p) {
  const t = targetOf(p.tour, p.athletes, p.teams, p.athleteId);
  if (!t) return Promise.resolve();
  const at = Date.now();
  const res = JSON.parse(JSON.stringify(p.res));   // 確定の瞬間の値で固定する（後から画面が変わっても影響しない）
  return enqueue('得点の公開', async () => {
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
    await afterWrite(await writer.writeRoutine(p.eventId, t.key, p.athleteId, p.round, routine, t.skeleton), p.eventId, p.tour, p.athletes, p.teams);
  });
}

/** 棄権を、公開データに書く */
function _boardDns(p) {
  const t = targetOf(p.tour, p.athletes, p.teams, p.athleteId);
  if (!t) return Promise.resolve();
  const at = Date.now();
  return enqueue('棄権の公開', async () => {
    await afterWrite(await writer.writeRoutine(p.eventId, t.key, p.athleteId, p.round, { at, dns: true }, t.skeleton), p.eventId, p.tour, p.athletes, p.teams);
  });
}

/** 1本を、公開データから消す（棄権の取消・得点の削除） */
function _boardRemove(p) {
  const t = targetOf(p.tour, p.athletes, p.teams, p.athleteId);
  if (!t) return Promise.resolve();
  return enqueue('公開データの削除', () => writer.deleteRoutine(p.eventId, t.key, p.athleteId, p.round));
}

// 公開スコアボードへの書込は、本来の処理（確定・削除など）の邪魔をしない。同期的な例外も、ここで止める
const safe = (fn, label) => p => { try { return fn(p); } catch (e) { console.warn('[board]', label, e); notice(`公開スコアの更新に失敗しました（${label}）。管理画面の「公開データを再生成」で直せます。`); return Promise.resolve(); } };
export const boardPublish = safe(_boardPublish, '得点の公開');
export const boardDns = safe(_boardDns, '棄権の公開');
export const boardRemove = safe(_boardRemove, '公開データの削除');
