import { randomUUID } from 'node:crypto';
import { calculateRideAmount, getRazorpay, sendMethodNotAllowed, sendPaymentError } from '../_lib/razorpay.js';

export default async function createPaymentOrder(request, response) {
  if (request.method !== 'POST') return sendMethodNotAllowed(response);

  try {
    const { vehicleType, couponCode, tipAmount = 0 } = request.body || {};
    const normalizedCoupon = typeof couponCode === 'string' ? couponCode.trim().toUpperCase() : '';
    const amount = calculateRideAmount(vehicleType, normalizedCoupon, tipAmount);
    const { client, keyId } = getRazorpay();
    const order = await client.orders.create({
      amount: amount * 100,
      currency: 'INR',
      receipt: `aride_${randomUUID().replaceAll('-', '')}`,
      payment_capture: 1,
      notes: {
        vehicle_type: vehicleType,
        coupon_code: normalizedCoupon,
        tip_amount: String(tipAmount),
      },
    });

    return response.status(200).json({
      id: order.id,
      amount: order.amount,
      currency: order.currency,
      keyId,
    });
  } catch (error) {
    if (
      error.message === 'Select a valid ride type.' ||
      error.message === 'The coupon code is invalid.' ||
      error.message === 'Select a valid tip amount.'
    ) {
      error.statusCode = 400;
    }
    return sendPaymentError(response, error, 'order creation');
  }
}
