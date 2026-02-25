import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, onAuthStateChanged, GoogleAuthProvider, signInWithPopup, signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getFirestore, doc, getDoc, collection, query, orderBy, getDocs, writeBatch, serverTimestamp, deleteDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// Centralized Firebase Initialization
const firebaseConfig = {
    apiKey: "AIzaSyBhSJsTmnzBCFrHuXuB8zGUTiQauOS96m4",
    authDomain: "trampoline-dd-test.firebaseapp.com",
    projectId: "trampoline-dd-test",
    storageBucket: "trampoline-dd-test.appspot.com",
    messagingSenderId: "722487617244",
    appId: "1:722487617244:web:9ae10218c36c82763af619"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// --- Auth Functions ---

async function checkAdminStatus(user) {
    if (!user) return false;
    const adminDoc = await getDoc(doc(db, "admins", user.uid));
    return adminDoc.exists();
}

export async function loginWithGoogle() {
    try {
        const result = await signInWithPopup(auth, new GoogleAuthProvider());
        if (await checkAdminStatus(result.user)) {
            window.location.href = 'admin_index.html';
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
    const q = query(collection(db, "tournaments"), orderBy("startDate", "desc"));
    const snap = await getDocs(q);
    return snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
}

export async function getTournamentDetails(tournamentId) {
    if (!tournamentId) return null;
    const tourDoc = await getDoc(doc(db, "tournaments", tournamentId));
    return tourDoc.exists() ? { id: tourDoc.id, ...tourDoc.data() } : null;
}

export async function getAthletes(eventId) {
    if (!eventId) return [];
    const snap = await getDocs(query(collection(db, `tournaments/${eventId}/athletes`), orderBy("number")));
    return snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
}

export async function getSkills() {
    try {
        const res = await fetch('data/skills.tsv');
        if (!res.ok) throw new Error(`Response status: ${res.status}`);
        const text = await res.text();
        return text.trim().split(/\r?\n/).slice(1).map((l, index) => {
            const c = l.split('\t');
            return { id: String(index), symbol: c[0]?.trim() || '', direction: c[3]?.trim() || '' };
        });
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
