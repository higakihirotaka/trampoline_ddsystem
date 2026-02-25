
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getFirestore, collection, getDocs, doc, getDoc, addDoc, setDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// **FIXED**: Added authDomain to the Firebase config.
const firebaseConfig = { 
    apiKey: "AIzaSyBhSJsTmnzBCFrHuXuB8zGUTiQauOS96m4", 
    authDomain: "trampoline-dd-test.web.app", // <-- This was missing
    projectId: "trampoline-dd-test" 
};
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

document.addEventListener('DOMContentLoaded', async () => {
    const urlParams = new URLSearchParams(window.location.search);
    const eventId = urlParams.get('event');

    if (eventId) {
        // Fetch and display event name
        const eventDoc = await getDoc(doc(db, "events", eventId));
        if (eventDoc.exists()) {
            document.getElementById('event-name').textContent = `大会名: ${eventDoc.data().name}`;
        }
        // More functionality to come...
    } else {
        document.getElementById('event-name').textContent = 'イベントが選択されていません。';
        // Maybe show a list of events to select from
    }
});
