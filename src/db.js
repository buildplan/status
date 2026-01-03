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
db.pragma('journal_mode = WAL');

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

// Auto-cleanup
// Deletes records older than 30 days whenever a new heartbeat is added
db.exec(`
    CREATE TRIGGER IF NOT EXISTS clean_old_heartbeats
    AFTER INSERT ON heartbeats
    BEGIN
        DELETE FROM heartbeats WHERE timestamp < datetime('now', '-30 days');
    END;
`);

// Settings Table
db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        title TEXT DEFAULT 'System Status',
        logo_url TEXT DEFAULT '',
        footer_text TEXT DEFAULT 'WiredAlter Status. All Systems Operational.'
    )
`);

// Initialize Default Settings
db.prepare(`INSERT OR IGNORE INTO settings (id, title, logo_url, footer_text) VALUES (1, 'System Status', '', 'WiredAlter Status. All Systems Operational.')`).run();

// Safe Column Addition
try {
    const columns = db.prepare("PRAGMA table_info(monitors)").all();
    const hasToken = columns.some(c => c.name === 'notification_token');
    if (!hasToken) {
        console.log("⚙️ Migrating DB: Adding notification_token column...");
        db.prepare("ALTER TABLE monitors ADD COLUMN notification_token TEXT").run();
    }
    const hasUrl = columns.some(c => c.name === 'notification_url');
    if (!hasUrl) {
        console.log("⚙️ Migrating DB: Adding notification_url column...");
        db.prepare("ALTER TABLE monitors ADD COLUMN notification_url TEXT").run();
    }
} catch (e) {
    console.error("Migration warning:", e.message);
}

export default db;
