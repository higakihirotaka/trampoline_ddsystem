// テスト共通: HTML内の <script> に書かれた関数を、そのページを一切変更せずに取り出してテストするための補助。
// （共通化が済んだ関数は shared.js から直接 import するので、これを使うのは過渡的な対象だけ）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const PUBLIC = path.join(ROOT, 'public');

/**
 * public/<file> の中から `function name(...) { ... }` を取り出して、関数として返す。
 * 波括弧の対応で関数の終わりを決める（文字列・コメント内の波括弧は想定しない単純な実装）。
 * 取り出した関数が外部の変数に依存する場合は deps に渡す。
 */
export function extractFunction(file, name, deps = {}) {
  const src = fs.readFileSync(path.join(PUBLIC, file), 'utf8').replace(/\r\n/g, '\n');
  const m = new RegExp(`(?:async\\s+)?function\\s+${name}\\s*\\(`).exec(src);
  if (!m) throw new Error(`${file} に function ${name} が見つかりません`);
  const open = src.indexOf('{', m.index + m[0].length);
  let depth = 0, end = -1;
  for (let j = open; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}' && --depth === 0) { end = j + 1; break; }
  }
  if (end < 0) throw new Error(`${name} の終わりが見つかりません`);
  const code = src.slice(m.index, end);
  const names = Object.keys(deps);
  return new Function(...names, `${code}\nreturn ${name};`)(...names.map(k => deps[k]));
}

/**
 * public/ の ES モジュール（import を持たない自己完結のもの）を読み込む。
 * package.json が commonjs のため .js を直接 import できないので、ソースを data: URL 経由で読み込む。
 */
export async function loadEsm(file) {
  const src = fs.readFileSync(path.join(PUBLIC, file), 'utf8');
  return import('data:text/javascript;base64,' + Buffer.from(src, 'utf8').toString('base64'));
}
