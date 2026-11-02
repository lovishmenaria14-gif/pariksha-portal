import { Router } from 'express';
import { db, save, audit } from '../db.js';
import { config } from '../config.js';
import { HttpError, bad } from '../util.js';
import {
  COOKIE,
  authenticate,
  createSession,
  destroySession,
  verifyPassword,
  hashPassword,
  dummyVerify,
  publicUser,
  throttleRemaining,
  recordFail,
  clearFails,
} from '../auth.js';

export const authRouter = Router();

// Demo hints are only exposed while the demo data is enabled.
authRouter.get('/hints', (_req, res) => {
  res.json(
    config.seedDemo
      ? {
          demo: {
            candidate: { applicationNo: '261000000001', password: 'Demo@123' },
            admin: { applicationNo: 'admin', password: 'Admin@123' },
          },
        }
      : { demo: null },
  );
});

authRouter.post('/login', async (req, res, next) => {
  try {
    const { applicationNo, password } = req.body || {};
    if (typeof applicationNo !== 'string' || typeof password !== 'string' || !applicationNo.trim() || !password) {
      throw bad('missing_fields', 'Enter your application number and password.');
    }
    if (applicationNo.length > 64 || password.length > 128) throw bad('invalid_credentials', 'Application number or password is incorrect.');

    const loginId = applicationNo.trim().toLowerCase();
    const key = `${loginId}|${req.ip}`;
    const wait = throttleRemaining(key);
    if (wait > 0) {
      const mins = Math.ceil(wait / 60);
      throw new HttpError(429, 'too_many_attempts', `Too many wrong attempts. Try again in ${mins} minute${mins === 1 ? '' : 's'}.`, {
        retryAfter: wait,
      });
    }

    const user = db.data.users.find((u) => u.loginId === loginId);
    const ok = user ? await verifyPassword(password, user.passwordHash) : (await dummyVerify(password), false);
    if (!ok) {
      recordFail(key);
      throw new HttpError(401, 'invalid_credentials', 'Application number or password is incorrect.');
    }
    clearFails(key);
    const token = createSession(user, req);
    res.cookie(COOKIE, token, {
      httpOnly: true,
      sameSite: 'strict',
      secure: config.cookieSecure,
      maxAge: config.sessionTtlMs,
      path: '/',
    });
    res.json({ user: publicUser(user) });
  } catch (e) {
    next(e);
  }
});

authRouter.post('/logout', (req, res) => {
  destroySession(req);
  res.clearCookie(COOKIE, { path: '/' });
  res.json({ ok: true });
});

authRouter.get('/me', authenticate, (req, res) => res.json({ user: publicUser(req.user) }));

authRouter.post('/change-password', authenticate, async (req, res, next) => {
  try {
    const { current, next: nextPw } = req.body || {};
    if (typeof nextPw !== 'string' || nextPw.length < 8 || nextPw.length > 128) {
      throw bad('weak_password', 'Use a new password of at least 8 characters.');
    }
    if (!(await verifyPassword(String(current ?? ''), req.user.passwordHash))) {
      throw new HttpError(401, 'invalid_credentials', 'Current password is incorrect.');
    }
    req.user.passwordHash = await hashPassword(nextPw);
    req.user.mustChangePassword = false;
    audit(req.user.loginId, 'password.change');
    save();
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});
