export default function getPaymentStatus(request, response) {
  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET');
    return response.status(405).json({ message: 'Use GET for payment status.' });
  }

  const onlinePaymentsAvailable = Boolean(
    process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET
  );

  return response.status(200).json({
    onlinePaymentsAvailable,
    message: onlinePaymentsAvailable
      ? 'Online checkout is ready.'
      : 'Online payments are not configured. Cash is available.',
  });
}
