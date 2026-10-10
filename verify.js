import { createHmac, timingSafeEqual } from 'node:crypto';
import { adminDb, FieldValue, HttpError } from '../_lib/firebaseAdmin.js';
import { requireString, requireUser, route } from '../_lib/http.js';
import { razorpayClient } from '../_lib/razorpay.js';

function signatureValid(orderId, paymentId, signature) {
  const expected = createHmac('sha256', process.env.RAZORPAY_KEY_SECRET).update(`${orderId}|${paymentId}`).digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(String(signature));
  return a.length === b.length && timingSafeEqual(a, b);
}

export default route('POST', async (req, body) => {
  const user = await requireUser(req);
  const rideId = requireString(body.rideId, 'rideId');
  const orderId = requireString(body.razorpayOrderId, 'razorpayOrderId');
  const paymentId = requireString(body.razorpayPaymentId, 'razorpayPaymentId');
  const signature = requireString(body.razorpaySignature, 'razorpaySignature', 500);

  const razorpay = razorpayClient();
  if (!signatureValid(orderId, paymentId, signature)) throw new HttpError(400, 'Payment signature is invalid.');

  const db = adminDb();
  const rideRef = db.collection('rideRequests').doc(rideId);
  const rideSnap = await rideRef.get();
  if (!rideSnap.exists) throw new HttpError(404, 'Ride not found.');
  const ride = rideSnap.data();
  if (ride.customerUid !== user.uid) throw new HttpError(403, 'This is not your ride.');
  if (ride.paymentStatus === 'paid' && ride.paymentId === paymentId) return { verified: true, paymentId };

  // Trust Razorpay's records, not the browser: the order must belong to this ride and user.
  const order = await razorpay.orders.fetch(orderId);
  const tip = Number(order.notes?.tip ?? 0);
  if (order.notes?.rideId !== rideId || order.notes?.uid !== user.uid) throw new HttpError(400, 'This payment does not belong to this ride.');
  if (order.amount !== (ride.fare + tip) * 100 || order.currency !== 'INR') throw new HttpError(400, 'Payment amount does not match the ride fare.');

  let payment = await razorpay.payments.fetch(paymentId);
  if (payment.order_id !== orderId || payment.amount !== order.amount) throw new HttpError(400, 'Payment details do not match the order.');
  if (payment.status === 'authorized') payment = await razorpay.payments.capture(paymentId, order.amount, 'INR');
  if (payment.status !== 'captured') throw new HttpError(402, 'Payment was not completed. You have not been charged for this ride.');

  await db.runTransaction(async (tx) => {
    const fresh = await tx.get(rideRef);
    if (fresh.data().paymentStatus === 'paid') return;
    tx.update(rideRef, {
      paymentStatus: 'paid',
      paymentId,
      paidAmount: order.amount / 100,
      tipAmount: tip,
      paidAt: FieldValue.serverTimestamp()
    });
    tx.set(db.collection('payments').doc(paymentId), {
      rideId, customerUid: user.uid, orderId, amount: order.amount / 100, tip,
      method: payment.method || null, status: 'captured', createdAt: FieldValue.serverTimestamp()
    });
  });
  return { verified: true, paymentId };
});
