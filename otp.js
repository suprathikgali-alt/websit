import { createHash, createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import { HttpError } from './firebaseAdmin.js';

export const OTP_TTL_MS = 10 * 60 * 1000;
export const OTP_RESEND_MS = 30 * 1000;
export const OTP_MAX_ATTEMPTS = 5;

export function newCode() {
  return String(randomInt(0, 1000000)).padStart(6, '0');
}

function secret() {
  const value = process.env.OTP_HASH_SECRET || '';
  if (value.length < 32) throw new HttpError(503, 'Server is not configured: OTP_HASH_SECRET must be at least 32 characters.');
  return value;
}

export function hashCode(scope, code) {
  return createHmac('sha256', secret()).update(`${scope}:${code}`).digest('hex');
}

export function codesMatch(expectedHex, scope, code) {
  const actual = Buffer.from(hashCode(scope, code), 'hex');
  const expected = Buffer.from(expectedHex, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function emailKey(email) {
  return createHash('sha256').update(email).digest('hex');
}

export function normalizeEmail(value) {
  const email = String(value || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || email.length > 254) {
    throw new HttpError(400, 'Enter a valid email address.');
  }
  return email;
}

export function validCodeFormat(code) {
  if (!/^\d{6}$/.test(String(code || ''))) throw new HttpError(400, 'Enter the six-digit code.');
  return String(code);
}
