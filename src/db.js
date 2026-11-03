
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
