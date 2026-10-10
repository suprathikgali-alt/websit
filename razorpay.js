import Razorpay from 'razorpay';
import { HttpError } from './firebaseAdmin.js';

export function razorpayConfigured() {
  return Boolean(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET)
    && !process.env.RAZORPAY_KEY_ID.includes('replace_with')
    && !process.env.RAZORPAY_KEY_SECRET.includes('replace_with');
}

export function firebaseAdminConfigured() {
  return Boolean(process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY)
    && !process.env.FIREBASE_PROJECT_ID.includes('your-project');
}

export function razorpayClient() {
  if (!razorpayConfigured()) throw new HttpError(503, 'Online payments are not configured. Choose cash instead.');
  return new Razorpay({ key_id: process.env.RAZORPAY_KEY_ID, key_secret: process.env.RAZORPAY_KEY_SECRET });
}
