
import crypto from 'node:crypto';
import { promisify } from 'node:util';

import {
  db,
  persistSession,
  getPersistedSession,
  deletePersistedSession,
  purgePersistedSessions,
  refreshAuthData,
} from './db.js';

import { config } from './config.js';
import { HttpError } from './util.js';

const scrypt = promisify(crypto.scrypt);

export const COOKIE = 'pk_session';

const sha = (t) =>
  crypto.createHash('sha256').update(t).digest('hex');

// Password hashing
export async function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(String(pw), salt, 64);

  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export async function verifyPassword(pw, stored) {
  try {
    const [, saltHex, hashHex] = String(stored).split('$');

    const expected = Buffer.from(hashHex, 'hex');
    const actual = await scrypt(
      String(pw),
      Buffer.from(saltHex, 'hex'),
      expected.length
    );

    return crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

let dummyHash;

export async function dummyVerify(pw) {
  dummyHash ??= await hashPassword('not-a-real-password');
  await verifyPassword(pw, dummyHash);
}

// Cookie parsing
export function parseCookies(header = '') {
  const out = {};

  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;

    try {
      out[part.slice(0, i).trim()] =
        decodeURIComponent(part.slice(i + 1).trim());
    } catch {
      continue;
    }
  }

  return out;
}

// Create a session directly in MongoDB
export async function createSession(user, req) {
  const now = Date.now();
  const token = crypto.randomBytes(32).toString('base64url');

  await persistSession(sha(token), {
    userId: user.id,
    createdAt: now,
    expiresAt: now + config.sessionTtlMs,
    ip: req.ip,
    ua: String(req.headers['user-agent'] || '').slice(0, 200),
  });

  return token;
}

// Destroy a session
export async function destroySession(req) {
  const token = parseCookies(req.headers.cookie)[COOKIE];

  if (token) {
    await deletePersistedSession(sha(token));
  }
}

// Clean expired sessions
export async function purgeSessions(now = Date.now()) {
  await purgePersistedSessions(now);
}

// Authenticate using MongoDB session storage
export async function authenticate(req, _res, next) {
  try {
    const token = parseCookies(req.headers.cookie)[COOKIE];

    if (!token) {
      throw new HttpError(
        401,
        'unauthenticated',
        'Sign in to continue.'
      );
    }

    await refreshAuthData();

    const session = await getPersistedSession(sha(token));

    if (!session) {
      throw new HttpError(
        401,
        'unauthenticated',
        'Sign in to continue.'
      );
    }

    if (session.revoked === 'replaced') {
      throw new HttpError(
        401,
        'session_replaced',
        'You were signed out because this account signed in on another device.'
      );
    }

    if (session.expiresAt < Date.now()) {
      throw new HttpError(
        401,
        'session_expired',
        'Your session ended. Sign in again.'
      );
    }

    const user = db.data.users.find(
      (u) => u.id === session.userId
    );

    if (!user) {
      throw new HttpError(
        401,
        'unauthenticated',
        'Sign in to continue.'
      );
    }

    req.user = user;
    next();
  } catch (error) {
    next(error);
  }
}

// Role authorization
export const requireRole = (role) => (req, _res, next) =>
  req.user?.role === role
    ? next()
    : next(
        new HttpError(
          403,
          'forbidden',
          'You do not have access to this page.'
        )
      );

// Public user information
export function publicUser(u) {
  return {
    id: u.id,
    role: u.role,
    name: u.name,
    applicationNo: u.loginId,
    rollNo: u.rollNo,
    centre: u.centre,
    email: u.email || '',
    phone: u.phone || '',
    photoURL: u.photoURL || '',
    mustChangePassword: !!u.mustChangePassword,
  };
}

// Failed-login throttle
const fails = new Map();

export function throttleRemaining(key, now = Date.now()) {
  const r = fails.get(key);

  if (!r) return 0;

  if (now - r.first > config.loginWindowMs) {
    fails.delete(key);
    return 0;
  }

  return r.count >= config.loginMaxFails
    ? Math.ceil(
        (r.first + config.loginWindowMs - now) / 1000
      )
    : 0;
}

export function recordFail(key, now = Date.now()) {
  const r = fails.get(key);

  if (!r || now - r.first > config.loginWindowMs) {
    fails.set(key, { count: 1, first: now });
  } else {
    r.count++;
  }
}

export const clearFails = (key) => fails.delete(key);

export function purgeFails(now = Date.now()) {
  for (const [k, r] of fails) {
    if (now - r.first > config.loginWindowMs) {
      fails.delete(k);
    }
  }
}
