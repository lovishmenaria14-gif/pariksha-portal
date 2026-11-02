
import 'dotenv/config';

import { initializeApp, getApps, getApp, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { readFileSync } from 'node:fs';

const projectId = process.env.FIREBASE_PROJECT_ID;
const serviceAccountPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;

if (!projectId || !serviceAccountPath) {
  throw new Error('Firebase project ID or service account path is missing.');
}

const serviceAccount = JSON.parse(
  readFileSync(serviceAccountPath, 'utf8')
);

const app = getApps().length
  ? getApp()
  : initializeApp({
      credential: cert(serviceAccount),
      projectId,
    });

export const firebaseAuth = getAuth(app);
