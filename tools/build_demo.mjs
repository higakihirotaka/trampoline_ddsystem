// デモページ（public/demo/）を作る。本物の画面（display / judge_panel / judge_cjp / d_calc）を、
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

const strip = o => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
const dataModule = (name, docs) => `// 自動生成（tools/build_demo.mjs）。本番の大会データをもとにした、デモ用のダミーデータ。
import { seed } from "./fake-firestore.js";
import { localizeDocs } from "./demo-i18n.js";   // 英語表示のときは、選手名（ローマ字）・大学名・大会名を英語にして取り込む
seed(localizeDocs(${JSON.stringify(strip(docs))}));
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

const patch = (html, { params, dataFile, back = [], usesFirestore = true, edits = [], replaceAll = [], langButtons = true }) => {
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
  return html.replace('</body>', badge(langButtons) + '\n</body>');
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

fs.writeFileSync(path.join(OUT, 'display.html'), patch(read('display.html'), { params: { event: EVENT }, dataFile: 'demo-data-display.js' }));
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
  replaceAll: [["'dcalcLang'", "'demoLang'"]],
  back: [["`admin_menu.html?event=${eventId}`", "'index.html'"]],
}));

console.log('demo built:', { finalists: finalists.map(a => `${a.finalOrder}:${a.name1}`), nakata: nakata.id, next: nextAth?.id });
