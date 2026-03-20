import { db } from "./firebase-config.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

document.addEventListener('DOMContentLoaded', async () => {
    const urlParams = new URLSearchParams(window.location.search);
    const eventId = urlParams.get('event');

    if (eventId) {
        try {
            const eventDoc = await getDoc(doc(db, "events", eventId));
            if (eventDoc.exists()) {
                document.getElementById('event-name').textContent = `大会名: ${eventDoc.data().name}`;
            }
        } catch (e) {
            console.error("イベント取得エラー:", e);
            document.getElementById('event-name').textContent = 'イベント情報の取得に失敗しました。';
        }
    } else {
        document.getElementById('event-name').textContent = 'イベントが選択されていません。';
    }
});
