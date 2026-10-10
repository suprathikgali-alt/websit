import { adminDb, HttpError } from '../_lib/firebaseAdmin.js';
import { requireString, requireUser, route } from '../_lib/http.js';
import { fareFor, MAX_TIP } from '../_lib/fare.js';
import { razorpayClient } from '../_lib/razorpay.js';

export function parseTip(value) {
  const tip = Number(value ?? 0);
  if (!Number.isInteger(tip) || tip < 0 || tip > MAX_TIP) throw new HttpError(400, `Tip must be a whole number from 0 to ${MAX_TIP}.`);
  return tip;
}

export default route('POST', async (req, body) => {
  const user = await requireUser(req);
  const rideId = requireString(body.rideId, 'rideId');
  const tip = parseTip(body.tipAmount);

  const snap = await adminDb().collection('rideRequests').doc(rideId).get();
  if (!snap.exists) throw new HttpError(404, 'Ride not found.');
  const ride = snap.data();
  if (ride.customerUid !== user.uid) throw new HttpError(403, 'This is not your ride.');
  if (ride.status !== 'completed') throw new HttpError(409, 'Pay after the driver completes the trip.');
  if (ride.paymentMethod !== 'online') throw new HttpError(409, 'This ride was booked as cash.');
  if (ride.paymentStatus === 'paid') throw new HttpError(409, 'This ride is already paid.');

  const expectedFare = fareFor(ride.vehicleType, ride.couponCode || '');
  if (expectedFare === null || expectedFare !== ride.fare) throw new HttpError(409, 'The ride fare could not be verified.');

  const amount = (ride.fare + tip) * 100; // paise
  const order = await razorpayClient().orders.create({
    amount,
    currency: 'INR',
    receipt: `ride_${rideId}`.slice(0, 40),
    notes: { rideId, uid: user.uid, tip: String(tip) }
  });
  return { id: order.id, amount: order.amount, currency: order.currency, keyId: process.env.RAZORPAY_KEY_ID };
});
