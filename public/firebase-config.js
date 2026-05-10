import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { initializeFirestore, memoryLocalCache } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

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
const auth = getAuth(app);

const isLocalDev = location.hostname === 'localhost' || location.hostname === '127.0.0.1';

export { app, db, auth, isLocalDev };
