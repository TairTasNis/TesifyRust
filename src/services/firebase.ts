import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { getDatabase } from "firebase/database";

const firebaseConfig = {
    apiKey: "AIzaSyC3bswdLgY7HtY8cInT5DDh3yo8V5TAHZU",
    authDomain: "tesifyttfotg.firebaseapp.com",
    projectId: "tesifyttfotg",
    storageBucket: "tesifyttfotg.firebasestorage.app",
    messagingSenderId: "1087130201116",
    appId: "1:1087130201116:web:57435a40a5f139f37b03d9",
    databaseURL: "https://tesifyttfotg-default-rtdb.firebaseio.com"
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getDatabase(app);
export const googleProvider = new GoogleAuthProvider();
