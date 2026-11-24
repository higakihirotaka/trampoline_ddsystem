// デモ用: Firestore には接続しない（fake-firestore.js のメモリ上のダミーを使う）
import { db } from "./fake-firestore.js";
export { db };
export const isLocalDev = false;
