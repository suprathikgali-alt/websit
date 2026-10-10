import { adminAuth, HttpError } from './firebaseAdmin.js';

export function route(methods, handler) {
  const allowed = Array.isArray(methods) ? methods : [methods];
  return async function (req, res) {
    res.setHeader('Cache-Control', 'no-store');
    if (!allowed.includes(req.method)) {
      res.setHeader('Allow', allowed.join(', '));
      return res.status(405).json({ message: 'Method not allowed.' });
    }
    try {
      const body = typeof req.body === 'string' ? safeParse(req.body) : (req.body || {});
      const result = await handler(req, body);
      return res.status(200).json(result);
    } catch (error) {
      if (error instanceof HttpError) {
        return res.status(error.status).json({ message: error.message });
      }
      console.error('ARIDE API error:', error);
      return res.status(500).json({ message: 'Something went wrong on the server. Please try again.' });
    }
  };
}

function safeParse(text) {
  try { return JSON.parse(text); } catch { throw new HttpError(400, 'Invalid JSON body.'); }
}

export async function requireUser(req) {
  const header = req.headers.authorization || '';
  const match = header.match(/^Bearer (.+)$/);
  if (!match) throw new HttpError(401, 'Please sign in first.');
  try {
    return await adminAuth().verifyIdToken(match[1]);
  } catch {
    throw new HttpError(401, 'Your session expired. Please sign in again.');
  }
}

export function requireString(value, name, max = 200) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) {
    throw new HttpError(400, `${name} is required.`);
  }
  return value.trim();
}
