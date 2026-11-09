import { connectDB, db, flush, id } from '../src/db.js';
import { createApp } from '../src/app.js';
import { config } from '../src/config.js';
import { hashPassword } from '../src/auth.js';
import { seedDemo } from '../src/seed.js';
import crypto from 'node:crypto';

let initialization;

// Initialize the database and ensure an admin account exists.
async function initialize() {
  await connectDB();

  // Seed demo data when the database is empty.
  if (!db.data.users.length && config.seedDemo) {
    await seedDemo();
  }

  const admin = db.data.users.find((u) => u.role === 'admin');

  // Create an admin account only when one does not already exist.
  // Preserve the existing password across Vercel cold starts.
  if (!admin) {
    const password =
      process.env.ADMIN_PASSWORD ||
      crypto.randomBytes(18).toString('base64url');

    db.data.users.push({
      id: id('u_'),
      role: 'admin',
      loginId: 'admin',
      name: 'Exam controller',
      passwordHash: await hashPassword(password),
      mustChangePassword: !process.env.ADMIN_PASSWORD,
    });

    await flush();

    if (!process.env.ADMIN_PASSWORD) {
      console.error('Generated admin password:', password);
    }
  }
}

const app = createApp();

// Handle incoming requests after successful initialization.
export default async function handler(req, res) {
  try {
    initialization ||= initialize().catch((error) => {
      initialization = null;
      throw error;
    });

    await initialization;
    return app(req, res);
  } catch (error) {
    console.error('Vercel server initialization failed:', error);

    return res.status(500).json({
      error: 'server_initialization_failed',
      message: 'Server initialization failed.',
    });
  }
}
