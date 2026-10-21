import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { rateLimit } from 'express-rate-limit';
import { config } from '../config.js';
import { cookieOptions, signToken } from '../lib/auth.js';
import { credentialsSchema, parse } from '../lib/validation.js';
import { ConflictError } from '../store/errors.js';
import { requireAuth } from '../middleware/requireAuth.js';

export function authRouter({ store, onUserCreated }) {
  const router = Router();

  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 20,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: 'Terlalu banyak percobaan, coba lagi nanti' },
  });

  const startSession = (res, user) => {
    res.cookie(config.cookieName, signToken(user), cookieOptions());
    res.json({ user });
  };

  router.post('/register', limiter, async (req, res) => {
    const { data, error } = parse(credentialsSchema, req.body);
    if (error) return res.status(400).json({ error });
    try {
      const passwordHash = await bcrypt.hash(data.password, 12);
      const user = await store.createUser({ username: data.username, passwordHash });
      onUserCreated?.(user);
      res.status(201);
      startSession(res, user);
    } catch (err) {
      if (err instanceof ConflictError) return res.status(409).json({ error: err.message });
      throw err;
    }
  });

  router.post('/login', limiter, async (req, res) => {
    const { data, error } = parse(credentialsSchema, req.body);
    if (error) return res.status(400).json({ error: 'Username atau password salah' });
    const found = await store.findUserForLogin(data.username);
    const valid = found && (await bcrypt.compare(data.password, found.passwordHash));
    if (!valid) return res.status(401).json({ error: 'Username atau password salah' });
    startSession(res, found.user);
  });

  router.post('/logout', (req, res) => {
    const { maxAge: _maxAge, ...options } = cookieOptions();
    res.clearCookie(config.cookieName, options);
    res.status(204).end();
  });

  router.get('/me', requireAuth, async (req, res) => {
    const user = await store.getUser(req.user.id);
    if (!user) return res.status(401).json({ error: 'Sesi tidak valid' });
    res.json({ user });
  });

  return router;
}
