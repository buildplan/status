import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, '../data');

if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir);
}

const db = new Database(path.join(dataDir, 'monitor.db'));

// Monitors Table
db.exec(`
    CREATE TABLE IF NOT EXISTS monitors (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT,
        url TEXT,
        type TEXT DEFAULT 'http',
        interval INTEGER DEFAULT 60,
        status TEXT DEFAULT 'pending',
        response_time INTEGER DEFAULT 0,
        last_checked DATETIME,
        notification_url TEXT,
        notification_token TEXT
    )
`);

// Heartbeats Table
db.exec(`
    CREATE TABLE IF NOT EXISTS heartbeats (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        monitor_id INTEGER,
        status TEXT,
        latency INTEGER,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(monitor_id) REFERENCES monitors(id) ON DELETE CASCADE
    )
`);

// Settings Table
db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
        id INTEGER PRIMARY KEY CHECK (id = 1), -- Ensure only one row exists
        title TEXT DEFAULT 'System Status',
        logo_url TEXT DEFAULT '',
        footer_text TEXT DEFAULT 'WiredAlter Status. All Systems Operational.'
    )
`);

// Initialize default settings if they don't exist
db.prepare(`INSERT OR IGNORE INTO settings (id, title, logo_url, footer_text) VALUES (1, 'System Status', '', 'WiredAlter Status. All Systems Operational.')`).run();

export default db;
