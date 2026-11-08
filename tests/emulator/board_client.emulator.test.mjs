// board_client.js（画面側の共通部品）を、本物の SDK・ルール・エミュレータで確かめる。
// ブラウザ用の import（gstatic の URL と firebase-config.js）だけ、テスト用に差し替えて読み込む。
// 確かめること: 確定の書込（骨組み・目次の作成）、技マスタに技が追加された場合の取り直し、取り直しても無い技は ? で通知、
//              棄権と削除、書込の失敗は本来の処理を止めず通知だけ出す（認証なし＝書けない状況で確かめる）。
import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { registerHooks } from 'node:module';
import { makeEnv, F } from './env.mjs';
import { PUBLIC } from '../helpers.mjs';

// ---- ブラウザ用の import を差し替える
registerHooks({
  resolve(spec, ctx, next) {
    if (spec.startsWith('https://www.gstatic.com/firebasejs/')) return next('firebase/firestore', { ...ctx, parentURL: pathToFileURL(path.join(PUBLIC, '..', 'package.json')).href });
    if (spec === './firebase-config.js') return { url: 'virtual:firebase-config' + (ctx.parentURL ? new URL(ctx.parentURL).search : ''), shortCircuit: true };   // 読み込み元ごとに別のインスタンス
    return next(spec, ctx);
  },
  load(url, ctx, next) {
    if (url.startsWith('virtual:firebase-config')) return { format: 'module', source: 'export const db = globalThis.__testDb;', shortCircuit: true };
    // public/ の .js はブラウザ用の ES モジュール（package.json が commonjs なので、形式を指定する）
    if (url.startsWith(pathToFileURL(PUBLIC).href) && url.split('?')[0].endsWith('.js')) return next(url, { ...ctx, format: 'module' });
    return next(url, ctx);
  },
});

// notice() が使う document の最小限
const notices = [];
globalThis.document = { getElementById: () => null, createElement: () => { const el = { style: {}, remove() {} }; return el; }, body: { appendChild: () => {} } };
const origCreate = globalThis.document.createElement;
globalThis.document.createElement = () => { const el = origCreate(); Object.defineProperty(el, 'textContent', { set(v) { notices.push(v); } }); return el; };

let t, C, B, S;
before(async () => {
  t = await makeEnv('demo-trampoline-boardclient');
  globalThis.__testDb = t.admin;
  C = await import(pathToFileURL(path.join(PUBLIC, 'board_client.js')).href);
  B = await import(pathToFileURL(path.join(PUBLIC, 'board.js')).href);
  S = await import(pathToFileURL(path.join(PUBLIC, 'shared.js')).href);
});
after(async () => { await t.env.cleanup(); });
beforeEach(async () => { await t.clear(); notices.length = 0; globalThis.__testDb = t.admin; });

const TOUR = { name: '試験大会', qualifyingRoutines: 1, classes: { individual: [{ name: 'Aクラス', display_order: 1 }] }, classRules: { individual: { Aクラス: {} } } };
const ATH = [
  { id: 'a1', name1: '山田', club1: '甲大', type: 'individual', class: 'Aクラス', gender: '男子' },
  { id: 'a2', name1: '鈴木', club1: '乙大', type: 'individual', class: 'Aクラス', gender: '男子' },
];
const KEY = 'individual__Aクラス__男子';
const read = (id = KEY) => t.read('tournaments', 'E1', 'publicBoard', id);
const master = [{ id: '1', symbol: 'a', displaySymbol: 'A', dd: 0.5, isTriple: false }];
const res = (o = {}) => ({ published: true, validCount: 2, officialSkills: ['1', '1'], officialD: 0.5, officialE: 17, tof: 12, hd: { total: 9 }, penalty: 0, officialTotal: 38.5, officialEPerSkill: [0.1, 0.2], hdtsPerSkillByPanel: { A: { tof: [1, 2], hd: [0, 0] } }, ...o });
const base = (o = {}) => ({ eventId: 'E1', tour: TOUR, athletes: ATH, teams: [], athleteId: 'a1', round: 'pre1', skillMaster: master, panel: 'A', ...o });

test('確定: 骨組み（名簿）と目次が作られ、その1本が入る。次の選手は、更新だけ', async () => {
  await C.boardPublish(base({ res: res() }));
  const d = await read();
  assert.equal(d.rows.a1.pre1.total, 38.5); assert.equal(d.rows.a1.pre1.sk[0].sym, 'A'); assert.equal(d.meta.roster.a2.n1, '鈴木');
  const ix = await read(B.INDEX_ID);
  assert.equal(ix.groups[0].key, KEY); assert.equal(ix.tournament.name, '試験大会');
  await C.boardPublish(base({ athleteId: 'a2', res: res({ officialTotal: 30 }) }));
  const d2 = await read();
  assert.equal(d2.rows.a1.pre1.total, 38.5); assert.equal(d2.rows.a2.pre1.total, 30);
  assert.equal(notices.length, 0);
});

test('確定: 試合中に技マスタへ追加された技は、取り直して記号を解決する（画面の技マスタにも反映）', async () => {
  // 取り直すのは技マスタの全件（本番と同じく、手元の技マスタの技も含む）
  await t.seed(async db => {
    await F.setDoc(F.doc(db, 'skillMaster', '1'), { symbol: 'a', displaySymbol: 'A', dd: 0.5, isTriple: false });
    await F.setDoc(F.doc(db, 'skillMaster', '999'), { symbol: '新技', displaySymbol: 'NEW', dd: 1.1, isTriple: false });
  });
  let refreshed = null;
  await C.boardPublish(base({ res: res({ officialSkills: ['1', '999'] }), onSkillMaster: l => { refreshed = l; } }));
  const d = await read();
  assert.equal(d.rows.a1.pre1.sk[1].sym, 'NEW'); assert.equal(d.rows.a1.pre1.sk[1].dd, '1.1');
  assert.deepEqual(notices, []); assert.ok(refreshed.some(s => s.id === '999'));
});

test('確定: 取り直しても無い技は、記号 ? で書き、通知を出す（確定は止まらない）', async () => {
  await C.boardPublish(base({ res: res({ officialSkills: ['1', '12345'] }) }));
  assert.equal((await read()).rows.a1.pre1.sk[1].sym, '?');
  assert.equal(notices.length, 1); assert.match(notices[0], /12345/);
});

test('確定: 渡した結果を後から書き換えても、書かれる内容は確定の瞬間のまま', async () => {
  const r = res();
  const p = C.boardPublish(base({ res: r }));
  r.officialTotal = 1; r.officialSkills = [];
  await p;
  assert.equal((await read()).rows.a1.pre1.total, 38.5);
});

test('棄権と、棄権の取消・得点の削除', async () => {
  await C.boardDns(base());
  assert.equal((await read()).rows.a1.pre1.dns, true);
  await C.boardPublish(base({ athleteId: 'a2', res: res() }));
  await C.boardRemove(base());
  const d = await read();
  assert.equal(d.rows.a1?.pre1, undefined); assert.equal(d.rows.a2.pre1.total, 38.5);
  await C.boardRemove(base({ athleteId: 'zzz' }));   // 名簿に無い選手は何もしない
});

test('書込の順序: 続けて同じ本を2回確定しても、最後の値が残る', async () => {
  C.boardPublish(base({ res: res({ officialTotal: 10 }) }));
  C.boardPublish(base({ res: res({ officialTotal: 20 }) }));
  await C.boardPublish(base({ res: res({ officialTotal: 30 }) }));
  assert.equal((await read()).rows.a1.pre1.total, 30);
});

test('失敗: 書けない状況（認証なし）でも、例外を投げず、やり直したあとで通知を出す', async () => {
  globalThis.__testDb = t.anon;
  // 認証なしの db を、書き手が使うように、新しく読み込み直す
  const C2 = await import(pathToFileURL(path.join(PUBLIC, 'board_client.js')).href + '?anon');
  await assert.doesNotReject(C2.boardPublish(base({ res: res() })));
  assert.equal(notices.length, 1); assert.match(notices[0], /再生成/);
  assert.equal(await read(), undefined);
  await assert.doesNotReject(C2.boardPublish({ ...base(), tour: null, athletes: null, res: {} }));   // 壊れた入力でも、例外にしない
});
