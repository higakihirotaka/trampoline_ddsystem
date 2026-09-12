import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { initializeFirestore, memoryLocalCache } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyBhSJsTmnzBCFrHuXuB8zGUTiQauOS96m4",
  authDomain: "trampoline-dd-test.firebaseapp.com",
  projectId: "trampoline-dd-test",
  storageBucket: "trampoline-dd-test.firebasestorage.app",
  messagingSenderId: "722487617244",
  appId: "1:722487617244:web:9ae10218c36c82763af619",
  measurementId: "G-47B0W81CKZ"
};

const app = initializeApp(firebaseConfig);
// memoryLocalCache: IndexedDB を一切使わずメモリのみでキャッシュ
// → iOS Safari プライベートモードで IndexedDB が制限される環境でもクラッシュしない
const db = initializeFirestore(app, { localCache: memoryLocalCache() });

const isLocalDev = location.hostname === 'localhost' || location.hostname === '127.0.0.1';

// auth（Google認証）は firebase-auth.js の読み込み・初期化コストが伴うため、
// 実際に認証を使うページ用に firebase-auth-config.js へ分離した。db しか使わない
// ページ（審判入力画面など）はこのファイルを import しても auth 関連は一切読み込まれない。
export { app, db, isLocalDev };
