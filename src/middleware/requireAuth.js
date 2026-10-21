import { tokenFromCookieHeader, verifyToken } from '../lib/auth.js';

/** Accepts the session cookie, or an `Authorization: Bearer` token for API clients. */
export function requireAuth(req, res, next) {
  const bearer = req.get('authorization')?.replace(/^Bearer\s+/i, '');
  const user = verifyToken(tokenFromCookieHeader(req.headers.cookie) ?? bearer);
  if (!user) return res.status(401).json({ error: 'Silakan login terlebih dahulu' });
  req.user = user;
  next();
}
