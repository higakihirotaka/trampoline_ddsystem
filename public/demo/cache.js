// デモ用: 本物の cache.js と同じ関数名で、ダミーデータ（fake-firestore.js）から読む
import { db } from "./firebase-config.js";
import { doc, getDoc, getDocs, collection } from "./fake-firestore.js";

export async function getTournament(eventId) {
  const snap = await getDoc(doc(db, 'tournaments', eventId));
  return snap.exists() ? snap.data() : null;
}
export async function getAthletes(eventId) {
  const snap = await getDocs(collection(db, 'tournaments', eventId, 'athletes'));
  // 本物と同じく、試技順（finalOrder / isInFinal）は含めない（getFinalOrders で別に取得してマージする）
  return snap.docs.map(d => { const { finalOrder, isInFinal, ...stable } = { id: d.id, ...d.data() }; return stable; });
}
export async function getFinalOrders(eventId) {
  const snap = await getDocs(collection(db, 'tournaments', eventId, 'athletes'));
  const map = {};
  snap.docs.forEach(d => { const x = d.data(); map[d.id] = { finalOrder: x.finalOrder ?? null, isInFinal: x.isInFinal ?? false }; });
  return map;
}
export async function getSkills() {
  const snap = await getDocs(collection(db, 'skillMaster'));
  return snap.docs.map(d => {
    const s = { id: d.id, ...d.data() };
    if (s.somersaultType === '2回宙') s.doubleSomaGroup = (s.dd >= 1.6) ? 'high' : 'low';   // 本物の cache.js と同じ分類
    return s;
  }).sort((a, b) => (a.displayOrder ?? Number(a.id)) - (b.displayOrder ?? Number(b.id)));
}
export function invalidateCache() {}
