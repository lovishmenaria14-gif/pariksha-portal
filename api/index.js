
import { connectDB } from '../src/db.js';
import { createApp } from '../src/app.js';
import { config } from '../src/config.js';
import { db, flush, id } from '../src/db.js';
import { hashPassword } from '../src/auth.js';
import { seedDemo } from '../src/seed.js';
import crypto from 'node:crypto';

let initialization;

async function initialize() {
  await connectDB();

  if (!db.data.users.length && config.seedDemo) {
    await seedDemo();
  }

  const admin = db.data.users.find((u) => u.role === 'admin');

  if (admin && process.env.ADMIN_PASSWORD) {
    admin.passwordHash = await hashPassword(process.env.ADMIN_PASSWORD);
    admin.mustChangePassword = true;
    await flush();
    console.log('Admin password updated successfully.');
  } else if (!admin) {
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

export default async function handler(req, res) {
  try {
    initialization ||= initialize().catch((error) => {
      initialization = null;
      throw error;
    });

    await initialization;
    return app(req, res);
  } catch (error) {
    console.error('Vercel initialization error:', error);
    return res.status(500).json({
      error: 'server_initialization_failed',
      message: 'Server initialization failed.',
    });
  }
}
