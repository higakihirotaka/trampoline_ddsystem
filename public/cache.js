/**
 * Firestore キャッシュモジュール
 *
 * 大会情報 (tournaments/{id}) と選手リスト (athletes サブコレクション) を
 * 2層構造でキャッシュする。
 *   1st: in-memory Map  — ページセッション内で即時返却
 *   2nd: sessionStorage  — 同タブ内のページ遷移をまたいで再利用（10分TTL）
 *
 * 審判間リアルタイム通信 (liveState / submissions) は対象外。
 */
import { db } from "./firebase-config.js";
import { doc, getDoc, getDocs, collection }
    from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const SS_PREFIX = 'tsc:';
const SS_TTL    = 10 * 60 * 1000;   // 10 分

const _mem = new Map();

// ─── sessionStorage helpers ───────────────────────────────────────────────────
function ssGet(key) {
    try {
        const raw = sessionStorage.getItem(SS_PREFIX + key);
        if (!raw) return undefined;
        const { data, ts } = JSON.parse(raw);
        if (Date.now() - ts > SS_TTL) {
            sessionStorage.removeItem(SS_PREFIX + key);
            return undefined;
        }
        return data;
    } catch { return undefined; }
}
function ssSet(key, data) {
    try {
        sessionStorage.setItem(SS_PREFIX + key, JSON.stringify({ data, ts: Date.now() }));
    } catch { /* quota exceeded など無視 */ }
}
function ssDel(key) {
    try { sessionStorage.removeItem(SS_PREFIX + key); } catch {}
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * tournaments/{eventId} ドキュメントを取得（キャッシュあり）
 * @param {string} eventId
 * @returns {Object|null}  data オブジェクト。存在しない場合は null。
 */
export async function getTournament(eventId) {
    const key = `tour:${eventId}`;
    if (_mem.has(key)) return _mem.get(key);
    const ss = ssGet(key);
    if (ss !== undefined) { _mem.set(key, ss); return ss; }

    const snap = await getDoc(doc(db, 'tournaments', eventId));
    const data = snap.exists() ? snap.data() : null;
    _mem.set(key, data);
    ssSet(key, data);
    return data;
}

/**
 * athletes サブコレクションを取得（キャッシュあり）
 * @param {string} eventId
 * @returns {Array<{id: string, [key: string]: any}>}
 */
export async function getAthletes(eventId) {
    const key = `ath:${eventId}`;
    // 空配列のキャッシュは無視して再取得する（読込タイミングで0件が返ったものを
    // ロックすると、選手名が引けずIDにフォールバックし続けるため）
    const mem = _mem.get(key);
    if (mem && mem.length > 0) return mem;
    const ss = ssGet(key);
    if (ss !== undefined && ss.length > 0) { _mem.set(key, ss); return ss; }

    const snap = await getDocs(collection(db, 'tournaments', eventId, 'athletes'));
    // finalOrder / isInFinal は試技順変更で頻繁に更新されるためキャッシュ除外
    const data = snap.docs.map(d => {
        const { finalOrder, isInFinal, ...stable } = { id: d.id, ...d.data() };
        return stable;
    });
    // 空はキャッシュしない（次回また取得を試みる）
    if (data.length > 0) { _mem.set(key, data); ssSet(key, data); }
    return data;
}

/**
 * 決勝試技順を取得（キャッシュなし、毎回 Firestore から取得）
 * 管理者が試技順を変更した場合でも常に最新値を返す。
 * @param {string} eventId
 * @returns {Object<string, {finalOrder: number|null, isInFinal: boolean}>}
 */
export async function getFinalOrders(eventId) {
    const snap = await getDocs(collection(db, 'tournaments', eventId, 'athletes'));
    const map = {};
    snap.docs.forEach(d => {
        const data = d.data();
        map[d.id] = {
            finalOrder: data.finalOrder ?? null,
            isInFinal:  data.isInFinal ?? false
        };
    });
    return map;
}

/**
 * skillMaster コレクションを Firestore から取得（キャッシュ処理は呼び出し元が行う）。
 * @returns {Promise<Array<{id: string, [key: string]: any}>>}
 */
async function fetchSkillsFromFirestore() {
    const snap = await getDocs(collection(db, 'skillMaster'));
    return snap.docs
        .map(d => {
            const s = { id: d.id, ...d.data() };
            // 2回宙はDDで低グループ(≤1.5) / 高グループ(≥1.6) に自動分類
            if (s.somersaultType === '2回宙') {
                s.doubleSomaGroup = (s.dd >= 1.6) ? 'high' : 'low';
            }
            return s;
        })
        .sort((a, b) => (a.displayOrder ?? Number(a.id)) - (b.displayOrder ?? Number(b.id)));
}

/**
 * skills.json が最新かどうかを、更新日時マーカー（meta/skillMaster.updatedAt、
 * skill_master.html が編集の都度書き込む）と skills.json 埋め込みの generatedAt を
 * 比較して判定する。マーカー未作成・読み取り失敗など判定できない場合は「stale ではない」
 * 側に倒す（= 静的ファイルを使う。誤ってFirestore全件取得に倒れないようfail-open）。
 * @param {number|undefined} generatedAt skills.json 生成時点のUnixミリ秒
 * @returns {Promise<boolean>}
 */
async function isSkillsJsonStale(generatedAt) {
    if (!generatedAt) return false; // 版情報のない旧形式ファイルは判定不能なのでそのまま使う
    try {
        const markerSnap = await getDoc(doc(db, 'meta', 'skillMaster'));
        if (!markerSnap.exists()) return false; // マーカー未作成＝比較対象なし
        const updatedAt = markerSnap.data().updatedAt;
        const updatedMs = updatedAt?.toMillis ? updatedAt.toMillis() : 0;
        return updatedMs > generatedAt;
    } catch (e) {
        console.warn('技マスタ更新マーカーの取得に失敗、staleではないものとして扱います:', e);
        return false;
    }
}

/**
 * skillMaster コレクションを取得（キャッシュあり）
 * displayOrder → id の数値順でソートして返す。
 *
 * 大会中はほぼ不変なデータなので、まず静的な skills.json（1回のHTTPリクエスト・
 * ブラウザの標準HTTPキャッシュも効く）を試す。skill_master.html での編集後に
 * skills.json の再生成・再デプロイを忘れていても、更新日時マーカーと突き合わせて
 * 古いと判定した場合は自動的に Firestore から取り直す（取得失敗時も同様にフォールバック）。
 * @returns {Array<{id: string, [key: string]: any}>}
 */
export async function getSkills() {
    const key = 'skills';
    if (_mem.has(key)) return _mem.get(key);
    const ss = ssGet(key);
    if (ss !== undefined) { _mem.set(key, ss); return ss; }

    try {
        const res = await fetch('./skills.json');
        if (res.ok) {
            const payload = await res.json();
            // 新形式 { generatedAt, skills } / 旧形式（配列そのもの）の両方に対応
            const data = Array.isArray(payload) ? payload : payload.skills;
            const generatedAt = Array.isArray(payload) ? undefined : payload.generatedAt;
            if (Array.isArray(data) && data.length > 0 && !(await isSkillsJsonStale(generatedAt))) {
                _mem.set(key, data);
                ssSet(key, data);
                return data;
            }
            if (Array.isArray(data) && data.length > 0) {
                console.warn('skills.json が技マスタ更新より古いため、Firestoreから取得し直します。');
            }
        }
    } catch (e) {
        console.warn('skills.json 取得失敗、Firestoreにフォールバックします:', e);
    }

    try {
        const data = await fetchSkillsFromFirestore();
        _mem.set(key, data);
        ssSet(key, data);
        return data;
    } catch (e) {
        console.error("Error loading skills:", e);
        return [];
    }
}

/**
 * キャッシュを強制クリア（設定変更後などに呼ぶ）
 * @param {string} [eventId]  省略すると全キャッシュをクリア
 */
export function invalidateCache(eventId) {
    if (eventId) {
        _mem.delete(`tour:${eventId}`);
        _mem.delete(`ath:${eventId}`);
        ssDel(`tour:${eventId}`);
        ssDel(`ath:${eventId}`);
    } else {
        _mem.delete('skills');
        ssDel('skills');
        _mem.clear();
        try {
            Object.keys(sessionStorage)
                .filter(k => k.startsWith(SS_PREFIX))
                .forEach(k => sessionStorage.removeItem(k));
        } catch {}
    }
}
