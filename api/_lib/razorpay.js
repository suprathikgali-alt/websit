import Razorpay from 'razorpay';

const allowedTips = new Set([0, 10, 20, 50]);
const rideFares = {
  bike: 55,
  auto: 95,
  cab: 250,
  parcel: 75,
};

export function calculateRideAmount(vehicleType, couponCode, tipAmount = 0) {
  if (!Object.hasOwn(rideFares, vehicleType)) {
    throw new Error('Select a valid ride type.');
  }
  if (!Number.isInteger(tipAmount) || !allowedTips.has(tipAmount)) {
    throw new Error('Select a valid tip amount.');
  }

  const normalizedCoupon = typeof couponCode === 'string' ? couponCode.trim().toUpperCase() : '';
  if (normalizedCoupon && normalizedCoupon !== 'SOUTH50' && normalizedCoupon !== 'ARIDE50') {
    throw new Error('The coupon code is invalid.');
  }

  const fare = rideFares[vehicleType];
  return (normalizedCoupon ? Math.max(20, fare - 25) : fare) + tipAmount;
}

export function getRazorpay() {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keyId || !keySecret) {
    const error = new Error('Online payments are not configured. Add Razorpay test/live keys to the server environment.');
    error.statusCode = 503;
    throw error;
  }

  return {
    client: new Razorpay({ key_id: keyId, key_secret: keySecret }),
    keyId,
    keySecret,
  };
}

export function sendMethodNotAllowed(response) {
  response.setHeader('Allow', 'POST');
  return response.status(405).json({ message: 'Use POST for this payment endpoint.' });
}

export function sendPaymentError(response, error, action) {
  const statusCode = error.statusCode === 400 || error.statusCode === 503 ? error.statusCode : 502;
  if (statusCode >= 500) console.error(`Razorpay ${action} failed:`, error);
  return response.status(statusCode).json({
    message: statusCode === 503 || statusCode === 400
      ? error.message
      : `Online payment ${action} failed. Please try again or choose cash.`,
  });
}
