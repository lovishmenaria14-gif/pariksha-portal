import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js';

import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup
} from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js';

const firebaseConfig = {
  apiKey: "AIzaSyC9FEsEi_FzSb9QxjB8_4eF69qcWsgCuWY",
  authDomain: "pariksha-67ea1.firebaseapp.com",
  projectId: "FIREBASE_PROJECT_ID",
  storageBucket: "pariksha-67ea1.firebasestorage.app",
  messagingSenderId: "137519370910",
  appId: "1:137519370910:web:120b4f64cfb2a44e7b618f",
  measurementId: "G-3WXWJ94HJJ"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

const provider = new GoogleAuthProvider();

export async function googleLogin() {
  const result = await signInWithPopup(auth, provider);
  return await result.user.getIdToken();
}