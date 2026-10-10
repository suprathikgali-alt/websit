import { timingSafeEqual } from 'node:crypto';
import {
  FieldValue,
  getFirebaseAdmin,
  hashEmail,
  hashOtp,
  normalizeEmail,
  sendJson,
  sendOtpError,
} from '../_lib/firebase-admin.js';

function matchesHash(expected, actual) {
  if (typeof expected !== 'string' || typeof actual !== 'string') return false;
  const expectedBuffer = Buffer.from(expected, 'hex');
  const actualBuffer = Buffer.from(actual, 'hex');
  return expectedBuffer.length === actualBuffer.length && timingSafeEqual(expectedBuffer, actualBuffer);
}

export default async function verifySignInOtp(request, response) {
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST');
    return sendJson(response, 405, { message: 'Use POST to verify a sign-in code.' });
  }

  try {
    const email = normalizeEmail(request.body?.email);
    const code = request.body?.code;
    if (!email || typeof code !== 'string' || !/^\d{6}$/.test(code)) {
      const error = new Error('Enter a valid email and the six-digit code from your email.');
      error.statusCode = 400;
      throw error;
    }

    const { auth, db } = getFirebaseAdmin();
    const reference = db.collection('emailOtpChallenges').doc(hashEmail(email));
    const now = Date.now();
    const outcome = await db.runTransaction(async transaction => {
      const snapshot = await transaction.get(reference);
      const challenge = snapshot.data();
      if (
        !challenge ||
        challenge.purpose !== 'sign-in' ||
        !challenge.expiresAt ||
        challenge.expiresAt.toMillis() <= now ||
        challenge.attempts >= 5
      ) {
        if (challenge) transaction.delete(reference);
        return { error: 'That sign-in code expired. Request a new one.' };
      }

      const codeHash = hashOtp(email, code);
      if (!matchesHash(challenge.codeHash, codeHash)) {
        const attempts = challenge.attempts + 1;
        transaction.set(reference, {
          attempts,
          updatedAt: FieldValue.serverTimestamp(),
          ...(attempts >= 5 ? { codeHash: FieldValue.delete() } : {}),
        }, { merge: true });
        return {
          error: attempts >= 5
            ? 'Too many incorrect codes. Request a new sign-in code.'
            : 'That code is incorrect. Check your email and try again.',
        };
      }

      transaction.delete(reference);
      return { verified: true };
    });
    if (!outcome.verified) {
      const error = new Error(outcome.error);
      error.statusCode = 400;
      throw error;
    }

    let user;
    try {
      user = await auth.getUserByEmail(email);
      if (!user.emailVerified) user = await auth.updateUser(user.uid, { emailVerified: true });
    } catch (error) {
      if (error.code !== 'auth/user-not-found') throw error;
      try {
        user = await auth.createUser({ email, emailVerified: true });
      } catch (createError) {
        if (createError.code !== 'auth/email-already-exists') throw createError;
        user = await auth.getUserByEmail(email);
        if (!user.emailVerified) user = await auth.updateUser(user.uid, { emailVerified: true });
      }
    }

    const token = await auth.createCustomToken(user.uid);
    return sendJson(response, 200, { token });
  } catch (error) {
    return sendOtpError(response, error, 'Could not verify your sign-in code. Please try again.');
  }
}
