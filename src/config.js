import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const config = {
  root,
  port: Number(process.env.PORT) || 3000,
  dataFile: process.env.DATA_FILE || path.join(root, 'data', 'db.json'),
  publicDir: path.join(root, 'public'),
  // Set COOKIE_SECURE=1 when the site is served over HTTPS.
  cookieSecure: process.env.COOKIE_SECURE === '1',
  // Set TRUST_PROXY=1 when running behind nginx / a load balancer so req.ip is the real client.
  trustProxy: process.env.TRUST_PROXY === '1',
  sessionTtlMs: 8 * 60 * 60 * 1000,
  loginMaxFails: 5,
  loginWindowMs: 15 * 60 * 1000,
  // Responses arriving up to this long after the deadline are still accepted (network jitter).
  graceMs: 3000,
  // Seeds a demo exam, demo candidates and a synthetic cohort on first run.
  seedDemo: process.env.SEED_DEMO !== '0',
};
