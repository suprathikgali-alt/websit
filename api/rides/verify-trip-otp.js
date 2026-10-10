import { timingSafeEqual } from 'node:crypto';
import {
  FieldValue,
  getFirebaseAdmin,
  hashOtp,
  sendJson,
  sendOtpError,
  verifyBearerToken,
} from '../_lib/firebase-admin.js';

function matchesHash(expected, actual) {
  if (typeof expected !== 'string' || typeof actual !== 'string') return false;
  const expectedBuffer = Buffer.from(expected, 'hex');
  const actualBuffer = Buffer.from(actual, 'hex');
  return expectedBuffer.length === actualBuffer.length && timingSafeEqual(expectedBuffer, actualBuffer);
}

export default async function verifyTripOtp(request, response) {
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST');
    return sendJson(response, 405, { message: 'Use POST to verify a trip code.' });
  }

  try {
    const rideId = request.body?.rideId;
    const code = request.body?.code;
    if (
      typeof rideId !== 'string' ||
      rideId.length < 10 ||
      rideId.length > 100 ||
      typeof code !== 'string' ||
      !/^\d{6}$/.test(code)
    ) {
      const error = new Error('Enter the six-digit customer trip code.');
      error.statusCode = 400;
      throw error;
    }

    const { auth, db } = getFirebaseAdmin();
    const identity = await verifyBearerToken(request, auth);
    const driverSnapshot = await db.collection('drivers').doc(identity.uid).get();
    if (!driverSnapshot.exists || driverSnapshot.data().approved !== true) {
      const error = new Error('This account is not approved for driver access.');
      error.statusCode = 403;
      throw error;
    }

    const rideReference = db.collection('rideRequests').doc(rideId);
    const otpReference = db.collection('rideTripOtps').doc(rideId);
    const result = await db.runTransaction(async transaction => {
      const [rideSnapshot, otpSnapshot] = await Promise.all([
        transaction.get(rideReference),
        transaction.get(otpReference),
      ]);
      if (
        !rideSnapshot.exists ||
        rideSnapshot.data().driverUid !== identity.uid ||
        rideSnapshot.data().status !== 'arrived' ||
        !otpSnapshot.exists ||
        otpSnapshot.data().driverUid !== identity.uid
      ) {
        return { error: 'This ride has no valid trip code. Send a new code to the customer.' };
      }

      const challenge = otpSnapshot.data();
      if (!challenge.expiresAt || challenge.expiresAt.toMillis() <= Date.now()) {
        transaction.delete(otpReference);
        return { error: 'The trip code expired. Send a new code to the customer.' };
      }
      if (challenge.attempts >= 5) {
        transaction.delete(otpReference);
        return { error: 'Too many incorrect codes. Send a new code to the customer.' };
      }

      if (!matchesHash(challenge.codeHash, hashOtp(rideId, code))) {
        const attempts = challenge.attempts + 1;
        if (attempts >= 5) transaction.delete(otpReference);
        else transaction.update(otpReference, { attempts, updatedAt: FieldValue.serverTimestamp() });
        return {
          error: attempts >= 5
            ? 'Too many incorrect codes. Send a new code to the customer.'
            : 'That trip code is incorrect. Ask the customer to check their email.',
        };
      }

      transaction.update(rideReference, {
        status: 'in_progress',
        updatedAt: FieldValue.serverTimestamp(),
      });
      transaction.delete(otpReference);
      return { verified: true };
    });

    if (!result.verified) {
      const error = new Error(result.error);
      error.statusCode = 400;
      throw error;
    }
    return sendJson(response, 200, { verified: true });
  } catch (error) {
    return sendOtpError(response, error, 'Could not verify the trip code. Please try again.');
  }
}
