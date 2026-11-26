// デモページ（public/demo/）を作る。本物の画面（display / entry / judge_panel / judge_cjp / d_calc）を、
// Firestore のかわりにダミーデータ（fake-firestore.js）で動く形に加工して書き出す。
//
//   使い方:  node tools/fetch_demo_data.mjs <大会ID>            … 本番の大会データを「読み取りだけ」で取得（tools/demo_raw.json）
//            node tools/build_demo.mjs                           … public/demo/ を作る
//
// 画面のプログラムは本物のまま。変えるのは、読み込み先（Firestore → ダミー）、最初のURLの値、「デモ一覧」への戻りリンクだけ。
// 本物の画面を直したあとは、もう一度このスクリプトを実行すると、デモにも反映される。
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const PUB = path.join(ROOT, 'public'), OUT = path.join(PUB, 'demo');
const RAW = path.join(ROOT, 'tools', 'demo_raw.json');
const R = JSON.parse(fs.readFileSync(RAW, 'utf8'));

const REAL_EVENT = R.tour.id || R.eventId;
const EVENT = 'demo';
const ts = ms => ({ __ts: ms });

// ---------- ダミーデータ ----------
const swapEvent = v => JSON.parse(JSON.stringify(v).split(REAL_EVENT).join(EVENT));
const isA = a => a.type === 'individual' && a.class === 'Aクラス' && a.gender === '男子';
const finalists = R.athletes.filter(a => isA(a) && a.isInFinal && a.finalOrder != null).sort((a, b) => a.finalOrder - b.finalOrder);
if (finalists.length < 5) throw new Error('A男子の決勝選手が見つかりません');
const ids = new Set(finalists.map(a => a.id));
const nakata = finalists.find(a => a.name1.includes('中田'));
if (!nakata) throw new Error('中田選手が見つかりません');
const nextAth = finalists.find(a => a.finalOrder === nakata.finalOrder + 1);   // 中田の次に試技する選手（D審判のデモ用）

const athletesOf = list => Object.fromEntries(list.map(a => { const { id, ...x } = a; return [`tournaments/${EVENT}/athletes/${id}`, x]; }));
const resultsOf = (pred, tweak = x => x) => Object.fromEntries(R.results.filter(r => ids.has(r.athleteId) && pred(r))
  .map(r => { const x = swapEvent(r); const id = x.id; delete x.id; return [`results/${id}`, tweak(x, r)]; }));
const subsOf = pred => Object.fromEntries(R.submissions.filter(s => ids.has(s.athleteId) && pred(s))
  .map(s => { const x = swapEvent(s); const id = x.id; delete x.id; return [`submissions/${id}`, x]; }));

const tourBase = () => {
  const { id, liveState, ...t } = swapEvent(R.tour);
  // 決勝の8人以外の氏名・運営の氏名は、デモに含めない（大会の設定データには、選手紹介用の名簿や審判長などの氏名が入っている）
  const introSettings = { ...(t.introSettings || {}), athletes: [], showRoster: false, showPerClassRoster: false, isRunning: false };
  const staff = Object.fromEntries(Object.entries(t.judgeConfig?.staff || {}).map(([k, v]) => [k, typeof v === 'string' ? '' : v]));
  return {
    ...t,
    introSettings,
    // 審判の割り当て（judgeConfig.classes には、担当審判の氏名が入っている）は含めない。並び順の設定だけ残す
    judgeConfig: { rosterOrder: t.judgeConfig?.rosterOrder || {}, rosterHidden: t.judgeConfig?.rosterHidden || {}, staff },
    venueScreen: 'score', venueScreenAt: ts(Date.now()), calculating: false, inquiry: false,
    rankingCarousel: { active: false }, liveState: {},
  };
};

// 英語表記の既定値（技マスタに英語が未入力でも、D計算のデモで英語表示を確認できるように）
const EN_SYMBOL = { 'シート': 'Seat', 'ハーフシート': 'Half seat', 'フルシート': 'Full seat', 'スィーブル': 'Swivel', 'スタンド': 'Stand', 'ハーフスタンド': 'Half stand', 'ハーフピルエット': 'Half pirouette', 'フルピルエット': 'Full pirouette', 'フロントドロップ': 'Front drop', 'ハーフフロント': 'Half front', 'ハーフフロント（L）': 'Half front (L)', 'バックドロップ': 'Back drop', 'ハーフターンテーブル': 'Half turntable', 'フロント': 'Front', '1,1/2プルエット': '1 1/2 pirouette', 'ローラー': 'Roller' };
const EN_NOTE = { 'タックバウンス': 'Tuck bounce', 'パイクバウンス': 'Pike bounce', 'ストラドルバウンス': 'Straddle bounce', 'プルオーバー': 'Pullover', 'プルオーバー（L）': 'Pullover (L)', '3/4バック': '3/4 Back', '3/4フロント': '3/4 Front', 'コディ': 'Cody', '1,1/4': '1 1/4', '前方向': 'Forward', '後方向': 'Backward', '全日本インカレC規定専用': 'All-Japan Intercollegiate, C compulsory only' };
const skillDocs = Object.fromEntries(R.skillMaster.map(s => {
  const { id, ...x } = s;
  if (!x.symbolEn && EN_SYMBOL[x.symbol]) x.symbolEn = EN_SYMBOL[x.symbol];
  if (!x.noteEn && EN_NOTE[x.note]) x.noteEn = EN_NOTE[x.note];
  return [`skillMaster/${id}`, x];
}));

// 得点表示: 決勝の選手が試技順に確定していき、中田選手が確定した直後（順位が出る）
const STEP = 3 * 60 * 1000, T0 = Date.now() - 60 * 1000 - STEP * nakata.finalOrder;
const displayDocs = () => {
  const done = finalists.filter(a => a.finalOrder <= nakata.finalOrder);
  const pub = new Map(done.map(a => [a.id, T0 + STEP * a.finalOrder]));
  return {
    [`tournaments/${EVENT}`]: tourBase(),
    ...athletesOf(finalists),
    ...resultsOf(r => r.round !== 'final' || pub.has(r.athleteId), (x) => {
      if (x.round === 'final') { x.published = true; x.publishedAt = ts(pub.get(x.athleteId)); x.verifiedAt = x.publishedAt; delete x.displaySkip; }
      else { x.published = true; x.publishedAt = ts(T0 - 3600 * 1000); delete x.displaySkip; }
      return x;
    }),
    // 提出された競技カード（申請の内容）。画面は、実施した技が申請と違うと、技とDの値を赤くする
    ...subsOf(s => s.round === 'final'),
    ...skillDocs,
  };
};

// D審判: 中田の次の選手の、決勝のカードが出ている。D審判の確定はまだ（確定ボタンを押せる）。
// 中田より後の選手は、決勝の結果ドキュメントが無い（D審判も、E審判も、まだ入力していない）状態にする
const panelDocs = () => ({
  [`tournaments/${EVENT}`]: tourBase(),
  ...athletesOf(finalists),
  ...resultsOf(r => r.round !== 'final' || finalists.find(a => a.id === r.athleteId).finalOrder <= nakata.finalOrder),
  ...subsOf(() => true),
  ...skillDocs,
});

// CJP: 中田選手の決勝（実データ）。全員の結果が揃っている
const cjpDocs = () => ({
  [`tournaments/${EVENT}`]: tourBase(),
  ...athletesOf(finalists),
  ...resultsOf(() => true),
  ...subsOf(() => true),
  ...skillDocs,
});

// 競技カード提出: 中田選手の決勝のカードを、これから入力する状態（提出なし・ふりがなも空欄）。締切は外す。
// 予選のカードは残す（「予選演技をコピーする」「同じチームの選手の構成を読込」を試せるように）
const entryDocs = () => {
  const { submissionDeadline, revisionDeadline, finalSubmissionDeadline, ...tour } = tourBase();
  const mine = `submissions/${EVENT}_${nakata.id}_final`;
  const subs = subsOf(() => true);
  if (!subs[mine]) throw new Error('中田選手の決勝の提出データが見つかりません: ' + mine);
  delete subs[mine];
  return { [`tournaments/${EVENT}`]: tour, ...athletesOf(finalists), ...subs, ...skillDocs };
};
// 英語表示のローマ字はふりがなから作るので、ふりがなを空欄にするのは、言語を合わせた後
const BLANK_MY_KANA = `const me = docs["tournaments/${EVENT}/athletes/${nakata.id}"];
me.kana1 = ''; me.clubKana1 = '';
`;

const strip = o => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
const dataModule = (name, docs, after = '') => `// 自動生成（tools/build_demo.mjs）。本番の大会データをもとにした、デモ用のダミーデータ。
import { seed } from "./fake-firestore.js";
import { localizeDocs } from "./demo-i18n.js";   // 英語表示のときは、選手名（ローマ字）・大学名・大会名を英語にして取り込む
const docs = localizeDocs(${JSON.stringify(strip(docs))});
${after}seed(docs);
`;

// ---------- 画面の加工 ----------
const badge = langButtons => `
<style>
  #demo-badge{position:fixed;left:10px;bottom:10px;z-index:2147483000;display:flex;gap:8px;align-items:center;font:600 12px/1.2 system-ui,'Noto Sans JP',sans-serif;
    background:rgba(17,24,39,.86);color:#fff;border-radius:999px;padding:6px 8px 6px 12px;box-shadow:0 2px 10px rgba(0,0,0,.3);opacity:.9}
  #demo-badge:hover{opacity:1}
  #demo-badge b{background:#f59e0b;color:#111;border-radius:999px;padding:2px 8px;font-size:11px;letter-spacing:.04em}
  #demo-badge a{color:#fff;text-decoration:none}
  #demo-badge .lang{display:inline-flex;margin-left:2px}
  #demo-badge .lang button{font:inherit;font-size:11px;font-weight:700;padding:3px 9px;background:transparent;color:#cbd5e1;border:1px solid #64748b;cursor:pointer}
  #demo-badge .lang button:first-child{border-radius:999px 0 0 999px}
  #demo-badge .lang button:last-child{border-radius:0 999px 999px 0;border-left:0}
  #demo-badge .lang button[aria-pressed="true"]{background:#fff;color:#111;border-color:#fff}
</style>
<div id="demo-badge"><b>DEMO</b><a href="index.html" title="デモ一覧に戻る">ダミーデータ ・ ← デモ一覧</a>${langButtons ? '<span class="lang" role="group" aria-label="Language"><button type="button" data-lang="ja">日本語</button><button type="button" data-lang="en">EN</button></span>' : ''}</div>`;

const patch = (html, { params, dataFile, back = [], usesFirestore = true, edits = [], replaceAll = [], langButtons = true, showBadge = true }) => {
  const g = 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
  if (usesFirestore && !html.includes(g)) throw new Error('firestore import not found');
  html = html.split(g).join('./fake-firestore.js');
  // URL の初期値（本物の画面は ?event=…&panel=… を読む）
  const init = `<script>(function(){var u=new URL(location.href),d=${JSON.stringify(params)};Object.keys(d).forEach(function(k){if(!u.searchParams.has(k))u.searchParams.set(k,d[k]);});history.replaceState(null,'',u);})();</script>`;
  html = html.replace('<head>', '<head>\n  <meta name="robots" content="noindex, nofollow">\n  <link rel="icon" href="../favicon-32.png">\n  ' + init);
  // 最初に、ダミーデータを入れる
  html = html.replace(/(<script type="module">\s*)/, `$1import "./${dataFile}";\n    `);
  // デモ用の細かい変更（最初の絞り込みなど）。対象が見つからなければ、本物の画面が変わったということなので、止める
  for (const [from, to] of edits) { if (!html.includes(from)) throw new Error('edit target not found: ' + from.slice(0, 60)); html = html.replace(from, () => to); }
  for (const [from, to] of back) { if (!html.includes(from)) throw new Error('back link not found: ' + from); html = html.split(from).join(to); }
  for (const [from, to] of replaceAll) { if (!html.includes(from)) throw new Error('replaceAll target not found: ' + from); html = html.split(from).join(to); }
  return showBadge ? html.replace('</body>', badge(langButtons) + '\n</body>') : html;
};

const read = f => fs.readFileSync(path.join(PUB, f), 'utf8');
fs.mkdirSync(OUT, { recursive: true });

// 本物のファイルをそのまま使うもの
for (const f of ['shared.js', 'venue_scene.js', 'cjp_panel.css']) fs.copyFileSync(path.join(PUB, f), path.join(OUT, f));
// warmup_timer.js: サーバー時刻の測定（数秒間、同じページへ HEAD を連続で送る）は、デモでは不要なので止める
{
  const s = read('warmup_timer.js');
  const a = 'export async function syncServerClock() {\n    try {';
  if (!s.includes(a)) throw new Error('syncServerClock not found');
  fs.writeFileSync(path.join(OUT, 'warmup_timer.js'), s.replace(a, () => 'export async function syncServerClock() {\n    return;   // デモ: 測定しない（端末の時計をそのまま使う）\n    try {'));
}
// live_doc.js: 分割の既定を dual（読み書きとも大会ドキュメント1つ）にして、ダミーのメモリで素直に動かす
{
  const s = read('live_doc.js');
  if (!s.includes("export const DEFAULT_MODE = 'live';")) throw new Error('DEFAULT_MODE not found');
  fs.writeFileSync(path.join(OUT, 'live_doc.js'), s.replace("export const DEFAULT_MODE = 'live';", "export const DEFAULT_MODE = 'dual';"));
}

fs.writeFileSync(path.join(OUT, 'demo-data-display.js'), dataModule('display', displayDocs()));
fs.writeFileSync(path.join(OUT, 'demo-data-panel.js'), dataModule('panel', panelDocs()));
fs.writeFileSync(path.join(OUT, 'demo-data-cjp.js'), dataModule('cjp', cjpDocs()));
fs.writeFileSync(path.join(OUT, 'demo-data-dcalc.js'), dataModule('dcalc', { ...skillDocs }));
fs.writeFileSync(path.join(OUT, 'demo-data-entry.js'), dataModule('entry', entryDocs(), BLANK_MY_KANA));

fs.writeFileSync(path.join(OUT, 'display.html'), patch(read('display.html'), { params: { event: EVENT }, dataFile: 'demo-data-display.js' }));
fs.writeFileSync(path.join(OUT, 'entry.html'), patch(read('entry.html'), {
  params: { event: EVENT, athlete: nakata.id, round: 'final' }, dataFile: 'demo-data-entry.js',
  edits: [
    // デモ: 選手一覧のページは無いので、提出後は移動せず、「提出済み」の画面（内容を修正できる状態）にする
    ['alert("競技カードを提出しました。");\n            location.href = backListUrl;',
     `alert("競技カードを提出しました。（デモのため、どこにも登録されません）");
            lockInputs(true);
            btn.style.display = "none";
            btn.textContent = 'この内容で提出する';
            document.getElementById('modify-btn').style.display = "block";
            ['copy-prev-area', 'team-ref-area', 'past-self-area'].forEach(id => { document.getElementById(id).style.display = 'none'; });`],
    // デモ: 引用メニューの一時保存（sessionStorage）は使わない。日本語と英語のデータが混ざるうえ、
    // 同じサイトの本物の画面と保存場所が同じなので、デモの大会一覧が本物の画面に出てしまう
    ['function refCacheGet(key, ttlMs) {', 'function refCacheGet(key, ttlMs) {\n        return undefined;'],
    ['function refCacheSet(key, data) {', 'function refCacheSet(key, data) {\n        return;'],
    // デモ: 英語表示では、ふりがなの欄は使わないので隠し、空欄でも提出できるようにする
    ['if (!isSynchro && (!kana || !clubKana)) {', "if (!isSynchro && document.documentElement.lang !== 'en' && (!kana || !clubKana)) {"],
    ['</style>', '    html[lang="en"] #indiv-kana-area .info-input-row, html[lang="en"] #indiv-kana-area .input-note { display: none; }\n    </style>'],
    // 左下の「DEMO」の表示が、下のボタンに重ならないように、下に余白を足す
    ['</style>', '    body { padding-bottom: 64px !important; }\n    </style>'],
  ],
  back: [['`event.html?event=${eventId}`;', "'index.html';"]],
}));
fs.writeFileSync(path.join(OUT, 'judge_panel.html'), patch(read('judge_panel.html'), {
  params: { event: EVENT, panel: 'A', role: 'D', athlete: nextAth?.id || nakata.id, round: 'final' }, dataFile: 'demo-data-panel.js',
  edits: [["let fType = 'individual', fClass = '', fGender = '', fFinalOnly = false;", "let fType = 'individual', fClass = '', fGender = '', fFinalOnly = true;   // デモ: 最初から「決勝」の一覧"]],
  back: [['judge_role_select.html?event=${eventId}', 'index.html']],
}));
fs.writeFileSync(path.join(OUT, 'judge_cjp.html'), patch(read('judge_cjp.html'), {
  params: { event: EVENT, panel: 'A', role: 'CJP', athlete: nakata.id, round: 'final' }, dataFile: 'demo-data-cjp.js',
  edits: [["let fType = 'individual', fClass = '', fGender = '', fFinalOnly = false;", "let fType = 'individual', fClass = '', fGender = '', fFinalOnly = true;   // デモ: 最初から「決勝」の一覧"]],
  back: [['ranking.html?event=${eventId}', 'index.html#ranking-not-in-demo']],
}));
fs.writeFileSync(path.join(OUT, 'd_calc.html'), patch(read('d_calc.html'), {
  params: { event: EVENT }, dataFile: 'demo-data-dcalc.js', usesFirestore: false, langButtons: false,
  // デモの既定は英語（日本語を選んだときだけ日本語）。言語の保存名は、ほかのデモ画面（demo-i18n.js）と同じにする
  edits: [["(localStorage.getItem('dcalcLang') === 'en' ? 'en' : 'ja')", "(localStorage.getItem('dcalcLang') === 'ja' ? 'ja' : 'en')"]],
  replaceAll: [["'dcalcLang'", "'demoLang2'"]],
  back: [["`admin_menu.html?event=${eventId}`", "'index.html'"]],
}));

// ---------- 検討用: 決勝モード（study_final_mode.html から、study_final_display.html を枠の中に開く） ----------
// 本物の得点表示に「決勝モード」を入れる前に、見た目と動きを確かめるためのページ。デモ一覧からはリンクしない。
// 最後の選手（中山）の前の7人までが確定している。ページを開いて数秒後に、中山選手の結果を公開にする（CJP の「確定&表示」と同じ）。
// 決勝モードの動き（このページだけ。本物の display.html は変えない）:
//   ・決勝の個人スコア画面に、順位（RANK）を出さない（slot=center: 得点を中央に大きく / next: 順位の欄に「STANDINGS NEXT」/
//     mask: 「?」で伏せる / hide: 枠ごと消す）
//   ・順位はそのあとの順位表で初めて出る（reveal=countdown: 全員終わった決勝の順位表を、下位から1人ずつ出す /
//     reveal=insert: 確定した選手が、直前の順位表に、画面の外から割り込む。抜かれた選手は1つずつ下がる）
const lastAth = finalists[finalists.length - 1];
if (!lastAth.name1.includes('中山')) throw new Error('決勝の最後の選手が中山選手ではありません: ' + lastAth.name1);
const lastResultId = `${EVENT}_${lastAth.id}_final`;
const T1 = Date.now() - 60 * 1000 - STEP * lastAth.finalOrder;
const studyDocs = () => {
  const docs = {
    [`tournaments/${EVENT}`]: tourBase(),
    ...athletesOf(finalists),
    ...resultsOf(() => true, x => {
      delete x.displaySkip;
      if (x.round !== 'final') { x.published = true; x.publishedAt = ts(T1 - 3600 * 1000); }
      else if (x.athleteId === lastAth.id) { x.published = false; delete x.publishedAt; delete x.verifiedAt; }   // まだ確定していない
      else { x.published = true; x.publishedAt = ts(T1 + STEP * finalists.find(a => a.id === x.athleteId).finalOrder); x.verifiedAt = x.publishedAt; }
      return x;
    }),
    ...subsOf(s => s.round === 'final'),
    ...skillDocs,
  };
  if (!docs[`results/${lastResultId}`]) throw new Error('中山選手の決勝の結果が見つかりません: ' + lastResultId);
  return docs;
};
fs.writeFileSync(path.join(OUT, 'study-data-final.js'), `// 自動生成（tools/build_demo.mjs）。決勝モードの検討用のダミーデータ（日本語のみ）。
import { seed, db, doc, updateDoc, Timestamp } from "./fake-firestore.js";
const p = new URLSearchParams(location.search);
// 決勝モードの設定（本番では、画面コントロールの設定になる想定）
window.STUDY = {
  fm: p.get('fm') === '1',
  slot: ['next', 'mask', 'hide'].includes(p.get('slot')) ? p.get('slot') : 'center',
  reveal: ['countdown', 'insert'].includes(p.get('reveal')) ? p.get('reveal') : 'all',
};
const docs = ${JSON.stringify(strip(studyDocs()))};
const ds = docs["tournaments/${EVENT}"].displaySettings = { ...(docs["tournaments/${EVENT}"].displaySettings || {}) };
if (p.get('speed') === 'fast') { ds.animTotalSec = 4; ds.holdSec = 1; }
// 下位から1人ずつ出すときは、出し終わる前に順位表が描き直されないよう、ページ送りの間隔を長くする
if (window.STUDY.reveal === 'countdown') ds.rankingPageSec = Math.max(ds.rankingPageSec || 8, 20);
seed(docs);
// 中山選手の確定（CJP の「確定&表示」と同じく、結果を公開にする）
const at = Number(p.get('at') ?? 3);
setTimeout(() => {
  const now = Timestamp.now();
  updateDoc(doc(db, 'results', ${JSON.stringify(lastResultId)}), { published: true, publishedAt: now, verifiedAt: now });
}, at * 1000);
`);
fs.writeFileSync(path.join(OUT, 'study_final_display.html'), patch(read('display.html'), {
  params: { event: EVENT }, dataFile: 'study-data-final.js', showBadge: false,
  edits: [
    // 最初は、直前の選手（美田）の得点ではなく、そのあとの順位表から始める
    ["        if (_initialResultDoc && screen === 'score' && currentMode === 'idle') {\n          enqueueResult(_initialResultDoc);\n        }",
     "        if (_initialResultDoc && screen === 'score' && currentMode === 'idle') {\n          // 検討用: 直前の選手の得点は出さず、そのあとの順位表から始める\n          lastShownResData = _initialResultDoc.data(); lastShownAth = athleteMap[lastShownResData.athleteId] || {};\n          window.STUDY._revealedFor = lastShownResData.athleteId;   // 最初の順位表では、割り込みなどの演出をしない\n          startRankingLoop();\n        }"],
    // 決勝モード（slot=center）: 下の段は、得点だけを中央に大きく出す（左の FINAL は、決勝では TOTAL と同じ値なので出さない）
    ['      <div class="result-section">\n        <div class="routine-totals">${routineTotalsHTML}</div>',
     '      ${window.STUDY?.fm && resData.round === \'final\' && window.STUDY.slot === \'center\' ? `<div class="result-section st-center">\n' +
     '        <div class="st-line"></div>\n' +
     '        <div class="st-score"><label>${isPublished ? \'TOTAL\' : \'TOTAL*\'}</label><div class="total-val num">${fmt2(totalScore)}</div></div>\n' +
     '        <div class="st-line"></div>\n' +
     '      </div>` : \'\'}\n' +
     '      <div class="result-section"${window.STUDY?.fm && resData.round === \'final\' && window.STUDY.slot === \'center\' ? \' style="display:none"\' : \'\'}>\n' +
     '        <div class="routine-totals">${routineTotalsHTML}</div>'],
    // 決勝モード: 決勝の個人スコア画面に、順位を出さない（next: 「順位はこのあと」/ mask: 「?」/ hide: 枠ごと消す）
    ['          <div class="score-unit">\n            <label>RANK</label>\n            <div class="rank-val num">${rank !== null ? rank : \'--\'}</div>\n          </div>',
     '          ${window.STUDY?.fm && resData.round === \'final\'\n' +
     '            ? (window.STUDY.slot === \'mask\' ? `<div class="score-unit"><label>RANK</label><div class="rank-val num rank-mask">?</div></div>`\n' +
     '              : window.STUDY.slot === \'next\' ? `<div class="score-unit"><label>RANK</label><div class="st-next"><span>STANDINGS</span><b>NEXT ▶&#xFE0E;</b></div></div>` : \'\')\n' +
     '            : `<div class="score-unit">\n            <label>RANK</label>\n            <div class="rank-val num">${rank !== null ? rank : \'--\'}</div>\n          </div>`}'],
    // 決勝モード: 全員が終わった決勝の順位表を、下位から1人ずつ出す（1位は少し間をあけて、最後に）
    ["<div class=\"rk-footer\">SYSTEM DESIGN &amp; DEVELOPMENT BY HIROTAKA.H</div>`;\n    overlay.classList.add('visible');",
     "<div class=\"rk-footer\">SYSTEM DESIGN &amp; DEVELOPMENT BY HIROTAKA.H</div>`;\n    overlay.classList.add('visible');\n" +
     "    if (window.STUDY?.fm && window.STUDY.reveal === 'countdown' && isFinal && currentMode === 'ranking'\n" +
     "        && entries.every(e => !e || e.final !== null) && window.STUDY._revealedFor !== lastShownResData?.athleteId) {\n" +
     "      window.STUDY._revealedFor = lastShownResData?.athleteId;\n" +
     "      const rows = [...overlay.querySelectorAll('.rk-row')].filter(r => r.style.visibility !== 'hidden');\n" +
     "      rows.forEach(r => r.classList.add('st-wait'));\n" +
     "      const FIRST = 1200, STEP_MS = 1000, CHAMP_PAUSE = 2200;\n" +
     "      rows.slice().reverse().forEach((r, k) => {\n" +
     "        const champ = k === rows.length - 1;\n" +
     "        const t = FIRST + k * STEP_MS + (champ ? CHAMP_PAUSE - STEP_MS : 0);\n" +
     "        setTimeout(() => { r.classList.add('st-in'); if (champ) r.classList.add('st-champ'); }, t);\n" +
     "      });\n" +
     "    }\n" +
     // 決勝モード（reveal=insert）: 確定した選手が、直前の順位表に割り込む。
     // ① 直前の順位表（その選手の行はまだない）を出す → ② その選手が入る順位から下の選手が1つずつ下がり、すき間ができる →
     // ③ その選手の行が、画面の外（右）から、すき間に滑り込む → ④ 順位の数字が新しくなる（1位なら金色）
     "    if (window.STUDY?.fm && window.STUDY.reveal === 'insert' && isFinal && currentMode === 'ranking' && curAthId\n" +
     "        && window.STUDY._revealedFor !== curAthId) {\n" +
     "      window.STUDY._revealedFor = curAthId;\n" +
     "      const rowEls = [...overlay.querySelectorAll('.rk-row')];\n" +
     "      const curIdx = entries.findIndex(e => e && e.id === curAthId);\n" +
     "      if (curIdx >= 0) {\n" +
     "        const prev = entries.filter(e => e && e.id !== curAthId).map(e => ({ ...e }));\n" +
     "        assignRanks(prev);\n" +
     "        const prevIdx = new Map(prev.map((e, j) => [e.id, j]));\n" +
     "        const curRow = rowEls[curIdx];\n" +
     "        const newRank = new Map();\n" +
     "        const EASE = 'cubic-bezier(.65,0,.25,1)';\n" +
     "        entries.forEach((e, i) => {\n" +
     "          if (!e || e.id === curAthId) return;\n" +
     "          const r = rowEls[i], j = prevIdx.get(e.id), rk = r.querySelector('.rk-rank');\n" +
     "          newRank.set(rk, rk.textContent);\n" +
     "          if (rk.textContent !== '-') rk.textContent = prev[j].rank;\n" +
     "          if (j !== i) r.style.transform = `translateY(${rowEls[j].offsetTop - rowEls[i].offsetTop}px)`;\n" +
     "        });\n" +
     "        const curRk = curRow.querySelector('.rk-rank');\n" +
     "        newRank.set(curRk, curRk.textContent);\n" +
     "        curRk.textContent = '';\n" +
     "        const outX = curRow.getBoundingClientRect().left;\n" +
     "        curRow.style.transform = `translateX(${document.documentElement.clientWidth - outX + 20}px)`;\n" +
     "        curRow.classList.add('st-ins-lift');\n" +
     "        setTimeout(() => {\n" +
     "          rowEls.forEach(r => { if (r !== curRow && r.style.transform) { r.style.transition = `transform 800ms ${EASE}`; r.style.transform = 'translateY(0)'; } });\n" +
     "        }, 1500);\n" +
     "        setTimeout(() => {\n" +
     "          curRow.style.transition = 'transform 900ms cubic-bezier(.2,.9,.25,1)';\n" +
     "          curRow.style.transform = 'translateX(0)';\n" +
     "        }, 2600);\n" +
     "        setTimeout(() => {\n" +
     "          newRank.forEach((txt, rk) => { rk.textContent = txt; });\n" +
     "          curRow.classList.add('st-ins-pop');\n" +
     "        }, 3600);\n" +
     "        setTimeout(() => {\n" +
     "          curRow.classList.remove('st-ins-lift');\n" +
     "          if (entries[curIdx].rank === 1) curRow.classList.add('st-champ');\n" +
     "        }, 4600);\n" +
     "      }\n" +
     "    }"],
    ['  </style>',
     '    /* 検討用: 決勝モード */\n' +
     '    .rank-mask{ opacity:.3; }\n' +
     '    .result-section.st-center{ display:flex; align-items:center; gap:3cqw; }\n' +
     '    .st-center .st-line{ flex:1; height:0.25cqw; min-height:2px; background:linear-gradient(90deg, transparent, rgba(var(--gold-rgb),0.9)); }\n' +
     '    .st-center .st-line:last-child{ background:linear-gradient(90deg, rgba(var(--gold-rgb),0.9), transparent); }\n' +
     '    .st-center .st-score{ display:flex; flex-direction:column; align-items:center; }\n' +
     '    .st-center .st-score label{ font-size:1.3cqw; font-weight:900; color:var(--accent-gold); letter-spacing:0.6cqw; margin-bottom:0.3cqw; }\n' +
     '    .st-center .total-val{ font-size:10cqw; letter-spacing:-3px; text-shadow:0 0 3cqw rgba(var(--gold-rgb),0.25); }\n' +
     '    .st-next{ display:flex; flex-direction:column; justify-content:center; align-items:center; height:8.5cqw; padding:0 2.4cqw; border:2px solid rgba(var(--gold-rgb),0.55); border-radius:1cqw; color:var(--accent-gold); background:rgba(var(--gold-rgb),0.06); }\n' +
     '    .st-next span{ font-size:1.2cqw; font-weight:800; letter-spacing:0.5cqw; opacity:0.75; }\n' +
     '    .st-next b{ font-size:3.4cqw; font-weight:900; line-height:1.1; animation:stPulse 1.8s ease-in-out infinite; }\n' +
     '    @keyframes stPulse{ 0%,100%{ opacity:1; } 50%{ opacity:0.45; } }\n' +
     '    .rk-row.st-ins-pop .rk-tot{ animation:stPop 700ms ease-out; }\n' +
     '    @keyframes stPop{ 0%{ transform:scale(1.5); color:var(--accent-gold); } 100%{ transform:scale(1); } }\n' +
     '    .rk-row.st-ins-lift{ position:relative; z-index:2; background:rgba(var(--gold-rgb),0.22) !important; border-color:rgba(var(--gold-rgb),0.95) !important; box-shadow:0 0 2.4cqw rgba(var(--gold-rgb),0.45); }\n' +
     '    .rk-row.st-wait{ opacity:0; transform:translateX(-3cqw); }\n' +
     '    .rk-row.st-in{ opacity:1; transform:none; transition:opacity 500ms ease-out, transform 500ms ease-out; }\n' +
     '    .rk-row.st-champ{ background:rgba(var(--gold-rgb),0.18) !important; border-color:rgba(var(--gold-rgb),0.9) !important; box-shadow:0 0 2.4cqw rgba(var(--gold-rgb),0.35); }\n' +
     '    .rk-row.st-champ .rk-rank, .rk-row.st-champ .rk-tot{ color:var(--accent-gold); }\n' +
     '  </style>'],
  ],
}));

console.log('demo built:', { finalists: finalists.map(a => `${a.finalOrder}:${a.name1}`), nakata: nakata.id, next: nextAth?.id });
