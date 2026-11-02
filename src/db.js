import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from './config.js';

// A deliberately small persistence layer: everything lives in memory and is written
// to one JSON file with atomic renames. Swap this module for Postgres/Mongo when you
// outgrow a single node - every other module only touches db.data collections.
const empty = () => ({
  meta: { version: 1 },
  users: [],
  exams: [],
  attempts: [],
  challenges: [],
  sessions: {},
  audit: [],
});

export const db = { data: empty(), timer: null };

export function load() {
  try {
    const raw = fs.readFileSync(config.dataFile, 'utf8');
    db.data = { ...empty(), ...JSON.parse(raw) };
    return true;
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
    db.data = empty();
    return false;
  }
}

export function flush() {
  clearTimeout(db.timer);
  db.timer = null;
  fs.mkdirSync(path.dirname(config.dataFile), { recursive: true });
  const tmp = `${config.dataFile}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(db.data));
  fs.renameSync(tmp, config.dataFile);
}

// Debounced write - cheap to call after every mutation.
export function save() {
  if (db.timer) return;
  db.timer = setTimeout(() => {
    db.timer = null;
    try {
      flush();
    } catch (e) {
      console.error('Could not write database file:', e);
    }
  }, 400);
  db.timer.unref?.();
}

export const id = (prefix = '') => prefix + crypto.randomBytes(8).toString('hex');

export function audit(by, action, detail = '') {
  db.data.audit.push({ at: Date.now(), by, action, detail });
  if (db.data.audit.length > 2000) db.data.audit.splice(0, db.data.audit.length - 2000);
  save();
}
