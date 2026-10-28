// firestore.rules の許可/拒否を、Firebase のルール試験API（projects:test）で検証する。
// 本番のデータにもルールにも触れない（ルールの文面を送って、模擬のリクエストを評価させるだけ）。
// ネットワークと firebase login 済みの認証情報が必要なため、既定ではスキップする。
//   実行: RULES_TEST=1 npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ROOT } from './helpers.mjs';

const PROJECT = 'trampoline-dd-test';
const enabled = process.env.RULES_TEST === '1';

async function getToken() {
  const cfg = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.config/configstore/firebase-tools.json'), 'utf8'));
  const t = cfg.tokens;
  if (t.access_token && t.expires_at && t.expires_at > Date.now() + 60000) return t.access_token;
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: t.refresh_token,
      client_id: '563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com', client_secret: 'j9iVZfS8kkCEFUPaAeJV0sAi' }),
  });
  const j = await res.json();
  if (!j.access_token) throw new Error('アクセストークンを取得できません（firebase login が必要）');
  return j.access_token;
}

const DOC = '/databases/(default)/documents/results/E1_A1_pre1';
const base = { eventId: 'E1', athleteId: 'A1', round: 'pre1', execution: { judges: { A_E1: { deductions: [0.1], confirmedAt: 't' } } }, officialTotalDD: 5.5, dConfirmedAt: 't', tof: 10.5, hd: { total: 9.5 } };
const pub = { ...base, published: true, publishedAt: 't' };
const merge = (o, p) => { const x = { ...o, ...p }; for (const k of Object.keys(x)) if (x[k] === undefined) delete x[k]; return x; };

const cases = [];
function t(name, expectation, { exist, patch, auth = false, nonAdmin = false, create = false, del = false }) {
  const request = { method: del ? 'delete' : (create ? 'create' : 'update'), path: DOC, auth: auth ? { uid: 'u1', token: {} } : null };
  if (!del) request.resource = { data: create ? patch : merge(exist, patch) };
  const tc = { expectation, request, resource: create ? null : { data: exist } };
  if (auth) tc.functionMocks = [{ function: 'exists', args: [{ exactValue: '/databases/(default)/documents/admins/u1' }], result: { value: !nonAdmin } }];
  cases.push({ name, tc });
}

// ---- 許可: ログインなしの審判 ----
t('E: 新規作成', 'ALLOW', { create: true, patch: { eventId: 'E1', athleteId: 'A1', round: 'pre1', execution: { judges: { A_E1: { deductions: [0.1] } } } } });
t('E: 入力(公開前)', 'ALLOW', { exist: { ...base, published: false }, patch: { execution: { judges: { A_E1: { deductions: [0.2], confirmedAt: null } } } } });
t('E: 確定(公開前)', 'ALLOW', { exist: base, patch: { execution: { judges: { A_E1: { confirmedAt: 't2' } } } } });
t('E: 公開後の遅れた確定', 'ALLOW', { exist: pub, patch: { execution: { judges: { A_E1: { confirmedAt: 't2' } } } } });
t('E: 公開後 execution+updatedAt', 'ALLOW', { exist: pub, patch: { execution: { judges: {} }, updatedAt: 't3' } });
t('TOF: 入力(公開前)', 'ALLOW', { exist: base, patch: { tofByPanel: { A: 10.2 }, updatedAt: 't' } });
t('HD: 入力(公開前)', 'ALLOW', { exist: base, patch: { hdByPanel: { A: 9.1 }, updatedAt: 't' } });
t('D: 確定(公開前)', 'ALLOW', { exist: { ...base, dConfirmedAt: undefined }, patch: { eventId: 'E1', athleteId: 'A1', round: 'pre1', officialSkills: ['a'], validCount: 10, officialTotalDD: 6.1, dConfirmedAt: 't', revisionCount: 1 } });
t('D: 確定解除(公開前)', 'ALLOW', { exist: base, patch: { dConfirmedAt: undefined } });
t('D: 紙運用の合計保存(公開前)', 'ALLOW', { exist: base, patch: { officialSkills: [], officialTotalDD: 7, dConfirmedAt: 't', revisionCount: 2 } });
// ---- 拒否: ログインなし ----
t('公開後の TOF 書き換え', 'DENY', { exist: pub, patch: { tofByPanel: { A: 1 } } });
t('公開後の HD 書き換え', 'DENY', { exist: pub, patch: { hdByPanel: { A: 1 } } });
t('公開後の D 合計書き換え', 'DENY', { exist: pub, patch: { officialTotalDD: 99 } });
t('公開後の D 確定解除', 'DENY', { exist: pub, patch: { dConfirmedAt: undefined } });
t('tof(確定値)を直接書く(公開前)', 'DENY', { exist: base, patch: { tof: 99 } });
t('tof(確定値)を直接書く(公開後)', 'DENY', { exist: pub, patch: { tof: 99 } });
t('hd(確定値)を直接書く', 'DENY', { exist: base, patch: { hd: { total: 99 } } });
t('dns を直接書く', 'DENY', { exist: base, patch: { dns: true } });
t('officialDDValues を直接書く', 'DENY', { exist: base, patch: { officialDDValues: [9] } });
t('published を立てる', 'DENY', { exist: base, patch: { published: true } });
t('published を外す', 'DENY', { exist: pub, patch: { published: false } });
t('publishedAt を書く', 'DENY', { exist: base, patch: { publishedAt: 't' } });
t('verifiedAt を書く', 'DENY', { exist: base, patch: { verifiedAt: 't' } });
t('新規作成で published を含める', 'DENY', { create: true, patch: { eventId: 'E1', published: true } });
t('新規作成で dns を含める', 'DENY', { create: true, patch: { eventId: 'E1', dns: true, published: true } });
t('審判項目+tof の混在', 'DENY', { exist: base, patch: { tofByPanel: { A: 1 }, tof: 99 } });
t('削除(ログインなし)', 'DENY', { exist: base, del: true });
// ---- 管理者 / 管理者でないログイン ----
t('管理者: 公開後に tof 更新', 'ALLOW', { exist: pub, patch: { tof: 11 }, auth: true });
t('管理者: published を立てる', 'ALLOW', { exist: base, patch: { published: true }, auth: true });
t('管理者: 削除', 'ALLOW', { exist: pub, del: true, auth: true });
t('管理者でないログイン: E入力', 'DENY', { exist: base, patch: { execution: { judges: {} } }, auth: true, nonAdmin: true });

test('firestore.rules: results への書き込み', { skip: enabled ? false : 'RULES_TEST=1 のときだけ実行（ネットワークと firebase login が必要）' }, async () => {
  const source = fs.readFileSync(path.join(ROOT, 'firestore.rules'), 'utf8');
  const res = await fetch(`https://firebaserules.googleapis.com/v1/projects/${PROJECT}:test`, {
    method: 'POST', headers: { Authorization: 'Bearer ' + await getToken(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ source: { files: [{ name: 'firestore.rules', content: source }] }, testSuite: { testCases: cases.map(c => c.tc) } }),
  });
  const j = await res.json();
  assert.ok(!j.error, 'ルール試験APIのエラー: ' + JSON.stringify(j.error));
  const results = j.testResults || [];
  assert.equal(results.length, cases.length);
  const failed = results.map((x, i) => ({ x, name: cases[i].name })).filter(o => o.x.state !== 'SUCCESS');
  assert.deepEqual(failed.map(o => o.name), [], '期待と違うケース: ' + failed.map(o => o.name).join(' / '));
});
