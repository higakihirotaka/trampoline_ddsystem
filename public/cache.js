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
    if (_mem.has(key)) return _mem.get(key);
    const ss = ssGet(key);
    if (ss !== undefined) { _mem.set(key, ss); return ss; }

    const snap = await getDocs(collection(db, 'tournaments', eventId, 'athletes'));
    const data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    _mem.set(key, data);
    ssSet(key, data);
    return data;
}

/**
 * skillMaster コレクションを取得（キャッシュあり）
 * displayOrder → id の数値順でソートして返す。
 * @returns {Array<{id: string, [key: string]: any}>}
 */
export async function getSkills() {
    const key = 'skills';
    if (_mem.has(key)) return _mem.get(key);
    const ss = ssGet(key);
    if (ss !== undefined) { _mem.set(key, ss); return ss; }

    try {
        const snap = await getDocs(collection(db, 'skillMaster'));
        const data = snap.docs
            .map(d => {
                const s = { id: d.id, ...d.data() };
                // 2回宙はDDで低グループ(≤1.5) / 高グループ(≥1.6) に自動分類
                if (s.somersaultType === '2回宙') {
                    s.doubleSomaGroup = (s.dd >= 1.6) ? 'high' : 'low';
                }
                return s;
            })
            .sort((a, b) => (a.displayOrder ?? Number(a.id)) - (b.displayOrder ?? Number(b.id)));
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
