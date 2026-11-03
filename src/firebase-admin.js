
import { initializeApp, getApps, getApp, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { readFileSync } from 'node:fs';

const projectId = process.env.FIREBASE_PROJECT_ID;
const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT;

if (!projectId) {
  throw new Error('FIREBASE_PROJECT_ID is missing.');
}

let serviceAccount;

if (serviceAccountJson) {
  serviceAccount = JSON.parse(serviceAccountJson);
} else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  serviceAccount = JSON.parse(
    readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS, 'utf8')
  );
} else {
  throw new Error('Firebase service account credentials are missing.');
}

const app = getApps().length
  ? getApp()
  : initializeApp({
      credential: cert(serviceAccount),
      projectId,
    });

export const firebaseAuth = getAuth(app);
