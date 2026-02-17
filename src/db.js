import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, '../data');

if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir);
}

// Check for verbose flag to enable SQL logging
const db = new Database(path.join(dataDir, 'monitor.db'), {
    verbose: process.env.DB_VERBOSE === 'true' ? console.log : null
});
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
        notification_token TEXT,
        consecutive_fails INTEGER DEFAULT 0,
        threshold INTEGER DEFAULT 3
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

// Auto-cleanup trigger
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
        footer_text TEXT DEFAULT 'WiredAlter Status. All Systems Operational.',
        default_notification_url TEXT DEFAULT '',
        default_notification_token TEXT DEFAULT ''
    )
`);

// Initialize Default Settings
db.prepare(`
    INSERT OR IGNORE INTO settings (id, title, logo_url, footer_text)
    VALUES (1, 'System Status', '', 'WiredAlter Status. All Systems Operational.')
`).run();

// --- MIGRATIONS ---
try {
    // 1. Monitor columns
    const monitorCols = db.prepare("PRAGMA table_info(monitors)").all();
    if (!monitorCols.some(c => c.name === 'notification_token')) {
        console.log("⚙️ Migrating DB: Adding notification_token column to monitors...");
        db.prepare("ALTER TABLE monitors ADD COLUMN notification_token TEXT").run();
    }
    if (!monitorCols.some(c => c.name === 'notification_url')) {
        console.log("⚙️ Migrating DB: Adding notification_url column to monitors...");
        db.prepare("ALTER TABLE monitors ADD COLUMN notification_url TEXT").run();
    }

    // 2. Settings columns (For Global Webhooks)
    const settingsCols = db.prepare("PRAGMA table_info(settings)").all();
    if (!settingsCols.some(c => c.name === 'default_notification_url')) {
        console.log("⚙️ Migrating DB: Adding global notification settings...");
        db.prepare("ALTER TABLE settings ADD COLUMN default_notification_url TEXT DEFAULT ''").run();
        db.prepare("ALTER TABLE settings ADD COLUMN default_notification_token TEXT DEFAULT ''").run();
    }
    // 3. Add flapping protection
    if (!monitorCols.some(c => c.name === 'consecutive_fails')) {
        console.log("⚙️ Migrating DB: Adding consecutive_fails column...");
        db.prepare("ALTER TABLE monitors ADD COLUMN consecutive_fails INTEGER DEFAULT 0").run();
    }
    // 4. Add Threshold
    if (!monitorCols.some(c => c.name === 'threshold')) {
        console.log("⚙️ Migrating DB: Adding threshold column...");
        db.prepare("ALTER TABLE monitors ADD COLUMN threshold INTEGER DEFAULT 3").run();
    }
} catch (e) {
    console.error("Migration warning:", e.message);
}

export default db;
