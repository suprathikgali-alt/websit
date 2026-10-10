import { createHmac, timingSafeEqual } from 'node:crypto';
import { calculateRideAmount, getRazorpay, sendMethodNotAllowed, sendPaymentError } from '../_lib/razorpay.js';

export default async function verifyPayment(request, response) {
  if (request.method !== 'POST') return sendMethodNotAllowed(response);

  try {
    const {
      razorpayOrderId,
      razorpayPaymentId,
      razorpaySignature,
      vehicleType,
      couponCode,
      tipAmount = 0,
    } = request.body || {};
    if (![razorpayOrderId, razorpayPaymentId, razorpaySignature].every(value => typeof value === 'string' && value.length > 0)) {
      const error = new Error('Payment verification details are incomplete.');
      error.statusCode = 400;
      throw error;
    }

    const normalizedCoupon = typeof couponCode === 'string' ? couponCode.trim().toUpperCase() : '';
    const amount = calculateRideAmount(vehicleType, normalizedCoupon, tipAmount);
    const { client, keySecret } = getRazorpay();
    const expectedSignature = createHmac('sha256', keySecret)
      .update(`${razorpayOrderId}|${razorpayPaymentId}`)
      .digest('hex');
    const expectedBuffer = Buffer.from(expectedSignature);
    const receivedBuffer = Buffer.from(razorpaySignature);
    if (expectedBuffer.length !== receivedBuffer.length || !timingSafeEqual(expectedBuffer, receivedBuffer)) {
      const error = new Error('Payment signature is invalid.');
      error.statusCode = 400;
      throw error;
    }

    const [order, payment] = await Promise.all([
      client.orders.fetch(razorpayOrderId),
      client.payments.fetch(razorpayPaymentId),
    ]);
    if (
      order.amount !== amount * 100 ||
      order.currency !== 'INR' ||
      order.notes?.vehicle_type !== vehicleType ||
      order.notes?.coupon_code !== normalizedCoupon ||
      order.notes?.tip_amount !== String(tipAmount) ||
      payment.order_id !== razorpayOrderId ||
      payment.amount !== amount * 100 ||
      payment.currency !== 'INR' ||
      payment.status !== 'captured'
    ) {
      const error = new Error('Payment is not captured for the expected ride amount.');
      error.statusCode = 400;
      throw error;
    }

    return response.status(200).json({
      verified: true,
      paymentId: payment.id,
    });
  } catch (error) {
    if (
      error.message === 'Payment verification details are incomplete.' ||
      error.message === 'Payment signature is invalid.' ||
      error.message === 'Select a valid ride type.' ||
      error.message === 'The coupon code is invalid.' ||
      error.message === 'Select a valid tip amount.' ||
      error.message === 'Payment is not captured for the expected ride amount.'
    ) {
      error.statusCode = 400;
    }
    return sendPaymentError(response, error, 'verification');
  }
}
