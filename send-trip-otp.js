import { adminAuth, adminDb, HttpError } from '../_lib/firebaseAdmin.js';
import { requireString, requireUser, route } from '../_lib/http.js';
import { codeEmail, sendEmail } from '../_lib/email.js';
import { hashCode, newCode, OTP_RESEND_MS, OTP_TTL_MS } from '../_lib/otp.js';

export default route('POST', async (req, body) => {
  const user = await requireUser(req);
  const rideId = requireString(body.rideId, 'rideId');
  const db = adminDb();

  const rideSnap = await db.collection('rideRequests').doc(rideId).get();
  if (!rideSnap.exists) throw new HttpError(404, 'Ride not found.');
  const ride = rideSnap.data();
  if (ride.driverUid !== user.uid) throw new HttpError(403, 'Only the assigned driver can send the trip-start code.');
  if (ride.status !== 'arrived') throw new HttpError(409, 'Mark yourself as arrived before sending the trip-start code.');

  const otpRef = db.collection('rideTripOtps').doc(rideId);
  const existing = await otpRef.get();
  if (existing.exists && Date.now() - existing.data().createdAt < OTP_RESEND_MS) {
    throw new HttpError(429, 'Please wait 30 seconds before resending the trip code.');
  }

  const customer = await adminAuth().getUser(ride.customerUid);
  if (!customer.email) throw new HttpError(409, 'The customer has no email address on file.');

  const code = newCode();
  await otpRef.set({
    codeHash: hashCode(`trip:${rideId}`, code),
    createdAt: Date.now(),
    expiresAt: Date.now() + OTP_TTL_MS,
    attempts: 0
  });

  const { text, html } = codeEmail(
    'Your ARIDE trip-start code',
    'Your driver has arrived. Share this code with them only once you are in the vehicle.',
    code
  );
  await sendEmail({ to: customer.email, subject: 'Your ARIDE trip-start code', text, html });
  return { sent: true };
});
