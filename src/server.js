import dns from 'node:dns';

dns.setServers(['8.8.8.8', '8.8.4.4']);
import 'dotenv/config';
import crypto from 'node:crypto';
import mongoose from 'mongoose';

import { config } from './config.js';
import { db, connectDB, flush, save, id } from './db.js';
import { createApp } from './app.js';
import { hashPassword, purgeSessions, purgeFails } from './auth.js';
import { sweepAll } from './attempts.js';
import { seedDemo } from './seed.js';

// Start application
async function startServer() {
  try {
    // 1. Connect to MongoDB
    const existed = await connectDB();

    console.log('MongoDB connected successfully.');

    // 2. Reset database if --reset argument is provided
    if (process.argv.includes('--reset')) {
      db.data = {
        meta: { version: 1 },
        users: [],
        exams: [],
        attempts: [],
        challenges: [],
        sessions: {},
        audit: [],
      };

      await flush();
      console.log('MongoDB database cleared. Starting fresh.');
    }

    // 3. Seed demo data if required
    if (!db.data.users.length) {
      if (config.seedDemo) {
        await seedDemo();

        console.log(
          'Seeded demo data: 1 exam set, demo candidates and a synthetic cohort.'
        );
      }
    }

    // 4. Ensure an admin account always exists
    if (!db.data.users.some((u) => u.role === 'admin')) {
      const password =
        process.env.ADMIN_PASSWORD ||
        crypto.randomBytes(9).toString('base64url');

      db.data.users.push({
        id: id('u_'),
        role: 'admin',
        loginId: 'admin',
        name: 'Exam controller',
        passwordHash: await hashPassword(password),
        mustChangePassword: !process.env.ADMIN_PASSWORD,
      });

      save();

      if (!process.env.ADMIN_PASSWORD) {
        console.log(
          `Created admin account. Login: admin  Password: ${password}`
        );
      }
    }

    // 5. Ensure all startup changes are saved
    await flush();

    // 6. Create Express application
    const app = createApp();

    // 7. Start server
    const server = app.listen(config.port, () => {
      console.log(
        `\n  Pariksha is running at http://localhost:${config.port}\n`
      );

      if (config.seedDemo) {
        console.log('  Candidate  261000000001 / Demo@123');
        console.log('  Admin      admin / Admin@123  (change it from Settings)\n');
      }
    });

    // 8. Background task: attempt and session cleanup
    const sweeper = setInterval(() => {
      try {
        sweepAll();
        purgeSessions();
        purgeFails();
      } catch (error) {
        console.error('Background cleanup error:', error);
      }
    }, 5000);

    sweeper.unref();

    // 9. Graceful shutdown
    let shuttingDown = false;

    async function shutdown() {
      if (shuttingDown) return;
      shuttingDown = true;

      console.log('\nSaving data and shutting down...');

      clearInterval(sweeper);

      server.close(async () => {
        try {
          await flush();
          await mongoose.disconnect();

          console.log('MongoDB disconnected. Shutdown complete.');
          process.exit(0);
        } catch (error) {
          console.error('Shutdown error:', error);
          process.exit(1);
        }
      });

      // Force shutdown if requests do not finish
      setTimeout(() => {
        console.error('Forced shutdown.');
        process.exit(1);
      }, 10000).unref();
    }

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

  } catch (error) {
    console.error('Application startup failed:', error);
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
  }
}

startServer();
