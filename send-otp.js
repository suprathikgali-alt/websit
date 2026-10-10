import { adminDb, HttpError } from '../_lib/firebaseAdmin.js';
import { route } from '../_lib/http.js';
import { codeEmail, sendEmail } from '../_lib/email.js';
import { emailKey, hashCode, newCode, normalizeEmail, OTP_RESEND_MS, OTP_TTL_MS } from '../_lib/otp.js';

export default route('POST', async (req, body) => {
  const email = normalizeEmail(body.email);
  const id = emailKey(email);
  const ref = adminDb().collection('emailOtpChallenges').doc(id);

  const existing = await ref.get();
  if (existing.exists && Date.now() - existing.data().createdAt < OTP_RESEND_MS) {
    throw new HttpError(429, 'Please wait 30 seconds before asking for another code.');
  }

  const code = newCode();
  await ref.set({
    codeHash: hashCode(`login:${id}`, code),
    createdAt: Date.now(),
    expiresAt: Date.now() + OTP_TTL_MS,
    attempts: 0
  });

  const { text, html } = codeEmail('Your ARIDE sign-in code', 'Use this code to sign in to ARIDE.', code);
  await sendEmail({ to: email, subject: 'Your ARIDE sign-in code', text, html });
  return { sent: true };
});
