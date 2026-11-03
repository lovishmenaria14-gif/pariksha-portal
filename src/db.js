
import crypto from 'node:crypto';
import mongoose from 'mongoose';
import { config } from './config.js';

// Initial database structure
const empty = () => ({
  meta: { version: 1 },
  users: [],
  exams: [],
  attempts: [],
  challenges: [],
  sessions: {},
  audit: [],
});

// Database state
export const db = {
  data: empty(),
  connected: false,
};

// MongoDB schema
const collectionSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      required: true,
      unique: true,
    },
    data: {
      type: mongoose.Schema.Types.Mixed,
      required: true,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

const Collection =
  mongoose.models.PortalData ||
  mongoose.model('PortalData', collectionSchema);

  // Dedicated MongoDB collection for authentication sessions
const sessionSchema = new mongoose.Schema(
  {
    tokenHash: { type: String, required: true, unique: true },
    userId: { type: String, required: true, index: true },
    createdAt: { type: Number, required: true },
    expiresAt: { type: Number, required: true, index: true },
    revoked: { type: String },
    ip: String,
    ua: String,
  },
  {
    versionKey: false,
    collection: 'portal_sessions',
  }
);

const Session =
  mongoose.models.PortalSession ||
  mongoose.model('PortalSession', sessionSchema);

// Persist a new session directly in MongoDB
export async function persistSession(tokenHash, session) {
  await Session.updateMany(
    {
      userId: session.userId,
      revoked: { $exists: false },
    },
    {
      $set: { revoked: 'replaced' },
    }
  );

  await Session.create({
    tokenHash,
    ...session,
  });
}

// Retrieve a session from MongoDB
export async function getPersistedSession(tokenHash) {
  return Session.findOne({ tokenHash }).lean();
}

// Delete a session from MongoDB
export async function deletePersistedSession(tokenHash) {
  await Session.deleteOne({ tokenHash });
}

// Remove expired sessions
export async function purgePersistedSessions(now = Date.now()) {
  await Session.deleteMany({
    expiresAt: { $lt: now },
  });
}
// Connect to MongoDB
export async function connectDB() {
  try {
    if (!config.mongoUri) {
      throw new Error('MONGODB_URI is missing from environment variables.');
    }

    await mongoose.connect(config.mongoUri);

    let record = await Collection.findOne({
      key: 'main',
    }).lean();

    const existed = !!record;

    if (!record) {
      record = await Collection.create({
        key: 'main',
        data: empty(),
      });

      record = record.toObject();
    }

    db.data = {
      ...empty(),
      ...record.data,
    };

    db.connected = true;

    console.log('MongoDB connected successfully.');

    return existed;
  } catch (error) {
    db.connected = false;
    console.error('MongoDB connection failed:', error);
    throw error;
  }
}

// Save all data to MongoDB
export async function flush() {
  if (!db.connected) {
    throw new Error('MongoDB is not connected.');
  }

  await Collection.updateOne(
    { key: 'main' },
    {
      $set: {
        data: db.data,
      },
    },
    {
      upsert: true,
    }
  );
}

// Refresh authentication data from MongoDB
export async function refreshAuthData() {
  if (!db.connected) {
    throw new Error('MongoDB is not connected.');
  }

  const record = await Collection.findOne({
    key: 'main',
  })
    .select('data.users data.sessions')
    .lean();

  if (!record) {
    throw new Error('Portal database record not found.');
  }

  db.data.users = record.data?.users || [];
  db.data.sessions = record.data?.sessions || {};
}

// Save sessions independently
export async function flushSessions() {
  if (!db.connected) {
    throw new Error('MongoDB is not connected.');
  }

  await Collection.updateOne(
    { key: 'main' },
    {
      $set: {
        'data.sessions': db.data.sessions,
      },
    }
  );
}

// Debounced save
let saveTimer = null;

export function save() {
  clearTimeout(saveTimer);

  saveTimer = setTimeout(async () => {
    try {
      await flush();
    } catch (error) {
      console.error('Could not save database:', error);
    }
  }, 400);

  saveTimer.unref?.();
}

// Generate unique IDs
export const id = (prefix = '') =>
  prefix + crypto.randomBytes(8).toString('hex');

// Audit logs
export function audit(by, action, detail = '') {
  db.data.audit.push({
    at: Date.now(),
    by,
    action,
    detail,
  });

  // Keep the latest 2000 logs
  if (db.data.audit.length > 2000) {
    db.data.audit.splice(
      0,
      db.data.audit.length - 2000
    );
  }

  save();
}
