
import { initializeApp, getApps, getApp, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { readFileSync } from 'node:fs';

const projectId = process.env.FIREBASE_PROJECT_ID;
const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT;
let firebaseAuth = null;

try {
  let serviceAccount;

  if (serviceAccountJson) {
    serviceAccount = JSON.parse(serviceAccountJson);
  } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    serviceAccount = JSON.parse(
      readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS, 'utf8')
    );
  }

  if (projectId && serviceAccount) {
    const app = getApps().length
      ? getApp()
      : initializeApp({ credential: cert(serviceAccount), projectId });
    firebaseAuth = getAuth(app);
  }
} catch (error) {
  console.warn('Firebase Google login is unavailable:', error.message);
}

export { firebaseAuth };
