import { initializeApp, applicationDefault, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

const app = getApps().length
  ? getApps()[0]
  : initializeApp({
      credential: applicationDefault()
    });

export const firebaseAuth = getAuth(app);