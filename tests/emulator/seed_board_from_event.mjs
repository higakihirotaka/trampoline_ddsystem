// 手元の確認用（テストではない）: 本番の大会データを「読み取りだけ」して、公開データ（publicBoard）をエミュレータに作る。
// 本番には何も書かない。公開ページを手元で確認するときに使う。
//
//   1) エミュレータを起動:  firebase emulators:start --only firestore --project trampoline-dd-test
//   2) このスクリプトを実行: node tests/emulator/seed_board_from_event.mjs <大会ID> [--raw]
//        そのまま: 公開データ（publicBoard）をエミュレータに作る。 --raw: 大会・選手・チーム・結果・技マスタの生データを、エミュレータに写す
//        （管理画面の「公開データを再生成」を手元で試すとき。書込を許す一時的なルールで、エミュレータを起動する）
//   3) 手元で開く: http://localhost:8899/score.html?event=<大会ID>&emulator=1
//                  http://localhost:8899/admin_public_board.html?event=<大会ID>&emulator=1
import fs from 'node:fs';
import path from 'node:path';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import * as F from 'firebase/firestore';
import { ROOT, loadEsm } from '../helpers.mjs';

const EVENT = process.argv[2];
if (!EVENT) { console.error('大会IDを指定してください'); process.exit(1); }
const BASE = 'https://firestore.googleapis.com/v1/projects/trampoline-dd-test/databases/(default)/documents';
const val = x => x == null ? x : 'stringValue' in x ? x.stringValue : 'integerValue' in x ? +x.integerValue : 'doubleValue' in x ? x.doubleValue : 'booleanValue' in x ? x.booleanValue : 'nullValue' in x ? null : 'mapValue' in x ? Object.fromEntries(Object.entries(x.mapValue.fields || {}).map(([k, v]) => [k, val(v)])) : 'arrayValue' in x ? (x.arrayValue.values || []).map(val) : 'timestampValue' in x ? x.timestampValue : x;
const conv = d => ({ id: d.name.split('/').pop(), ...Object.fromEntries(Object.entries(d.fields || {}).map(([k, v]) => [k, val(v)])) });
const list = async p => { const out = []; let tok = ''; do { const d = await (await fetch(`${BASE}/${p}?pageSize=300${tok}`)).json(); out.push(...(d.documents || []).map(conv)); tok = d.nextPageToken ? `&pageToken=${d.nextPageToken}` : ''; } while (tok); return out; };

const B = await loadEsm('board.js'), S = await loadEsm('shared.js');
const tour = conv(await (await fetch(`${BASE}/tournaments/${EVENT}`)).json());
const athletes = await list(`tournaments/${EVENT}/athletes`);
const teams = await list(`tournaments/${EVENT}/teams`);
const q = await (await fetch(`${BASE}:runQuery`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ structuredQuery: { from: [{ collectionId: 'results' }], where: { fieldFilter: { field: { fieldPath: 'eventId' }, op: 'EQUAL', value: { stringValue: EVENT } } }, limit: 5000 } }) })).json();
const results = q.filter(r => r.document).map(r => conv(r.document));
const skills = JSON.parse(fs.readFileSync(path.join(ROOT, 'public', 'skills.json'), 'utf8')).skills;
const RAW = process.argv.includes('--raw');
const skillMaster = RAW ? await list('skillMaster') : [];
const out = B.buildAll({ tour, athletes, teams, results, skills, calcCardDD: S.calcCardDD, parseDDRule: S.parseDDRule });

const env = await initializeTestEnvironment({ projectId: 'trampoline-dd-test', firestore: { host: '127.0.0.1', port: 8080 } });
await env.withSecurityRulesDisabled(async ctx => {
  const db = ctx.firestore();
  if (RAW) {
    const put = (d, ...p) => { const { id, ...rest } = d; return F.setDoc(F.doc(db, ...p, id), rest); };
    const { id: _t, ...tourRest } = tour;
    await F.setDoc(F.doc(db, 'tournaments', EVENT), tourRest);
    for (const a of athletes) await put(a, 'tournaments', EVENT, 'athletes');
    for (const x of teams) await put(x, 'tournaments', EVENT, 'teams');
    for (const r of results) await put(r, 'results');
    for (const k of skillMaster) await put(k, 'skillMaster');
    return;
  }
  const w = B.createBoardWriter(db, { doc: F.doc, setDoc: F.setDoc, updateDoc: F.updateDoc, deleteField: F.deleteField, serverTimestamp: F.serverTimestamp, deleteDoc: F.deleteDoc });
  await w.writeIndex(EVENT, out.index);
  for (const [k, doc] of Object.entries(out.groups)) await w.writeGroup(EVENT, k, doc);
});
await env.cleanup();
console.log(RAW ? `生データをエミュレータに写しました: 選手 ${athletes.length}、チーム ${teams.length}、結果 ${results.length}、技マスタ ${skillMaster.length}` : `エミュレータに書きました: グループ ${Object.keys(out.groups).length}、結果 ${results.length} 件`);
