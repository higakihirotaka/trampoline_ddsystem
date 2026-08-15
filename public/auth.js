import { db, auth, isLocalDev } from "./firebase-config.js";
import { onAuthStateChanged, GoogleAuthProvider, signInWithPopup, signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { doc, getDoc, collection, getDocs, writeBatch, serverTimestamp, deleteField } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { getTournament } from "./cache.js";

// --- Auth Functions ---

async function checkAdminStatus(user) {
    if (!user) return false;
    if (isLocalDev) return true;
    // セッション内キャッシュ（同タブ内の2回目以降はFirestore不要）
    const cacheKey = `adminStatus:${user.uid}`;
    const cached = sessionStorage.getItem(cacheKey);
    if (cached !== null) return cached === 'true';
    const adminDoc = await getDoc(doc(db, "admins", user.uid));
    const result = adminDoc.exists();
    sessionStorage.setItem(cacheKey, String(result));
    return result;
}

export { isLocalDev };

export async function loginWithGoogle() {
    try {
        const result = await signInWithPopup(auth, new GoogleAuthProvider());
        if (await checkAdminStatus(result.user)) {
            const params = new URLSearchParams(window.location.search);
            const qs = params.toString();
            window.location.href = 'admin_index.html' + (qs ? '?' + qs : '');
        } else {
            await signOut(auth);
            alert('管理者権限がありません。');
        }
    } catch (error) {
        console.error("Login failed:", error);
        alert('ログインに失敗しました。');
    }
}

export function logout() {
    signOut(auth).then(() => { window.location.href = 'admin_login.html'; });
}

export function ensureAdmin(callback) {
    if (isLocalDev) {
        callback({ displayName: 'Dev User', email: 'dev@local.dev', uid: 'dev-uid' });
        return;
    }
    onAuthStateChanged(auth, async (user) => {
        if (user && await checkAdminStatus(user)) {
            callback(user);
        } else {
            window.location.href = 'admin_login.html?reason=not_admin';
        }
    });
}

// --- Firestore & Data Functions ---

export async function getTournaments() {
    const snap = await getDocs(collection(db, "tournaments"));
    return snap.docs
        .map(doc => ({ id: doc.id, ...doc.data() }))
        .sort((a, b) => {
            const da = a.startDate || a.start_date || '';
            const db_ = b.startDate || b.start_date || '';
            if (da > db_) return -1;
            if (da < db_) return 1;
            // startDateが同じ or 両方なし → 作成日時の新しい順
            const ca = a.createdAt?.seconds ?? 0;
            const cb = b.createdAt?.seconds ?? 0;
            return cb - ca;
        });
}

export async function getTournamentDetails(tournamentId) {
    if (!tournamentId) return null;
    // cache.js 経由（メモリ + sessionStorage 10分TTL）
    return await getTournament(tournamentId);
}

// Firestore writeBatch は1コミット500件上限のため、450件ずつ分割してコミット
async function commitInChunks(ops) {
    const CHUNK = 450;
    for (let i = 0; i < ops.length; i += CHUNK) {
        const batch = writeBatch(db);
        ops.slice(i, i + CHUNK).forEach(fn => fn(batch));
        await batch.commit();
    }
}

export async function bulkSaveSubmissions(eventId, submissions, skillIds) {
    if (!eventId || !submissions?.length || !skillIds?.length) {
        return { success: false, message: "データが不足しています。" };
    }
    // 1件のsubmissionにつき書込は2つ（submissionsドキュメント＋選手ドキュメントの済フラグ）
    // なので、1closure=1書込になるようflatMapする（commitInChunksの450件チャンクが
    // Firestoreの1バッチ500書込上限を超えないようにするため）。
    const ops = submissions.flatMap(sub => {
        const subId = `${eventId}_${sub.athleteId}_${sub.round}`;
        return [
            batch => batch.set(doc(db, "submissions", subId), {
                eventId, athleteId: sub.athleteId, round: sub.round, skills: skillIds,
                checkStatus: 0, updatedAt: serverTimestamp()
            }, { merge: true }),
            // entry.html の submitRoutine() と同じく選手ドキュメント側にも済フラグを反映する。
            // event.html等の一覧が submissions コレクション全件取得ではなくこのフラグだけを見て
            // 済/未判定できるようにするため。revisionCount は書かないので、card_history.html の
            // 「一括/旧」判定（revisionCountの有無で一括登録か選手本人の提出かを見分ける仕組み）
            // には影響しない。
            batch => batch.update(doc(db, "tournaments", eventId, "athletes", sub.athleteId), {
                [`submissions.${sub.round}`]: 0
            })
        ];
    });
    try {
        await commitInChunks(ops);
        return { success: true, message: `${submissions.length}件の構成を一括登録しました。` };
    } catch (e) {
        return { success: false, message: `一括登録中にエラー: ${e.message}` };
    }
}

export async function bulkClearSubmissions(eventId, submissions) {
    if (!eventId || !submissions?.length) {
        return { success: false, message: "削除対象がありません。" };
    }
    const ops = submissions.flatMap(sub => {
        const subId = `${eventId}_${sub.athleteId}_${sub.round}`;
        return [
            batch => batch.delete(doc(db, "submissions", subId)),
            batch => batch.update(doc(db, "tournaments", eventId, "athletes", sub.athleteId), {
                [`submissions.${sub.round}`]: deleteField()
            })
        ];
    });
    try {
        await commitInChunks(ops);
        return { success: true, message: `${submissions.length}件の構成を削除しました。` };
    } catch (e) {
        return { success: false, message: `削除中にエラー: ${e.message}` };
    }
}
