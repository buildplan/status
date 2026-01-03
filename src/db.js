import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

// Ensure data directory exists
const dataDir = process.env.DATA_DIR || './data';
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir);

const db = new Database(path.join(dataDir, 'monitor.db'));

// Initialize Tables
db.exec(`
  CREATE TABLE IF NOT EXISTS monitors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    type TEXT DEFAULT 'http', -- http, ping
    url TEXT NOT NULL,
    interval INTEGER DEFAULT 60, -- seconds
    status TEXT DEFAULT 'pending', -- up, down, pending
    last_checked DATETIME,
    response_time INTEGER,
    notification_url TEXT
  );

  CREATE TABLE IF NOT EXISTS heartbeats (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    monitor_id INTEGER,
    status TEXT,
    latency INTEGER,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(monitor_id) REFERENCES monitors(id) ON DELETE CASCADE
  );

  -- Auto-cleanup old heartbeats (keep last 30 days)
  CREATE TRIGGER IF NOT EXISTS clean_old_heartbeats
  AFTER INSERT ON heartbeats
  BEGIN
    DELETE FROM heartbeats WHERE timestamp < datetime('now', '-30 days');
  END;
`);

export default db;
