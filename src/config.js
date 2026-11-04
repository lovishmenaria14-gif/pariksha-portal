
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..'
);

export const config = {
  // Application paths
  root,
  port: Number(process.env.PORT) || 3000,
  publicDir: path.join(root, 'public'),

  // MongoDB configuration
  mongoUri: process.env.MONGODB_URI,
  databaseMode: process.env.DB_MODE || '',
  dataFile: process.env.DATA_FILE || path.join(root, 'data', 'db.json'),

  // Cookie and proxy settings
  // Set COOKIE_SECURE=1 when the site is served over HTTPS.
  cookieSecure: process.env.COOKIE_SECURE === '1',

  // Set TRUST_PROXY=1 behind nginx or a load balancer.
  trustProxy: process.env.TRUST_PROXY === '1',

  // Session settings
  sessionTtlMs: 8 * 60 * 60 * 1000,
  loginMaxFails: 5,
  loginWindowMs: 15 * 60 * 1000,

  // Exam timing settings
  // Responses arriving up to this long after the deadline are accepted.
  graceMs: 3000,

  // Demo data
  // Seeds demo exam, candidates and synthetic cohort on first run.
  seedDemo: process.env.SEED_DEMO !== '0',
};
