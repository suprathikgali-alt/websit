import { createHmac } from 'node:crypto';
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore, Timestamp } from 'firebase-admin/firestore';

export function getFirebaseAdmin() {
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');
  if (!projectId || !clientEmail || !privateKey) {
    const error = new Error('Email OTP is not configured. Add the Firebase Admin service-account environment variables.');
    error.statusCode = 503;
    throw error;
  }

  const app = getApps()[0] || initializeApp({
    credential: cert({ projectId, clientEmail, privateKey }),
    projectId,
  });
  return {
    auth: getAuth(app),
    db: getFirestore(app),
  };
}

export function getOtpHashSecret() {
  const secret = process.env.OTP_HASH_SECRET;
  if (!secret || secret.length < 32) {
    const error = new Error('Email OTP is not configured. Set OTP_HASH_SECRET to a random value of at least 32 characters.');
    error.statusCode = 503;
    throw error;
  }
  return secret;
}

export function hashEmail(email) {
  return createHmac('sha256', getOtpHashSecret()).update(email).digest('hex');
}

export function hashOtp(scope, code) {
  return createHmac('sha256', getOtpHashSecret()).update(`${scope}:${code}`).digest('hex');
}

export function normalizeEmail(value) {
  if (typeof value !== 'string') return null;
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return email;
}

export function verifyBearerToken(request, auth) {
  const authorization = request.headers?.authorization || request.headers?.Authorization || '';
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    const error = new Error('Sign in before requesting a trip code.');
    error.statusCode = 401;
    throw error;
  }
  return auth.verifyIdToken(match[1]);
}

export function sendJson(response, statusCode, body) {
  return response.status(statusCode).json(body);
}

export function sendOtpError(response, error, fallback) {
  const statusCode = [400, 401, 403, 404, 409, 429, 503].includes(error.statusCode)
    ? error.statusCode
    : 502;
  if (statusCode >= 500) console.error(fallback, error);
  return sendJson(response, statusCode, {
    message: statusCode === 502 ? fallback : error.message,
  });
}

export async function sendEmailOtp({ email, code, purpose }) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL;
  if (!apiKey || !from) {
    const error = new Error('Email OTP is not configured. Add RESEND_API_KEY and a verified RESEND_FROM_EMAIL.');
    error.statusCode = 503;
    throw error;
  }

  const subject = purpose === 'sign-in' ? 'Your ARIDE sign-in code' : 'Your ARIDE trip-start code';
  const action = purpose === 'sign-in' ? 'sign in to ARIDE' : 'start your ARIDE trip';
  const result = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: [email],
      subject,
      text: `Your ARIDE code to ${action} is ${code}. It expires in 10 minutes. Do not share this code with anyone.`,
      html: `<p>Your ARIDE code to ${action} is:</p><p style="font-size:28px;font-weight:bold;letter-spacing:8px">${code}</p><p>It expires in 10 minutes. Do not share this code with anyone.</p>`,
    }),
  });
  if (!result.ok) {
    const details = await result.text();
    console.error('Resend email delivery failed:', result.status, details);
    const error = new Error('The email service could not send your code. Check the Resend sender domain and try again.');
    error.statusCode = 502;
    throw error;
  }
}

export { FieldValue, Timestamp };
