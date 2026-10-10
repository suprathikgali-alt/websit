import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';

function init() {
  if (getApps().length) return getApps()[0];
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
  if (!projectId || !clientEmail || !privateKey) {
    throw new HttpError(503, 'Server is not configured: Firebase Admin credentials are missing.');
  }
  return initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) });
}

export function adminAuth() { return getAuth(init()); }
export function adminDb() { return getFirestore(init()); }
export { FieldValue };

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
