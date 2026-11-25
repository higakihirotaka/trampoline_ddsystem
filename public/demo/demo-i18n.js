/**
 * デモの日本語 / English 切り替え。
 *
 * 本物の画面は日本語で書かれている。デモでは、画面のプログラムには手を入れず、
 *   1) データ（選手名・大学名・大会名）を、英語にして取り込み（localizeDocs）
 *   2) 画面に出る文言を、翻訳表（RULES）で英語に置き換える（MutationObserver で、あとから出る文言も）
 * ことで、英語表示にする。切り替えると、ページを読み込み直す（デモのデータは、最初の状態に戻る）。
 *
 * 言語は、URL の ?lang=en|ja → このブラウザの localStorage（demoLang）→ 日本語 の順に決まる。
 */
const KEY = 'demoLang';
const readLang = () => {
  try {
    const q = new URLSearchParams(location.search).get('lang');
    if (q === 'en' || q === 'ja') return q;
  } catch { /* 無視 */ }
  try { return localStorage.getItem(KEY) === 'en' ? 'en' : 'ja'; } catch { return 'ja'; }
};
export const lang = readLang();
export const isEn = lang === 'en';
try { localStorage.setItem(KEY, lang); } catch { /* 保存できなくても動く */ }

// ---------- ローマ字（ふりがな → Hepburn式。長音の記号は付けない） ----------
const KANA = {
  あ: 'a', い: 'i', う: 'u', え: 'e', お: 'o', か: 'ka', き: 'ki', く: 'ku', け: 'ke', こ: 'ko', さ: 'sa', し: 'shi', す: 'su', せ: 'se', そ: 'so',
  た: 'ta', ち: 'chi', つ: 'tsu', て: 'te', と: 'to', な: 'na', に: 'ni', ぬ: 'nu', ね: 'ne', の: 'no', は: 'ha', ひ: 'hi', ふ: 'fu', へ: 'he', ほ: 'ho',
  ま: 'ma', み: 'mi', む: 'mu', め: 'me', も: 'mo', や: 'ya', ゆ: 'yu', よ: 'yo', ら: 'ra', り: 'ri', る: 'ru', れ: 're', ろ: 'ro', わ: 'wa', を: 'o', ん: 'n',
  が: 'ga', ぎ: 'gi', ぐ: 'gu', げ: 'ge', ご: 'go', ざ: 'za', じ: 'ji', ず: 'zu', ぜ: 'ze', ぞ: 'zo', だ: 'da', ぢ: 'ji', づ: 'zu', で: 'de', ど: 'do',
  ば: 'ba', び: 'bi', ぶ: 'bu', べ: 'be', ぼ: 'bo', ぱ: 'pa', ぴ: 'pi', ぷ: 'pu', ぺ: 'pe', ぽ: 'po', ゔ: 'vu',
  ぁ: 'a', ぃ: 'i', ぅ: 'u', ぇ: 'e', ぉ: 'o',
};
const YOON = { き: 'ky', ぎ: 'gy', し: 'sh', じ: 'j', ち: 'ch', ぢ: 'j', に: 'ny', ひ: 'hy', び: 'by', ぴ: 'py', み: 'my', り: 'ry' };
const YOON_V = { ゃ: 'a', ゅ: 'u', ょ: 'o' };
const toHira = s => s.replace(/[ァ-ヶ]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x60));
export function romaji(kana) {
  const s = toHira(String(kana || ''));
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i], n = s[i + 1];
    if (c === 'っ') { const nx = KANA[n] || ''; out += nx.startsWith('ch') ? 't' : (nx[0] || ''); continue; }   // 促音: 次の子音を重ねる（ch は t）
    if (c === 'ー') continue;
    if (YOON[c] && YOON_V[n]) { out += YOON[c] + YOON_V[n]; i++; continue; }   // 拗音: きゃ → kya、しゅ → shu、じょ → jo
    out += KANA[c] ?? c;
  }
  // 長音（おう・おお・うう）は、記号を付けずにまとめる（例: ゆうき → Yuki、りゅうご → Ryugo）
  return out.replace(/ou/g, 'o').replace(/oo/g, 'o').replace(/uu/g, 'u');
}
const cap = w => w ? w[0].toUpperCase() + w.slice(1) : w;
/** ふりがな「せい　めい」→ "Mei SEI"（名 + 姓の大文字） */
export function nameEn(kana) {
  const parts = String(kana || '').trim().split(/[\s　]+/).filter(Boolean).map(romaji);
  if (parts.length < 2) return parts.map(cap).join(' ');
  const [family, ...given] = parts;
  return `${given.map(cap).join(' ')} ${family.toUpperCase()}`;
}

// ---------- 英語表記（大学名・大会名。大学名は、各大学・学位授与機構の英語表記） ----------
export const CLUB_EN = {
  '慶應義塾大学': 'Keio University',
  '金沢星稜大学': 'Kanazawa Seiryo University',
  '金沢学院大学': 'Kanazawa Gakuin University',
  '阪南大学': 'Hannan University',
};
const TOUR_EN = {
  name: 'The 61st All Japan Student Trampoline Championships',   // 公式の英語名は見つからなかったため、仮訳
  venue: 'Amuse Toyota, Shizuoka',
  line1: '61st', line2: 'All Japan Student Trampoline', line3: 'Championships',
};

/** ダミーデータ（seed に渡す形）を、いまの言語に合わせる。日本語のときは、そのまま返す */
export function localizeDocs(docs) {
  if (!isEn) return docs;
  const out = {};
  for (const [path, d] of Object.entries(docs)) {
    if (/^tournaments\/[^/]+$/.test(path)) {
      const t = JSON.parse(JSON.stringify(d));
      t.name = TOUR_EN.name; t.venue = TOUR_EN.venue;
      if (t.titleSettings) Object.assign(t.titleSettings, { line1: TOUR_EN.line1, line2: TOUR_EN.line2, line3: TOUR_EN.line3 });
      out[path] = t;
    } else if (/^tournaments\/[^/]+\/athletes\/[^/]+$/.test(path)) {
      const a = { ...d }, ja = String(a.name1 || '').replace(/[\s　]+/g, ' ');
      if (a.kana1) a.name1 = nameEn(a.kana1);
      a.kana1 = ja;                                       // 「(ふりがな)」の欄には、日本語の氏名を出す
      if (a.club1) { const c = CLUB_EN[a.club1]; a.clubKana1 = a.club1; if (c) a.club1 = c; }
      if (Array.isArray(a.clubNames)) a.clubNames = a.clubNames.map(c => CLUB_EN[c] || c);
      out[path] = a;
    } else out[path] = d;
  }
  return out;
}

// ---------- 画面の文言の翻訳表（日本語 → 英語）。長い順に当てはめる ----------
const SYMBOL_EN = { 'シート': 'Seat', 'ハーフシート': 'Half seat', 'フルシート': 'Full seat', 'スィーブル': 'Swivel', 'スタンド': 'Stand', 'ハーフスタンド': 'Half stand', 'ハーフピルエット': 'Half pirouette', 'フルピルエット': 'Full pirouette', 'フロントドロップ': 'Front drop', 'ハーフフロント': 'Half front', 'ハーフフロント（L）': 'Half front (L)', 'バックドロップ': 'Back drop', 'ハーフターンテーブル': 'Half turntable', 'フロント': 'Front', '1,1/2プルエット': '1 1/2 pirouette', 'ローラー': 'Roller' };
const NOTE_EN = { 'タックバウンス': 'Tuck bounce', 'パイクバウンス': 'Pike bounce', 'ストラドルバウンス': 'Straddle bounce', 'プルオーバー（L）': 'Pullover (L)', 'プルオーバー': 'Pullover', '3/4バック': '3/4 Back', '3/4フロント': '3/4 Front', 'コディ': 'Cody', '前方向': 'Forward', '後方向': 'Backward', '全日本インカレC規定専用': 'All-Japan Intercollegiate, C compulsory only' };
const RULES = [
  ...Object.entries(SYMBOL_EN), ...Object.entries(NOTE_EN),   // 大学名はデータ側で英語にしてある（（ ）の中の日本語の大学名は、そのまま残す）
  // 大会・クラス・区分
  ['第61回全日本学生トランポリン競技選手権大会', TOUR_EN.name], ['第61回', TOUR_EN.line1], ['全日本学生トランポリン', TOUR_EN.line2], ['競技選手権大会', TOUR_EN.line3],
  ['審判入力 (2画面比較)', 'Judge Input'],
  ['オープンクラス', 'Open Class'], ['Aクラス', 'Class A'], ['Bクラス', 'Class B'], ['Cクラス', 'Class C'], ['クラス', 'Class'],
  ['男子', 'Men'], ['女子', 'Women'], ['混合', 'Mixed'],
  ['シンクロナイズド', 'Synchronized'], ['シンクロ', 'Synchro'], ['個人', 'Individual'], ['団体競技', 'Team'], ['団体順位表', 'Team Standings'], ['団体', 'Team'],
  ['決勝スタートリスト', 'Final Start List'], ['決勝のみ', 'Final only'], ['決勝 FINAL', 'FINAL'], ['予選 QUALIFYING', 'QUALIFYING'], ['決勝', 'Final'], ['予選', 'Qualifying'],
  ['ラウンド', 'Round'], ['種目', 'Event'], ['性別', 'Gender'], ['全て', 'All'], ['グループ ', 'Group '],
  // 画面の上・左
  ['← ポータルに戻る', '← Back to portal'], ['← 役割選択に戻る', '← Back to role select'], ['← 入力画面へ', '← To input screen'],
  ['☰ 選手一覧', '☰ Athletes'], ['選手を選んでください', 'Select an athlete'], ['選手を選択してください', 'Select an athlete'],
  ['左のリストからラウンドを選択してください', 'Select a round from the list on the left'], ['選手データが見つかりません', 'Athlete data not found'],
  ['🏆 順位表', '🏆 Standings'], ['🎲 ダミー入力', '🎲 Dummy input'], ['🚫 棄権', '🚫 Withdraw'], ['🗑 得点削除', '🗑 Delete score'], ['✕ 終了', '✕ Exit'],
  ['📋 記録主任', '📋 Chief Recorder'], ['🔄 再読み込み', '🔄 Reload'],
  ['棄権 — 競技不参加', 'Withdrawn — did not compete'], ['棄権 — DID NOT START', 'DID NOT START'], ['棄権を取り消す', 'Cancel withdrawal'], ['棄権', 'Withdrawn'],
  // CJP
  ['入力', 'Input'], ['申請', 'Declared'], ['実施', 'Performed'], ['指定', 'Designated'], ['手動', 'Manual'], ['読込', 'Load'], ['取得中...', 'Loading...'], ['暫定', 'Provisional'],
  ['確定&表示', 'Confirm & Show'], ['確定&amp;表示', 'Confirm & Show'], ['確定のみ', 'Confirm only'], ['確定・保存', 'Confirm & Save'], ['修正を保存', 'Save revision'],
  ['CJP確定済', 'CJP confirmed'], ['D確定済', 'D confirmed'], ['未確定', 'Unconfirmed'], ['確定', 'Confirmed'], ['修正する', 'Revise'], ['修正', 'Revise'],
  ['再表示', 'Re-show'], ['集計中...', 'Calculating...'], ['集計中', 'Calculating'], ['🔍 インクワイアリ', '🔍 Inquiry'],
  ['＋ 違反を追加…', '+ Add penalty…'], ['一覧にない場合の手動加点', 'Manual penalty for items not in the list'], ['手動加点', 'Manual penalty'],
  ['服装・装飾品の違反', 'Violation of dress / jewellery'], ['規定のウォームアップ時間超過', 'Abuse of warm-up time limit'],
  ['演技開始合図後の時間超過（61〜90秒）', 'Time limit exceeded after start signal (61–90 s)'], ['演技開始合図後の時間超過（91〜120秒）', 'Time limit exceeded after start signal (91–120 s)'], ['演技開始合図後の時間超過（121〜180秒）', 'Time limit exceeded after start signal (121–180 s)'],
  ['演技中の補助員からの声かけ・合図', 'Talking / signalling by spotter'], ['演技中のコーチからの声かけ・合図', 'Talking / signalling by coach'], ['特別要求の欠如', 'Missing special requirement'], ['アウトバウンス違い', 'Out-bounce mismatch'],
  ['⌨️ H/N/S ショートカット: ON', '⌨️ H/N/S shortcuts: ON'], ['⌨️ H/N/S ショートカット: OFF', '⌨️ H/N/S shortcuts: OFF'],
  ['入力欄にフォーカスしていない時、Hキー=HDTS取得／Nキー=次の選手へ／Sキー=内訳が緑かつ未確定の時だけ確定&表示 を有効にします（このブラウザだけの設定）', 'When no input is focused: H = fetch HDTS / N = next athlete / S = Confirm & Show (only when the breakdown is green and unconfirmed). This setting is per browser.'],
  // D審判
  ['選手申告', 'Declared'], ['系統', 'Direction'], ['宙系', 'Somersault'], ['記号', 'Symbol'], ['前方系', 'Forward'], ['後方系', 'Backward'], ['基礎技', 'Basic'], ['前方', 'Fwd'], ['後方', 'Bwd'], ['基礎', 'Basic'],
  ['--（全て）', '-- (All)'], ['スタンドから', 'From feet'], ['腰から', 'From seat'], ['腹から', 'From front'], ['背から', 'From back'],
  ['1.5以下', '≤ 1.5'], ['1.6以上', '≥ 1.6'], ['1回宙系', '1 somersault'], ['2回宙系', '2 somersaults'], ['3回宙系', '3 somersaults'], ['4回宙系', '4 somersaults'],
  ['1回宙', '1 somersault'], ['2回宙', '2 somersaults'], ['3回宙', '3 somersaults'], ['4回宙', '4 somersaults'],
  ['選択してください', 'Select'], ['選択', 'Select'], ['有効本数 (CJP設定)', 'Valid skills (set by CJP)'], ['有効本数', 'Valid skills'],
  ['合計難度点（DD）', 'Total difficulty (DD)'], ['合計DD', 'Total DD'], ['難度制限（参考）', 'Difficulty limit (reference)'], ['難度下限', 'Min. difficulty'],
  ['⚠ 選手未申告', '⚠ Not declared'], ['📥 申請種目を取得', '📥 Load declared skills'],
  ['🔒 CJPが確定済のため修正できません', '🔒 Locked: already confirmed by CJP'], ['⚠ 難度上限超過（失格）', '⚠ Difficulty cap exceeded (disqualified)'], ['⚠ 難度下限未満', '⚠ Below minimum difficulty'],
  ['選手の申請種目をD入力欄に取り込みます。CJPがDなしで確定する等で空欄になった場合の救済用です。', "Loads the athlete's declared skills into the D input. For recovery when it was left empty, e.g. the CJP confirmed without a D score."],
  ['現在のD入力を、選手の申請種目で上書きします。よろしいですか？', "Overwrite the current D input with the athlete's declared skills?"],
  ['この選手の申請種目データがありません。', 'No declared skills for this athlete.'],
  ['合計難度点を入力してから保存してください。', 'Enter the total difficulty before saving.'],
  ['CJPが確定済みのため取得できません。\nCJP側で確定を解除してください。', 'Cannot load: the CJP has already confirmed. Unlock it on the CJP side first.'],
  ['読み込みエラー', 'Load error'], ['データを読み込んでいます...', 'Loading data...'], ['大会データが見つかりません', 'Tournament data not found'],
  ['ネットワーク接続に時間がかかっています', 'The network is slow'], ['データの読み込みに失敗しました', 'Failed to load data'],
  // 会場ディスプレイ
  ['表彰式', 'Award Ceremony'], ['会場練習', 'Warm-up'], ['選手紹介', 'Athlete Introduction'], ['出場選手', 'Starting Athletes'], ['残り時間', 'Time left'],
  ['得点集計中', 'Calculating score'], ['得点問い合わせ確認中', 'Score inquiry under review'], ['得点・順位が変更になる可能性があります', 'Scores and rankings may change'],
  ['スタートリストが登録されていません', 'No start list registered'], ['この区分の登録チームがありません', 'No teams registered in this category'],
  // 競技カードの提出
  ['競技カード入力', 'Competition Card'], ['所属', 'Team'],
  ['⚠️ 選択肢にない技やシステムの計算がおかしいなどがある場合は、大会開始までに審判席にお越しください。', "⚠️ If a skill is missing or a calculation looks wrong, please come to the judges' desk before the competition starts."],
  ['⚠ 技リストの読み込みに失敗しました（通信環境をご確認ください）。すでに入力・提出した内容は消えていません。表示できるまで再読み込みしてください。', '⚠ Failed to load the skill list. Please check your connection and reload. Your saved entries are not lost.'],
  ['基礎点：', 'Base: '], ['ボーナス点：', 'Bonus: '], ['技名', 'Skill'],
  ['この内容で提出する', 'Submit this card'], ['内容を修正する', 'Edit card'], ['一覧に戻る', 'Back to list'], ['送信中...', 'Submitting...'],
  ['📋 予選演技をコピーする', '📋 Copy my qualifying routine'], ['👥 同じチームの選手の構成を読込', "👥 Load a teammate's routine"], ['📅 過去の自分の構成を取得', '📅 Load my past routine'],
  ['選手・ラウンドを選択...', 'Select athlete / round...'], ['大会・ラウンドを選択...', 'Select competition / round...'], ['該当者なし', 'None found'],
  ['読み込み中...', 'Loading...'], ['読込中...', 'Loading...'], [' ー ', ' – '], ['予選１', 'Qualifying 1'], ['予選1', 'Qualifying 1'], ['予選2', 'Qualifying 2'],
  ['競技カードを提出しました。（デモのため、どこにも登録されません）', 'Your competition card has been submitted. (Demo: nothing is saved.)'],
  ['引用する選手・ラウンドを選択してください。', 'Select an athlete and round to load.'], ['取得する大会・ラウンドを選択してください。', 'Select a competition and round to load.'],
  ['選択した構成をこの画面に読み込みます。現在の入力内容は上書きされます。よろしいですか？', 'Load the selected routine? Your current input will be overwritten.'],
  ['予選演技をこの画面にコピーします。現在の入力内容は上書きされます。よろしいですか？', 'Copy your qualifying routine? Your current input will be overwritten.'],
  // デモの共通部品
  ['ダミーデータ ・ ← デモ一覧', 'Dummy data · ← Demo list'], ['デモ一覧に戻る', 'Back to demo list'],
  // 記号
  ['（', ' ('], ['）', ')'],
];
// 競技カード（スマートフォンの幅）は、選択欄がせまいので、短い言い方にする
const PAGE_RULES = {
  'entry.html': { '前方系': 'Front', '後方系': 'Back', '1回宙系': 'Single', '2回宙系': 'Double', '3回宙系': 'Triple', '4回宙系': 'Quad' },
};
const page = location.pathname.split('/').pop() || 'index.html';
const TEXT_RULES = Object.entries({ ...Object.fromEntries(RULES), ...PAGE_RULES[page] }).sort((a, b) => b[0].length - a[0].length);
const REGEX_RULES = [
  [/技 (\d+) が選択されていません。/g, 'Skill $1 is not selected.'],
  [/(\d+)本目の技が未選択です。すべての技を選択してから保存してください。/g, 'Skill $1 is not selected. Select all skills before saving.'],
  [/試技順(\d+)番/g, 'Start order $1'],
  [/(\d+)本(?!目)/g, '$1 skills'],
];
const JP = /[぀-ヿ㐀-鿿]/;
export function tr(s) {
  if (!isEn || typeof s !== 'string' || !JP.test(s)) return s;
  let o = s;
  for (const [re, en] of REGEX_RULES) o = o.replace(re, en);
  for (const [ja, en] of TEXT_RULES) if (o.includes(ja)) o = o.split(ja).join(en);
  return o.replace(/ {2,}/g, ' ').replace(/\( /g, '(');
}

// ---------- 画面への適用 ----------
const ATTRS = ['title', 'placeholder', 'aria-label', 'alt'];
const SKIP = new Set(['SCRIPT', 'STYLE', 'TEXTAREA']);
function trTextNode(n) {
  if (n.parentElement && SKIP.has(n.parentElement.tagName)) return;
  const v = n.nodeValue; if (!JP.test(v)) return;
  const t = tr(v); if (t !== v) n.nodeValue = t;
}
function trElementAttrs(el) {
  for (const a of ATTRS) { const v = el.getAttribute && el.getAttribute(a); if (v && JP.test(v)) { const t = tr(v); if (t !== v) el.setAttribute(a, t); } }
}
function walk(root) {
  if (root.nodeType === 3) return trTextNode(root);
  if (root.nodeType !== 1) return;
  if (SKIP.has(root.tagName)) return;
  trElementAttrs(root);
  const w = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
  let n; while ((n = w.nextNode())) { if (n.nodeType === 3) trTextNode(n); else if (!SKIP.has(n.tagName)) trElementAttrs(n); }
}

/** 英語表示のとき、画面の日本語を英語にする。skipPage: 画面に独自の言語切り替えがある（D計算）ので、デモの部品だけ翻訳する */
function startTranslator(skipPage) {
  document.documentElement.lang = isEn ? 'en' : 'ja';
  if (!isEn) return;
  const fixTitle = () => { if (!skipPage && JP.test(document.title)) document.title = tr(document.title); };
  const obs = new MutationObserver(muts => {
    for (const m of muts) {
      if (m.type === 'characterData') trTextNode(m.target);
      else if (m.type === 'attributes') trElementAttrs(m.target);
      else m.addedNodes.forEach(walk);
    }
    fixTitle();
  });
  const run = () => {
    const target = skipPage ? document.getElementById('demo-badge') : document;   // D計算は、画面が自前で切り替える。デモの部品（右下のバッジ）だけ翻訳する
    if (!target) return;
    walk(skipPage ? target : document.body); fixTitle();
    obs.observe(target, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run); else run();
  // alert / confirm / prompt の文言も英語に
  for (const k of ['alert', 'confirm', 'prompt']) { const f = window[k]; window[k] = (m, ...r) => f.call(window, tr(String(m ?? '')), ...r); }
}

/** 言語の切り替えボタン（[data-lang]）。押すと、言語を覚えて、読み込み直す */
function bindToggle() {
  const setup = () => {
    document.querySelectorAll('[data-lang]').forEach(b => {
      b.setAttribute('aria-pressed', String(b.dataset.lang === lang));
      b.addEventListener('click', () => {
        const l = b.dataset.lang; if (l === lang) return;
        try { localStorage.setItem(KEY, l); } catch { /* 無視 */ }
        const u = new URL(location.href); u.searchParams.set('lang', l); location.replace(u);
      });
    });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', setup); else setup();
}

/** 一覧ページ用: data-en（文言）・data-en-html（HTML）・data-en-title（ページ名）を、英語表示のときに差し替える */
function startStaticPage() {
  document.documentElement.lang = isEn ? 'en' : 'ja';
  const run = () => {
    if (isEn) {
      document.querySelectorAll('[data-en]').forEach(el => { el.textContent = el.dataset.en; });
      document.querySelectorAll('[data-en-html]').forEach(el => { el.innerHTML = el.dataset.enHtml; });
      const t = document.documentElement.dataset.enTitle; if (t) document.title = t;
    }
    // 各画面へのリンクに、いまの言語を引き継ぐ
    document.querySelectorAll('a[href$=".html"]').forEach(a => { a.href = a.getAttribute('href') + '?lang=' + lang; });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run); else run();
}

if (page === 'index.html' || page === '') startStaticPage();
else startTranslator(page === 'd_calc.html');
bindToggle();
