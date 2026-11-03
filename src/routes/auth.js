
import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { db, refreshAuthData, flushSessions } from '../db.js';
import { config } from '../config.js';
import { HttpError } from '../util.js';

const scrypt = promisify(crypto.scrypt);

export const COOKIE = 'pk_session';
const sha = (t) => crypto.createHash('sha256').update(t).digest('hex');

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

export function parseCookies(header = '') {
  const out = {};

  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;

    out[part.slice(0, i).trim()] = decodeURIComponent(
      part.slice(i + 1).trim()
    );
  }

  return out;
}

// Create and persist a session
export async function createSession(user, req) {
  await refreshAuthData();

  const now = Date.now();

  for (const s of Object.values(db.data.sessions)) {
    if (s.userId === user.id && !s.revoked) {
      s.revoked = 'replaced';
    }
  }

  const token = crypto.randomBytes(32).toString('base64url');

  db.data.sessions[sha(token)] = {
    userId: user.id,
    createdAt: now,
    expiresAt: now + config.sessionTtlMs,
    ip: req.ip,
    ua: String(req.headers['user-agent'] || '').slice(0, 200),
  };

  await flushSessions();

  return token;
}

// Destroy and persist a session
export async function destroySession(req) {
  const token = parseCookies(req.headers.cookie)[COOKIE];

  if (!token) return;

  await refreshAuthData();
  delete db.data.sessions[sha(token)];
  await flushSessions();
}

// Purge expired sessions
export function purgeSessions(now = Date.now()) {
  for (const [key, session] of Object.entries(db.data.sessions)) {
    if (session.expiresAt < now) {
      delete db.data.sessions[key];
    }
  }
}

// Authenticate each request against current MongoDB data
export async function authenticate(req, _res, next) {
  try {
    await refreshAuthData();

    const token = parseCookies(req.headers.cookie)[COOKIE];
    const session = token && db.data.sessions[sha(token)];

    if (!session) {
      return next(
        new HttpError(401, 'unauthenticated', 'Sign in to continue.')
      );
    }

    if (session.revoked === 'replaced') {
      return next(
        new HttpError(
          401,
          'session_replaced',
          'You were signed out because this account signed in on another device.'
        )
      );
    }

    if (session.expiresAt < Date.now()) {
      return next(
        new HttpError(401, 'session_expired', 'Your session ended. Sign in again.')
      );
    }

    const user = db.data.users.find((u) => u.id === session.userId);

    if (!user) {
      return next(
        new HttpError(401, 'unauthenticated', 'Sign in to continue.')
      );
    }

    req.user = user;
    next();
  } catch (error) {
    next(error);
  }
}

export const requireRole = (role) => (req, _res, next) =>
  req.user?.role === role
    ? next()
    : next(new HttpError(403, 'forbidden', 'You do not have access to this page.'));

export function publicUser(user) {
  return {
    id: user.id,
    role: user.role,
    name: user.name,
    applicationNo: user.loginId,
    rollNo: user.rollNo,
    centre: user.centre,
    mustChangePassword: !!user.mustChangePassword,
  };
}

// Failed-login throttle
const fails = new Map();

export function throttleRemaining(key, now = Date.now()) {
  const record = fails.get(key);

  if (!record) return 0;

  if (now - record.first > config.loginWindowMs) {
    fails.delete(key);
    return 0;
  }

  return record.count >= config.loginMaxFails
    ? Math.ceil((record.first + config.loginWindowMs - now) / 1000)
    : 0;
}

export function recordFail(key, now = Date.now()) {
  const record = fails.get(key);

  if (!record || now - record.first > config.loginWindowMs) {
    fails.set(key, { count: 1, first: now });
  } else {
    record.count++;
  }
}

export const clearFails = (key) => fails.delete(key);

export function purgeFails(now = Date.now()) {
  for (const [key, record] of fails) {
    if (now - record.first > config.loginWindowMs) {
      fails.delete(key);
    }
  }
}
