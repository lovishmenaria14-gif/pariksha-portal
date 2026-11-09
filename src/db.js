
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import mongoose from 'mongoose';
import { config } from './config.js';

// Initial database structure
const empty = () => ({
  meta: { version: 1 },
  users: [],
  exams: [],
  attempts: [],
  challenges: [],
  bookmarks: [],
  sessions: {},
  audit: [],
  announcements: [],
  supportTickets: [],
  activity: [],
});

// Database state
export const db = {
  data: empty(),
  connected: false,
  storage: null,
};

let fileMode = false;
let fileFlushPromise = Promise.resolve();

function isLocalMongoUri(uri) {
  if (typeof uri !== 'string') return false;
  try {
    const host = new URL(uri).hostname.toLowerCase();
    return host === 'localhost' || host === '127.0.0.1' || host === '::1';
  } catch {
    return false;
  }
}

function loadFileData() {
  if (!fs.existsSync(config.dataFile)) {
    db.data = empty();
    return false;
  }
  const parsed = JSON.parse(fs.readFileSync(config.dataFile, 'utf8'));
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`Local database file is not a JSON object: ${config.dataFile}`);
  }
  db.data = { ...empty(), ...parsed };
  return true;
}

export function load() {
  fileMode = true;
  db.storage = 'file';
  db.connected = true;
  return loadFileData();
}

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
  if (fileMode) {
    for (const [hash, existing] of Object.entries(db.data.sessions || {})) {
      if (existing.userId === session.userId && !existing.revoked) {
        existing.revoked = 'replaced';
        db.data.sessions[hash] = existing;
      }
    }
    db.data.sessions ||= {};
    db.data.sessions[tokenHash] = session;
    await flush();
    return;
  }
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
  if (fileMode) return db.data.sessions?.[tokenHash] || null;
  return Session.findOne({ tokenHash }).lean();
}

// Delete a session from MongoDB
export async function deletePersistedSession(tokenHash) {
  if (fileMode) {
    if (db.data.sessions) delete db.data.sessions[tokenHash];
    await flush();
    return;
  }
  await Session.deleteOne({ tokenHash });
}

// Remove expired sessions
export async function purgePersistedSessions(now = Date.now()) {
  if (fileMode) {
    for (const [hash, session] of Object.entries(db.data.sessions || {})) {
      if (session.expiresAt < now) delete db.data.sessions[hash];
    }
    await flush();
    return;
  }
  await Session.deleteMany({
    expiresAt: { $lt: now },
  });
}
// Connect to MongoDB
export async function connectDB() {
  try {
    if (config.databaseMode === 'file' || isLocalMongoUri(config.mongoUri)) {
      const existed = load();
      console.log(`Local JSON database ${existed ? 'loaded' : 'initialized'} at ${config.dataFile}.`);
      return existed;
    }

    if (!config.mongoUri) {
      throw new Error('MONGODB_URI is missing. Set it to a MongoDB Atlas URI, or set DB_MODE=file for local JSON storage.');
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
    db.storage = 'mongodb';
    fileMode = false;

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
    throw new Error('Database is not connected.');
  }

  if (fileMode) {
    const target = path.resolve(config.dataFile);
    const temp = `${target}.${process.pid}.tmp`;
    const writeFileData = async () => {
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(temp, JSON.stringify(db.data), 'utf8');
      await rename(temp, target);
    };
    fileFlushPromise = fileFlushPromise.then(writeFileData, writeFileData);
    await fileFlushPromise;
    return;
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
    throw new Error('Database is not connected.');
  }
  if (fileMode) return;

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

export async function refreshDatabase() {
  if (!db.connected) {
    throw new Error('Database is not connected.');
  }
  if (fileMode) return;

  const record = await Collection.findOne({
    key: 'main',
  }).lean();

  if (!record) {
    throw new Error('Portal database record not found.');
  }

  db.data = {
    ...empty(),
    ...record.data,
  };
}

// Save sessions independently
export async function flushSessions() {
  if (!db.connected) {
    throw new Error('Database is not connected.');
  }
  if (fileMode) {
    await flush();
    return;
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
