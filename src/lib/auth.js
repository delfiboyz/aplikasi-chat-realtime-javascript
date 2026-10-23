import jwt from 'jsonwebtoken';
import { parseCookie } from 'cookie';
import { config } from '../config.js';

export function signToken(user) {
  return jwt.sign({ sub: user.id, username: user.username }, config.jwtSecret, {
    expiresIn: config.jwtExpiresIn,
  });
}

/** Returns `{ id, username }` for a valid token, otherwise `null`. */
export function verifyToken(token) {
  if (!token) return null;
  try {
    const payload = jwt.verify(token, config.jwtSecret);
    return { id: payload.sub, username: payload.username };
  } catch {
    return null;
  }
}

export function tokenFromCookieHeader(header) {
  if (!header) return null;
  return parseCookie(header)[config.cookieName] ?? null;
}

export const cookieOptions = () => ({
  httpOnly: true,
  sameSite: 'strict',
  secure: config.isProduction,
  path: '/',
  maxAge: 7 * 24 * 60 * 60 * 1000,
});
