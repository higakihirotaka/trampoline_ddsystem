/**
 * Firebase Auth 初期化（認証を使うページだけがこれを import する）
 *
 * firebase-auth.js（Google認証・セッション永続化などを含むSDK本体）の取得・初期化コストは
 * 認証が実際に必要なページ（管理画面・CJP画面など）だけに払わせたい。
 * db しか使わないページ（審判入力の D/E/T・HD 画面や選手入力画面など）が
 * firebase-config.js を import しても、このファイルは読み込まれない。
 */
import { app } from "./firebase-config.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

const auth = getAuth(app);

export { auth };
