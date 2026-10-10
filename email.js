import { HttpError } from './firebaseAdmin.js';

export async function sendEmail({ to, subject, text, html }) {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL;
  if (!key || !from) throw new HttpError(503, 'Email sending is not configured on the server.');
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to: [to], subject, text, html })
  });
  if (!response.ok) {
    console.error('Resend error:', response.status, await response.text().catch(() => ''));
    throw new HttpError(502, 'Could not send the email. Please try again shortly.');
  }
}

export function codeEmail(title, intro, code) {
  const text = `${intro}\n\nYour ARIDE code: ${code}\n\nIt expires in 10 minutes. If you did not request it, ignore this email.`;
  const html = `<div style="font-family:Arial,sans-serif;max-width:420px;margin:auto;padding:24px">
    <h2 style="color:#0E300E;margin:0 0 8px">${title}</h2>
    <p style="color:#444">${intro}</p>
    <p style="font-size:34px;letter-spacing:8px;font-weight:700;color:#A4863D;margin:20px 0">${code}</p>
    <p style="color:#777;font-size:12px">Expires in 10 minutes. If you did not request this, ignore this email.</p></div>`;
  return { text, html };
}
