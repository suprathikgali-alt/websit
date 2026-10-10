import { adminAuth, adminDb, HttpError } from '../_lib/firebaseAdmin.js';
import { route } from '../_lib/http.js';
import { codesMatch, emailKey, normalizeEmail, OTP_MAX_ATTEMPTS, validCodeFormat } from '../_lib/otp.js';

export default route('POST', async (req, body) => {
  const email = normalizeEmail(body.email);
  const code = validCodeFormat(body.code);
  const id = emailKey(email);
  const ref = adminDb().collection('emailOtpChallenges').doc(id);

  // Check and count the attempt atomically so codes cannot be brute-forced in parallel.
  // The transaction returns an outcome (rather than throwing) so counter updates are committed.
  const outcome = await adminDb().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return 'missing';
    const data = snap.data();
    if (Date.now() > data.expiresAt) { tx.delete(ref); return 'expired'; }
    if (data.attempts >= OTP_MAX_ATTEMPTS) { tx.delete(ref); return 'locked'; }
    if (!codesMatch(data.codeHash, `login:${id}`, code)) {
      tx.update(ref, { attempts: data.attempts + 1 });
      return 'wrong';
    }
    tx.delete(ref);
    return 'ok';
  });
  if (outcome === 'missing') throw new HttpError(400, 'No code was requested for this email. Request a new one.');
  if (outcome === 'expired') throw new HttpError(400, 'This code expired. Request a new one.');
  if (outcome === 'locked') throw new HttpError(429, 'Too many wrong attempts. Request a new code.');
  if (outcome === 'wrong') throw new HttpError(400, 'That code is not correct.');

  const auth = adminAuth();
  let user;
  try {
    user = await auth.getUserByEmail(email);
  } catch (error) {
    if (error.code !== 'auth/user-not-found') throw error;
    user = await auth.createUser({ email, emailVerified: true });
  }
  const token = await auth.createCustomToken(user.uid);
  return { token };
});
