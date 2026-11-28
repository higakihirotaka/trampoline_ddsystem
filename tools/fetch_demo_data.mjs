// 本番の大会データを読み取り専用で取得（書込なし）
import fs from 'node:fs';
const OUT = new URL('./demo_raw.json', import.meta.url);
const EVENT = process.argv[2];
if (!EVENT) { console.error('大会IDを指定してください'); process.exit(1); }
const BASE = 'https://firestore.googleapis.com/v1/projects/trampoline-dd-test/databases/(default)/documents';
const val = x => x == null ? x : 'stringValue' in x ? x.stringValue : 'integerValue' in x ? +x.integerValue : 'doubleValue' in x ? x.doubleValue : 'booleanValue' in x ? x.booleanValue : 'nullValue' in x ? null : 'mapValue' in x ? Object.fromEntries(Object.entries(x.mapValue.fields || {}).map(([k, v]) => [k, val(v)])) : 'arrayValue' in x ? (x.arrayValue.values || []).map(val) : 'timestampValue' in x ? { __ts: Date.parse(x.timestampValue) } : x;
const conv = d => ({ id: d.name.split('/').pop(), ...Object.fromEntries(Object.entries(d.fields || {}).map(([k, v]) => [k, val(v)])) });
const get = async (url, opt) => { for (let i = 0; i < 4; i++) { try { return await (await fetch(url, { ...opt, signal: AbortSignal.timeout(40000) })).json(); } catch (e) { if (i === 3) throw e; } } };
const list = async p => { const out = []; let tok = ''; do { const d = await get(`${BASE}/${p}?pageSize=300${tok}`); out.push(...(d.documents || []).map(conv)); tok = d.nextPageToken ? `&pageToken=${d.nextPageToken}` : ''; } while (tok); return out; };
const query = async (coll, field, v) => { const q = await get(`${BASE}:runQuery`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ structuredQuery: { from: [{ collectionId: coll }], where: { fieldFilter: { field: { fieldPath: field }, op: 'EQUAL', value: { stringValue: v } } }, limit: 5000 } }) }); return q.filter(r => r.document).map(r => conv(r.document)); };
const tour = conv(await get(`${BASE}/tournaments/${EVENT}`));
const athletes = await list(`tournaments/${EVENT}/athletes`);
const results = await query('results', 'eventId', EVENT);
const submissions = await query('submissions', 'eventId', EVENT);
const skillMaster = await list('skillMaster');
let live = {}; for (const k of ['venue', 'judging']) { try { const d = await get(`${BASE}/tournaments/${EVENT}/live/${k}`); if (d.fields) live[k] = conv(d); } catch {} }
fs.writeFileSync(OUT, JSON.stringify({ tour, athletes, results, submissions, skillMaster, live }));
console.log({ athletes: athletes.length, results: results.length, submissions: submissions.length, skillMaster: skillMaster.length, tourKeys: Object.keys(tour).length, live: Object.keys(live) });
