import sqlite3 from 'sqlite3';
import fs from 'fs';
import path from 'path';
import { logger } from '../utils/logger.js';

const dataDir = process.env.DATA_DIR || './data';

if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'wa_gateway.db');
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    logger.error({ err }, 'Failed to connect to SQLite database');
  } else {
    logger.info(`Connected to SQLite database at ${dbPath}`);
  }
});

// Initialize database schema
db.serialize(() => {
  // Logs table
  db.run(`
    CREATE TABLE IF NOT EXISTS logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      phone_number TEXT NOT NULL,
      message TEXT,
      type TEXT NOT NULL, -- 'sent' or 'received'
      status TEXT NOT NULL, -- 'pending', 'success', 'failed'
      error TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  // Existing installations are migrated automatically; new logs record sender session.
  db.run(`ALTER TABLE logs ADD COLUMN session_id TEXT NOT NULL DEFAULT 'default'`, () => {});

  // Settings table
  db.run(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    )
  `);

  // Users table
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      name TEXT NOT NULL,
      role TEXT DEFAULT 'admin',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  // Legacy assignment column is kept for compatibility; session ownership is many-to-one below.
  db.run(`ALTER TABLE users ADD COLUMN session_id TEXT`, () => {});
  db.run(`DROP INDEX IF EXISTS idx_users_one_session`);
  db.run(`
    CREATE TABLE IF NOT EXISTS whatsapp_sessions (
      session_id TEXT PRIMARY KEY,
      owner_user_id INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (owner_user_id) REFERENCES users(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS webhook_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event TEXT,
      session_id TEXT,
      payload TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Seed default admin (admin / admin123)
  const defaultAdminHash = '$2b$10$75m6yfQACzuIZp390bGLJO/rjsFcavRIPNhkZirRbmfQ2HslFLSYq';
  db.run(`
    INSERT OR IGNORE INTO users (id, username, password, name, role) 
    VALUES (1, 'admin', ?, 'Administrator', 'admin')
  `, [defaultAdminHash]);

  // Default API Key setting if not exists
  const defaultApiKey = process.env.API_KEY || 'wagateway_secret_key_123';
  db.run(`
    INSERT OR IGNORE INTO settings (key, value) VALUES ('api_key', ?)
  `, [defaultApiKey]);

  // Default Webhook URL setting if not exists
  const defaultWebhook = process.env.WEBHOOK_URL || '';
  db.run(`
    INSERT OR IGNORE INTO settings (key, value) VALUES ('webhook_url', ?)
  `, [defaultWebhook]);
});

// Database helper functions wrapped in Promises
export const dbRun = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
};

export const dbGet = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
};

export const dbAll = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
};

export default db;
