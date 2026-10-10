import { randomInt, randomUUID } from 'node:crypto';
import {
  FieldValue,
  getFirebaseAdmin,
  hashEmail,
  hashOtp,
  normalizeEmail,
  sendEmailOtp,
  sendJson,
  sendOtpError,
  Timestamp,
} from '../_lib/firebase-admin.js';

export default async function sendSignInOtp(request, response) {
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST');
    return sendJson(response, 405, { message: 'Use POST to request a sign-in code.' });
  }

  try {
    const email = normalizeEmail(request.body?.email);
    if (!email) {
      const error = new Error('Enter a valid email address.');
      error.statusCode = 400;
      throw error;
    }

    const { db } = getFirebaseAdmin();
    const reference = db.collection('emailOtpChallenges').doc(hashEmail(email));
    const lockId = randomUUID();
    const now = Date.now();
    await db.runTransaction(async transaction => {
      const snapshot = await transaction.get(reference);
      const data = snapshot.data();
      if (data?.resendAfter && data.resendAfter.toMillis() > now) {
        const error = new Error('Wait one minute before requesting another code.');
        error.statusCode = 429;
        throw error;
      }
      transaction.set(reference, {
        email,
        sendLockId: lockId,
        resendAfter: Timestamp.fromMillis(now + 60_000),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    });

    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    try {
      await sendEmailOtp({ email, code, purpose: 'sign-in' });
    } catch (error) {
      await db.runTransaction(async transaction => {
        const snapshot = await transaction.get(reference);
        if (snapshot.data()?.sendLockId === lockId) {
          transaction.set(reference, {
            sendLockId: FieldValue.delete(),
            resendAfter: Timestamp.fromMillis(Date.now()),
            updatedAt: FieldValue.serverTimestamp(),
          }, { merge: true });
        }
      });
      throw error;
    }

    await db.runTransaction(async transaction => {
      const snapshot = await transaction.get(reference);
      if (snapshot.data()?.sendLockId !== lockId) {
        const error = new Error('A newer sign-in code was requested. Use the newest email.');
        error.statusCode = 409;
        throw error;
      }
      transaction.set(reference, {
        purpose: 'sign-in',
        codeHash: hashOtp(email, code),
        expiresAt: Timestamp.fromMillis(Date.now() + 10 * 60_000),
        attempts: 0,
        sendLockId: FieldValue.delete(),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    });

    return sendJson(response, 200, { sent: true });
  } catch (error) {
    return sendOtpError(response, error, 'Could not send your sign-in code. Check email setup and try again.');
  }
}
