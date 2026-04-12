import { app, db, auth, isLocalDev } from "./firebase-config.js";
import { onAuthStateChanged, GoogleAuthProvider, signInWithPopup, signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { doc, getDoc, collection, query, orderBy, getDocs, writeBatch, serverTimestamp, deleteDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// --- Auth Functions ---

async function checkAdminStatus(user) {
    if (!user) return false;
    if (isLocalDev) return true;
    const adminDoc = await getDoc(doc(db, "admins", user.uid));
    return adminDoc.exists();
}

export { isLocalDev };

export function loginSkip() {
    if (!isLocalDev) return;
    // クエリパラメータを引き継いで遷移
    const params = new URLSearchParams(window.location.search);
    const qs = params.toString();
    window.location.href = 'admin_index.html' + (qs ? '?' + qs : '');
}

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

export function handleLoginRedirect() {
    // No-op: signInWithPopup is used, no redirect handling needed
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
            const da = a.startDate || '';
            const db_ = b.startDate || '';
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
    const tourDoc = await getDoc(doc(db, "tournaments", tournamentId));
    return tourDoc.exists() ? { id: tourDoc.id, ...tourDoc.data() } : null;
}

export async function getAthletes(eventId) {
    if (!eventId) return [];
    const snap = await getDocs(collection(db, `tournaments/${eventId}/athletes`));
    return snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
}

export async function getSkills() {
    try {
        const snap = await getDocs(collection(db, 'skillMaster'));
        return snap.docs
            .map(d => ({ id: d.id, ...d.data() }))
            .sort((a, b) => (a.displayOrder ?? Number(a.id)) - (b.displayOrder ?? Number(b.id)));
    } catch (e) {
        console.error("Error loading skills:", e);
        return [];
    }
}

export async function bulkSaveSubmissions(eventId, submissions, skillIds) {
    if (!eventId || !submissions?.length || !skillIds?.length) {
        return { success: false, message: "データが不足しています。" };
    }
    const batch = writeBatch(db);
    submissions.forEach(sub => {
        const subId = `${eventId}_${sub.athleteId}_${sub.round}`;
        batch.set(doc(db, "submissions", subId), {
            eventId, athleteId: sub.athleteId, round: sub.round, skills: skillIds,
            checkStatus: 0, updatedAt: serverTimestamp()
        }, { merge: true });
    });
    try {
        await batch.commit();
        return { success: true, message: `${submissions.length}件の構成を一括登録しました。` };
    } catch (e) {
        return { success: false, message: `一括登録中にエラー: ${e.message}` };
    }
}

export async function bulkClearSubmissions(eventId, submissions) {
    if (!eventId || !submissions?.length) {
        return { success: false, message: "削除対象がありません。" };
    }
    const batch = writeBatch(db);
    submissions.forEach(sub => {
        const subId = `${eventId}_${sub.athleteId}_${sub.round}`;
        batch.delete(doc(db, "submissions", subId));
    });
    try {
        await batch.commit();
        return { success: true, message: `${submissions.length}件の構成を削除しました。` };
    } catch (e) {
        return { success: false, message: `削除中にエラー: ${e.message}` };
    }
}
