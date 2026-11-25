/**
 * デモ用の Firestore（ブラウザの中のメモリだけで動く、ダミーの実装）。
 *
 * 本物の画面（得点表示・D審判・CJP）は、Firestore の関数（doc / getDocs / onSnapshot / setDoc …）を使って動いている。
 * デモでは、その関数を、このファイルのものに差し替える。画面のプログラムは本物のまま動き、
 * データだけが、ここに入れたダミーデータになる。どこにも接続せず、何も保存しない（再読み込みで元に戻る）。
 *
 * 対応している範囲: 画面が使うものだけ（doc / collection / query / where / orderBy / limit / getDoc / getDocs /
 * onSnapshot / setDoc（merge）/ updateDoc（ドット区切りのフィールド）/ addDoc / deleteDoc / writeBatch / serverTimestamp / deleteField / increment）。
 */

export class Timestamp {
  constructor(ms) { this._ms = ms; }
  get seconds() { return Math.floor(this._ms / 1000); }
  get nanoseconds() { return (this._ms % 1000) * 1e6; }
  toMillis() { return this._ms; }
  toDate() { return new Date(this._ms); }
  valueOf() { return this._ms; }
  isEqual(o) { return !!o && o._ms === this._ms; }
  static now() { return new Timestamp(Date.now()); }
  static fromMillis(ms) { return new Timestamp(ms); }
}

const SERVER_TS = { __sentinel: 'serverTimestamp' };
const DELETE = { __sentinel: 'deleteField' };
export const serverTimestamp = () => SERVER_TS;
export const deleteField = () => DELETE;
export const increment = n => ({ __sentinel: 'increment', n });

export const db = { __fake: true };

const isSentinel = v => v && typeof v === 'object' && '__sentinel' in v;
const isPlain = v => v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Timestamp) && !isSentinel(v);

const clone = v => {
  if (v instanceof Timestamp) return v;
  if (Array.isArray(v)) return v.map(clone);
  if (isPlain(v)) { const o = {}; for (const k of Object.keys(v)) o[k] = clone(v[k]); return o; }
  return v;
};

/** 保存用のデータに含まれる {__ts: ミリ秒} を Timestamp にする（ダミーデータの取り込み用） */
const revive = v => {
  if (Array.isArray(v)) return v.map(revive);
  if (isPlain(v)) {
    if (Object.keys(v).length === 1 && typeof v.__ts === 'number') return new Timestamp(v.__ts);
    const o = {}; for (const k of Object.keys(v)) o[k] = revive(v[k]); return o;
  }
  return v;
};

// ---------- ストア ----------
const store = new Map();               // path -> data
const docListeners = new Map();        // path -> Set<fn>
const queryListeners = new Set();      // { q, cb, prev: Map<id, json> }

/** ダミーデータを入れる: { 'tournaments/x': {...}, 'results/y': {...} } */
export function seed(docs) {
  for (const [path, data] of Object.entries(docs)) store.set(path, revive(data));
}

// ---------- 参照 ----------
const segs = path => path.split('/');
export function collection(parent, ...rest) {
  const base = parent && parent.__type === 'doc' ? parent.path : '';
  const path = [base, ...rest].filter(Boolean).join('/');
  return { __type: 'collection', path, id: segs(path).pop() };
}
export function doc(parent, ...rest) {
  let path;
  if (parent && parent.__type === 'collection') path = [parent.path, ...rest].join('/');
  else if (parent && parent.__type === 'doc') path = [parent.path, ...rest].join('/');
  else path = rest.join('/');
  return { __type: 'doc', path, id: segs(path).pop() };
}

// ---------- クエリ ----------
export const where = (field, op, value) => ({ __c: 'where', field, op, value });
export const orderBy = (field, dir = 'asc') => ({ __c: 'orderBy', field, dir });
export const limit = n => ({ __c: 'limit', n });
export const query = (coll, ...constraints) => ({ __type: 'query', path: coll.path, constraints });

const getField = (data, path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), data);
const cmpVal = v => (v instanceof Timestamp ? v.toMillis() : v);
function matches(data, c) {
  const a = cmpVal(getField(data, c.field)), b = cmpVal(c.value);
  switch (c.op) {
    case '==': return a === b;
    case '!=': return a !== b;
    case '<': return a < b;
    case '<=': return a <= b;
    case '>': return a > b;
    case '>=': return a >= b;
    case 'in': return Array.isArray(c.value) && c.value.map(cmpVal).includes(a);
    case 'array-contains': return Array.isArray(getField(data, c.field)) && getField(data, c.field).includes(c.value);
    default: return false;
  }
}
function docsOf(ref) {
  const collPath = ref.path, depth = segs(collPath).length + 1;
  let rows = [...store.entries()].filter(([p]) => p.startsWith(collPath + '/') && segs(p).length === depth)
    .map(([p, data]) => ({ path: p, id: segs(p).pop(), data }));
  for (const c of ref.constraints || []) {
    if (c.__c === 'where') rows = rows.filter(r => matches(r.data, c));
  }
  for (const c of [...(ref.constraints || [])].reverse()) {
    if (c.__c === 'orderBy') {
      const dir = c.dir === 'desc' ? -1 : 1;
      rows = rows.filter(r => getField(r.data, c.field) !== undefined)
        .sort((x, y) => { const a = cmpVal(getField(x.data, c.field)), b = cmpVal(getField(y.data, c.field)); return a < b ? -dir : a > b ? dir : 0; });
    }
  }
  for (const c of ref.constraints || []) if (c.__c === 'limit') rows = rows.slice(0, c.n);
  return rows;
}

// ---------- スナップショット ----------
class DocSnap {
  constructor(path, data) { this.ref = { __type: 'doc', path, id: segs(path).pop() }; this.id = this.ref.id; this._d = data; this.metadata = { fromCache: false, hasPendingWrites: false }; }
  exists() { return this._d !== undefined; }
  data() { return this._d === undefined ? undefined : clone(this._d); }
  get(field) { return this._d === undefined ? undefined : clone(getField(this._d, field)); }
}
class QuerySnap {
  constructor(rows, changes) {
    this.docs = rows.map(r => new DocSnap(r.path, r.data));
    this.size = this.docs.length; this.empty = this.size === 0;
    this._changes = changes; this.metadata = { fromCache: false, hasPendingWrites: false };
  }
  forEach(fn) { this.docs.forEach(fn); }
  docChanges() { return this._changes || []; }
}

const asQuery = ref => (ref.__type === 'collection' ? { __type: 'query', path: ref.path, constraints: [] } : ref);

export const getDoc = async ref => new DocSnap(ref.path, store.get(ref.path));
export const getDocFromServer = getDoc;
export const getDocs = async ref => { const rows = docsOf(asQuery(ref)); return new QuerySnap(rows, rows.map((r, i) => ({ type: 'added', doc: new DocSnap(r.path, r.data), oldIndex: -1, newIndex: i }))); };

export function onSnapshot(ref, cb, errCb) {
  if (typeof cb !== 'function') { cb = errCb; errCb = arguments[3]; }   // onSnapshot(ref, options, cb)
  if (ref.__type === 'doc') {
    const fn = () => cb(new DocSnap(ref.path, store.get(ref.path)));
    if (!docListeners.has(ref.path)) docListeners.set(ref.path, new Set());
    docListeners.get(ref.path).add(fn);
    queueMicrotask(fn);
    return () => docListeners.get(ref.path)?.delete(fn);
  }
  const L = { q: asQuery(ref), cb, prev: new Map() };
  queryListeners.add(L);
  const fire = () => {
    const rows = docsOf(L.q), cur = new Map(rows.map(r => [r.id, JSON.stringify(r.data)])), changes = [];
    rows.forEach((r, i) => {
      const was = L.prev.get(r.id);
      if (was === undefined) changes.push({ type: 'added', doc: new DocSnap(r.path, r.data), oldIndex: -1, newIndex: i });
      else if (was !== cur.get(r.id)) changes.push({ type: 'modified', doc: new DocSnap(r.path, r.data), oldIndex: i, newIndex: i });
    });
    for (const [id] of L.prev) if (!cur.has(id)) changes.push({ type: 'removed', doc: new DocSnap(L.q.path + '/' + id, {}), oldIndex: 0, newIndex: -1 });
    const first = L.prev.size === 0 && !L.started;
    if (!first && !changes.length) return;
    L.started = true; L.prev = cur;
    L.cb(new QuerySnap(rows, changes));
  };
  L.fire = fire;
  queueMicrotask(fire);
  return () => queryListeners.delete(L);
}

// ---------- 書込 ----------
function resolveValue(v, existing) {
  if (isSentinel(v)) {
    if (v.__sentinel === 'serverTimestamp') return new Timestamp(Date.now());
    if (v.__sentinel === 'increment') return (typeof existing === 'number' ? existing : 0) + v.n;
    return undefined;   // deleteField
  }
  if (Array.isArray(v)) return v.map(x => resolveValue(x));
  if (isPlain(v)) { const o = {}; for (const k of Object.keys(v)) { const r = resolveValue(v[k], undefined); if (r !== undefined) o[k] = r; } return o; }
  return v;
}
function deepMerge(base, data) {
  const out = clone(base) || {};
  for (const k of Object.keys(data)) {
    const v = data[k];
    if (isSentinel(v)) { const r = resolveValue(v, out[k]); if (r === undefined) delete out[k]; else out[k] = r; }
    else if (isPlain(v)) out[k] = deepMerge(isPlain(out[k]) ? out[k] : {}, v);
    else out[k] = resolveValue(v, out[k]);
  }
  return out;
}
function setPath(obj, path, v) {
  const parts = path.split('.'); let o = obj;
  for (let i = 0; i < parts.length - 1; i++) { if (!isPlain(o[parts[i]])) o[parts[i]] = {}; o = o[parts[i]]; }
  const last = parts[parts.length - 1], r = resolveValue(v, o[last]);
  if (r === undefined) delete o[last]; else o[last] = r;
}

function commit(path, next) {
  // 値が変わらない書き込みでは、監視（onSnapshot）を呼ばない（本物の Firestore と同じ。呼ぶと、書込→監視→書込…の繰り返しになる）
  if (JSON.stringify(store.get(path)) === JSON.stringify(next)) return;
  if (next === undefined) store.delete(path); else store.set(path, next);
  queueMicrotask(() => {
    docListeners.get(path)?.forEach(fn => fn());
    const parent = segs(path).slice(0, -1).join('/');
    queryListeners.forEach(L => { if (L.q.path === parent) L.fire(); });
  });
}

export async function setDoc(ref, data, opts) {
  const base = store.get(ref.path);
  commit(ref.path, opts && opts.merge && base ? deepMerge(base, data) : deepMerge({}, data));
}
export async function updateDoc(ref, data) {
  const base = store.get(ref.path);
  if (!base) { const e = new Error('No document to update'); e.code = 'not-found'; throw e; }
  const next = clone(base);
  for (const [k, v] of Object.entries(data)) setPath(next, k, v);
  commit(ref.path, next);
}
export async function deleteDoc(ref) { commit(ref.path, undefined); }
let autoId = 0;
export async function addDoc(coll, data) { const ref = doc(coll, 'auto' + (++autoId)); await setDoc(ref, data); return ref; }
export function writeBatch() {
  const ops = [];
  return {
    set: (ref, data, opts) => { ops.push(() => setDoc(ref, data, opts)); },
    update: (ref, data) => { ops.push(() => updateDoc(ref, data)); },
    delete: ref => { ops.push(() => deleteDoc(ref)); },
    commit: async () => { for (const op of ops) await op(); },
  };
}
