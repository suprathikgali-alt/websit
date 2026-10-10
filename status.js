import { firebaseAdminConfigured, razorpayConfigured } from '../_lib/razorpay.js';
import { route } from '../_lib/http.js';

export default route('GET', async () => {
  const ready = razorpayConfigured() && firebaseAdminConfigured();
  return {
    onlinePaymentsAvailable: ready,
    methods: ready ? ['online', 'cash'] : ['cash'],
    message: ready ? '' : 'Online payments are not configured. Cash is available.'
  };
});
