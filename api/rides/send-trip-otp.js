import { randomInt } from 'node:crypto';
import {
  FieldValue,
  getFirebaseAdmin,
  hashOtp,
  sendEmailOtp,
  sendJson,
  sendOtpError,
  Timestamp,
  verifyBearerToken,
} from '../_lib/firebase-admin.js';

export default async function sendTripOtp(request, response) {
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST');
    return sendJson(response, 405, { message: 'Use POST to request a trip code.' });
  }

  try {
    const rideId = request.body?.rideId;
    if (typeof rideId !== 'string' || rideId.length < 10 || rideId.length > 100) {
      const error = new Error('A valid ride ID is required.');
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
    const rideSnapshot = await rideReference.get();
    if (
      !rideSnapshot.exists ||
      rideSnapshot.data().driverUid !== identity.uid ||
      rideSnapshot.data().status !== 'arrived'
    ) {
      const error = new Error('Trip codes can only be sent for your ride after you mark arrived.');
      error.statusCode = 409;
      throw error;
    }
    const customer = await auth.getUser(rideSnapshot.data().customerUid);
    if (!customer.email) {
      const error = new Error('The customer account does not have an email address for trip verification.');
      error.statusCode = 400;
      throw error;
    }

    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const otpReference = db.collection('rideTripOtps').doc(rideId);
    const now = Date.now();
    await db.runTransaction(async transaction => {
      const [currentRide, previousOtp] = await Promise.all([
        transaction.get(rideReference),
        transaction.get(otpReference),
      ]);
      if (
        !currentRide.exists ||
        currentRide.data().driverUid !== identity.uid ||
        currentRide.data().status !== 'arrived'
      ) {
        const error = new Error('This trip is no longer waiting for its start code.');
        error.statusCode = 409;
        throw error;
      }
      const lastSentAt = previousOtp.data()?.sentAt?.toMillis();
      if (lastSentAt && lastSentAt + 60_000 > now) {
        const error = new Error('Wait one minute before sending another trip code.');
        error.statusCode = 429;
        throw error;
      }
      transaction.set(otpReference, {
        driverUid: identity.uid,
        customerUid: currentRide.data().customerUid,
        codeHash: hashOtp(rideId, code),
        expiresAt: Timestamp.fromMillis(now + 10 * 60_000),
        sentAt: Timestamp.fromMillis(now),
        attempts: 0,
        updatedAt: FieldValue.serverTimestamp(),
      });
    });

    await sendEmailOtp({ email: customer.email, code, purpose: 'trip-start' });
    return sendJson(response, 200, { sent: true });
  } catch (error) {
    return sendOtpError(response, error, 'Could not send the trip code. Check email delivery settings and retry.');
  }
}
