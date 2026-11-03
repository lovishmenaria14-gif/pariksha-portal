
import crypto from 'node:crypto';
import { firebaseAuth } from '../firebase-admin.js';
import { Router } from 'express';
import { db, save, flush, audit, id } from '../db.js';
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

// Demo login hints
authRouter.get('/hints', (_req, res) => {
  res.json(
    config.seedDemo
      ? {
          demo: {
            candidate: {
              applicationNo: '261000000001',
              password: 'Demo@123',
            },
            admin: {
              applicationNo: 'admin',
              password: 'Admin@123',
            },
          },
        }
      : { demo: null },
  );
});

// Normal application number and password login
authRouter.post('/login', async (req, res, next) => {
  try {
    const { applicationNo, password } = req.body || {};

    if (
      typeof applicationNo !== 'string' ||
      typeof password !== 'string' ||
      !applicationNo.trim() ||
      !password
    ) {
      throw bad(
        'missing_fields',
        'Enter your application number and password.',
      );
    }

    if (applicationNo.length > 64 || password.length > 128) {
      throw bad(
        'invalid_credentials',
        'Application number or password is incorrect.',
      );
    }

    const loginId = applicationNo.trim().toLowerCase();
    const key = `${loginId}|${req.ip}`;

    const wait = throttleRemaining(key);

    if (wait > 0) {
      const mins = Math.ceil(wait / 60);

      throw new HttpError(
        429,
        'too_many_attempts',
        `Too many wrong attempts. Try again in ${mins} minute${mins === 1 ? '' : 's'}.`,
        { retryAfter: wait },
      );
    }

    const user = db.data.users.find((u) => u.loginId === loginId);

    const ok = user
      ? await verifyPassword(password, user.passwordHash)
      : (await dummyVerify(password), false);

    if (!ok) {
      recordFail(key);

      throw new HttpError(
        401,
        'invalid_credentials',
        'Application number or password is incorrect.',
      );
    }

    clearFails(key);

    const token = await createSession(user, req);

    res.cookie(COOKIE, token, {
      httpOnly: true,
      sameSite: 'strict',
      secure: config.cookieSecure,
      maxAge: config.sessionTtlMs,
      path: '/',
    });

    res.json({ user: publicUser(user) });
  } catch (error) {
    next(error);
  }
});

// Self-registration for candidates
 authRouter.post('/signup', async (req, res, next) => {
  try {
    const { name, applicationNo, email, password } = req.body || {};

    if (typeof name !== 'string' || name.trim().length < 2 || name.trim().length > 80) {
      throw bad('invalid_name', 'Enter your full name (2–80 characters).');
    }
    if (typeof applicationNo !== 'string' || !/^\d{12}$/.test(applicationNo.trim())) {
      throw bad('invalid_application_no', 'Application number must contain exactly 12 digits.');
    }
    if (typeof email !== 'string' || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      throw bad('invalid_email', 'Enter a valid email address.');
    }
    if (typeof password !== 'string' || password.length < 8 || password.length > 128) {
      throw bad('weak_password', 'Use a password of at least 8 characters.');
    }

    const normalizedEmail = email.trim().toLowerCase();
    if (db.data.users.some((u) => u.email?.toLowerCase() === normalizedEmail)) {
      throw new HttpError(409, 'email_exists', 'An account already exists with this email.');
    }

    const normalizedApplicationNo = applicationNo.trim();
    if (db.data.users.some((u) => u.loginId === normalizedApplicationNo.toLowerCase())) {
      throw new HttpError(409, 'application_no_exists', 'An account already exists with this application number.');
    }

    const user = {
      id: id('u_'),
      role: 'candidate',
      loginId: normalizedApplicationNo.toLowerCase(),
      name: name.trim(),
      email: normalizedEmail,
      passwordHash: await hashPassword(password),
      createdAt: Date.now(),
    };
    db.data.users.push(user);
    audit(user.loginId, 'candidate.register', normalizedEmail);
    await flush();

    const token = await createSession(user, req);
    res.cookie(COOKIE, token, {
      httpOnly: true,
      sameSite: 'strict',
      secure: config.cookieSecure,
      maxAge: config.sessionTtlMs,
      path: '/',
    });
    res.status(201).json({ user: publicUser(user) });
  } catch (error) {
    next(error);
  }
});

// Verify the account details and reset a forgotten password.
authRouter.post('/forgot-password', async (req, res, next) => {
  try {
    const { applicationNo, email, password } = req.body || {};
    if (typeof applicationNo !== 'string' || typeof email !== 'string' || typeof password !== 'string') {
      throw bad('missing_fields', 'Enter your application number, email and new password.');
    }
    if (password.length < 8 || password.length > 128) {
      throw bad('weak_password', 'Use a new password of at least 8 characters.');
    }

    const loginId = applicationNo.trim().toLowerCase();
    const normalizedEmail = email.trim().toLowerCase();
    const user = db.data.users.find((u) => u.loginId === loginId);
    if (!user || user.role !== 'candidate' || user.email?.toLowerCase() !== normalizedEmail) {
      throw new HttpError(404, 'account_not_found', 'No matching account was found. Check the details and try again.');
    }

    user.passwordHash = await hashPassword(password);
    user.mustChangePassword = false;
    audit(user.loginId, 'password.reset.self');
    await flush();
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

// Google sign-in and automatic candidate registration
authRouter.post('/google', async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization || '';

    if (!authHeader.startsWith('Bearer ')) {
      throw new HttpError(
        401,
        'missing_token',
        'Google authentication required.',
      );
    }

    const idToken = authHeader.substring(7);
    if (!firebaseAuth) {
      throw new HttpError(503, 'google_auth_unavailable', 'Google login is not configured on this server.');
    }
    const decoded = await firebaseAuth.verifyIdToken(idToken);

    if (!decoded.email || !decoded.email_verified) {
      throw new HttpError(
        403,
        'email_not_verified',
        'Please verify your Google email.',
      );
    }

    const email = decoded.email.toLowerCase();

    let user = db.data.users.find(
      (u) => u.firebaseUid === decoded.uid,
    );

    if (!user) {
      const existing = db.data.users.find(
        (u) => u.email?.toLowerCase() === email,
      );

      if (existing) {
        if (existing.role !== 'candidate') {
          throw new HttpError(
            403,
            'account_type',
            'This account cannot use candidate login.',
          );
        }

        existing.firebaseUid = decoded.uid;
        user = existing;
      } else {
        user = {
          id: id('u_'),
          role: 'candidate',
          loginId:
            'PK' +
            crypto.randomBytes(8).toString('hex').toUpperCase(),
          name: decoded.name || email.split('@')[0],
          email,
          photoURL: decoded.picture || '',
          firebaseUid: decoded.uid,
          passwordHash: '!',
          createdAt: Date.now(),
        };

        db.data.users.push(user);
      }

      save();
      audit(user.loginId, 'google.register', email);
    }

   const sessionToken = await createSession(user, req);

    res.cookie(COOKIE, sessionToken, {
      httpOnly: true,
      sameSite: 'strict',
      secure: config.cookieSecure,
      maxAge: config.sessionTtlMs,
      path: '/',
    });

    res.json({ user: publicUser(user) });
  } catch (error) {
    next(error);
  }
});

// Logout
authRouter.post('/logout', async (req, res, next) => {
  try {
    await destroySession(req);
    res.clearCookie(COOKIE, {
      path: '/',
      httpOnly: true,
      sameSite: 'strict',
      secure: config.cookieSecure,
    });
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

// Current logged-in user
authRouter.get('/me', authenticate, (req, res) => {
  res.json({ user: publicUser(req.user) });
});

// Change password
authRouter.post(
  '/change-password',
  authenticate,
  async (req, res, next) => {
    try {
      const { current, next: nextPw } = req.body || {};

      if (
        typeof nextPw !== 'string' ||
        nextPw.length < 8 ||
        nextPw.length > 128
      ) {
        throw bad(
          'weak_password',
          'Use a new password of at least 8 characters.',
        );
      }

      if (
        !(await verifyPassword(
          String(current ?? ''),
          req.user.passwordHash,
        ))
      ) {
        throw new HttpError(
          401,
          'invalid_credentials',
          'Current password is incorrect.',
        );
      }

      req.user.passwordHash = await hashPassword(nextPw);
      req.user.mustChangePassword = false;

      audit(req.user.loginId, 'password.change');
      await flush();

      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  },
);
