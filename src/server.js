import fs from 'node:fs';
import crypto from 'node:crypto';
import { config } from './config.js';
import { db, load, flush, save, id } from './db.js';
import { createApp } from './app.js';
import { hashPassword, purgeSessions, purgeFails } from './auth.js';
import { sweepAll } from './attempts.js';
import { seedDemo } from './seed.js';

if (process.argv.includes('--reset')) {
  fs.rmSync(config.dataFile, { force: true });
  console.log('Database file removed. Starting fresh.');
}

const existed = load();

if (!existed || !db.data.users.length) {
  if (config.seedDemo) {
    await seedDemo();
    console.log('Seeded demo data: 1 exam set, demo candidates and a synthetic cohort.');
  }
}

// Make sure there is always a way in, even with SEED_DEMO=0.
if (!db.data.users.some((u) => u.role === 'admin')) {
  const password = process.env.ADMIN_PASSWORD || crypto.randomBytes(9).toString('base64url');
  db.data.users.push({
    id: id('u_'),
    role: 'admin',
    loginId: 'admin',
    name: 'Exam controller',
    passwordHash: await hashPassword(password),
    mustChangePassword: !process.env.ADMIN_PASSWORD,
  });
  save();
  if (!process.env.ADMIN_PASSWORD) console.log(`Created admin account. Login: admin  Password: ${password}`);
}

const app = createApp();
const server = app.listen(config.port, () => {
  console.log(`\n  Pariksha is running at http://localhost:${config.port}\n`);
  if (config.seedDemo) {
    console.log('  Candidate  261000000001 / Demo@123');
    console.log('  Admin      admin / Admin@123  (change it from Settings)\n');
  }
});

// Closes attempts whose time is over, even if the candidate has gone offline.
const sweeper = setInterval(() => {
  sweepAll();
  purgeSessions();
  purgeFails();
}, 5000);
sweeper.unref();

function shutdown() {
  console.log('Saving data and shutting down...');
  clearInterval(sweeper);
  try {
    flush();
  } catch (e) {
    console.error(e);
  }
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
