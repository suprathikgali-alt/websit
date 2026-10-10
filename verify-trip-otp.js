import { adminDb, FieldValue, HttpError } from '../_lib/firebaseAdmin.js';
import { requireString, requireUser, route } from '../_lib/http.js';
import { codesMatch, OTP_MAX_ATTEMPTS, validCodeFormat } from '../_lib/otp.js';

export default route('POST', async (req, body) => {
  const user = await requireUser(req);
  const rideId = requireString(body.rideId, 'rideId');
  const code = validCodeFormat(body.code);
  const db = adminDb();
  const rideRef = db.collection('rideRequests').doc(rideId);
  const otpRef = db.collection('rideTripOtps').doc(rideId);

  const outcome = await db.runTransaction(async (tx) => {
    const [rideSnap, otpSnap] = await Promise.all([tx.get(rideRef), tx.get(otpRef)]);
    if (!rideSnap.exists) return 'no-ride';
    const ride = rideSnap.data();
    if (ride.driverUid !== user.uid) return 'forbidden';
    if (ride.status !== 'arrived') return 'bad-status';
    if (!otpSnap.exists) return 'missing';
    const otp = otpSnap.data();
    if (Date.now() > otp.expiresAt) { tx.delete(otpRef); return 'expired'; }
    if (otp.attempts >= OTP_MAX_ATTEMPTS) { tx.delete(otpRef); return 'locked'; }
    if (!codesMatch(otp.codeHash, `trip:${rideId}`, code)) {
      tx.update(otpRef, { attempts: otp.attempts + 1 });
      return 'wrong';
    }
    tx.delete(otpRef);
    tx.update(rideRef, { status: 'in_progress', tripStartedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
    return 'ok';
  });

  const errors = {
    'no-ride': [404, 'Ride not found.'],
    forbidden: [403, 'Only the assigned driver can start this trip.'],
    'bad-status': [409, 'This ride is not waiting for a trip-start code.'],
    missing: [400, 'No trip code was sent. Tap "Resend trip code".'],
    expired: [400, 'The trip code expired. Tap "Resend trip code".'],
    locked: [429, 'Too many wrong attempts. Tap "Resend trip code" for a new one.'],
    wrong: [400, 'That trip code is not correct.']
  };
  if (outcome !== 'ok') throw new HttpError(...errors[outcome]);
  return { started: true };
});
