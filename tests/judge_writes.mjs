// 審判の入力画面（ログインなし）が results に書き込む項目を、画面のソースから洗い出す補助。
// firestore.rules の judgeKeys()（ログインなしで書いてよい項目）と照合するテストで使う。
import fs from 'node:fs';
import path from 'node:path';
import { PUBLIC, ROOT } from './helpers.mjs';

/** firestore.rules の judgeKeys() に書かれた項目名の一覧 */
export function readJudgeKeys() {
  const rules = fs.readFileSync(path.join(ROOT, 'firestore.rules'), 'utf8');
  const m = /function\s+judgeKeys\s*\(\s*\)\s*\{\s*return\s*\[([^\]]*)\]/.exec(rules);
  if (!m) throw new Error('firestore.rules に judgeKeys() が見つかりません');
  return [...m[1].matchAll(/'([^']+)'|"([^"]+)"/g)].map(x => x[1] ?? x[2]);
}

// ---- 簡易の JS 構文走査（文字列・テンプレート・コメントの中の記号を無視して、括弧の対応を取る） ----
function skipString(src, i) {
  const q = src[i];
  for (let j = i + 1; j < src.length; j++) {
    if (src[j] === '\\') { j++; continue; }
    if (q === '`' && src[j] === '$' && src[j + 1] === '{') { j = matchClose(src, j + 1) ; continue; }
    if (src[j] === q) return j;
  }
  throw new Error('文字列の終わりが見つかりません');
}
function matchClose(src, openIdx) {
  const open = src[openIdx], close = { '(': ')', '{': '}', '[': ']' }[open];
  let depth = 0;
  for (let i = openIdx; i < src.length; i++) {
    const c = src[i];
    if (c === '"' || c === "'" || c === '`') { i = skipString(src, i); continue; }
    if (c === '/' && src[i + 1] === '/') { i = src.indexOf('\n', i); if (i < 0) break; continue; }
    if (c === '/' && src[i + 1] === '*') { i = src.indexOf('*/', i) + 1; continue; }
    if (c === '(' || c === '{' || c === '[') depth++;
    else if (c === ')' || c === '}' || c === ']') { if (--depth === 0) return i; }
  }
  throw new Error(`${open} に対応する括弧が見つかりません`);
}
/** 括弧の外側（深さ0）のカンマで分割する */
function splitTop(src) {
  const parts = []; let last = 0;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === '"' || c === "'" || c === '`') { i = skipString(src, i); continue; }
    if (c === '/' && src[i + 1] === '/') { i = src.indexOf('\n', i); if (i < 0) break; continue; }
    if (c === '/' && src[i + 1] === '*') { i = src.indexOf('*/', i) + 1; continue; }
    if (c === '(' || c === '{' || c === '[') { i = matchClose(src, i); continue; }
    if (c === ',') { parts.push(src.slice(last, i)); last = i + 1; }
  }
  parts.push(src.slice(last));
  return parts.map(s => s.trim()).filter(Boolean);
}

/** オブジェクトリテラル `{ ... }` の最上位のキー名。計算キー・スプレッドは判定不能として '<unknown>' を返す */
export function objectKeys(objSrc) {
  const body = objSrc.trim().slice(1, -1);
  return splitTop(body).map(part => {
    if (part.startsWith('...') || part.startsWith('[')) return '<unknown>';
    const m = /^(?:'([^']+)'|"([^"]+)"|([A-Za-z_$][\w$]*))\s*(?::|$)/.exec(part);
    return m ? (m[1] ?? m[2] ?? m[3]) : '<unknown>';
  });
}

/** 式の中の、最上位にあるオブジェクトリテラルをすべて返す（三項演算子の両側など） */
function topObjectLiterals(expr) {
  const out = [];
  for (let i = 0; i < expr.length; i++) {
    const c = expr[i];
    if (c === '"' || c === "'" || c === '`') { i = skipString(expr, i); continue; }
    if (c === '(' || c === '[') { i = matchClose(expr, i); continue; }
    if (c === '{') { const e = matchClose(expr, i); out.push(expr.slice(i, e + 1)); i = e; }
  }
  return out;
}

/**
 * public/<file> の中の、results ドキュメントへの setDoc / updateDoc 呼び出しを探し、
 * 書き込むデータの最上位キーを返す。 [{ line, keys:[...] }]
 */
export function findResultsWrites(file) {
  const src = fs.readFileSync(path.join(PUBLIC, file), 'utf8').replace(/\r\n/g, '\n');
  const writes = [];
  const re = /\b(setDoc|updateDoc)\(\s*doc\(\s*db\s*,\s*(['"])results\2/g;
  let m;
  while ((m = re.exec(src))) {
    const open = src.indexOf('(', m.index);
    const close = matchClose(src, open);
    const args = splitTop(src.slice(open + 1, close));
    const data = args[1] ?? '';
    let literals;
    if (data.startsWith('{')) literals = [data];
    else if (/^[A-Za-z_$][\w$]*$/.test(data)) {
      // 変数で渡している場合は、その変数の定義式（const/let name = ...;）の中のオブジェクトリテラルを見る
      const def = new RegExp(`\\b(?:const|let|var)\\s+${data}\\s*=`).exec(src.slice(0, m.index));
      if (!def) throw new Error(`${file}: 変数 ${data} の定義が見つかりません`);
      const from = def.index + def[0].length;
      let end = from;
      for (; end < src.length; end++) {
        const c = src[end];
        if (c === '"' || c === "'" || c === '`') { end = skipString(src, end); continue; }
        if (c === '(' || c === '{' || c === '[') { end = matchClose(src, end); continue; }
        if (c === ';') break;
      }
      literals = topObjectLiterals(src.slice(from, end));
    } else throw new Error(`${file}: 書き込みデータの形式を解析できません: ${data.slice(0, 40)}`);
    if (!literals.length) throw new Error(`${file}: 書き込みデータのオブジェクトが見つかりません`);
    const line = src.slice(0, m.index).split('\n').length;
    writes.push({ line, keys: [...new Set(literals.flatMap(objectKeys))] });
  }
  return writes;
}

/** public/*.html のうち、results に setDoc/updateDoc するページと、管理者ログイン（auth.js）を使うかどうか */
export function listResultsWriterPages() {
  return fs.readdirSync(PUBLIC).filter(f => f.endsWith('.html')).map(f => {
    const src = fs.readFileSync(path.join(PUBLIC, f), 'utf8');
    const writes = /\b(setDoc|updateDoc|deleteDoc)\(\s*doc\(\s*db\s*,\s*['"]results['"]/.test(src);
    const admin = /from\s+["']\.\/auth\.js["']/.test(src);
    return { file: f, writes, admin };
  }).filter(p => p.writes);
}
