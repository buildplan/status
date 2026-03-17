import session from 'express-session';

export default class SQLiteStore extends session.Store {
    constructor(options = {}) {
        super(options);
        this.db = options.client;

        // Create the sessions table
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS sessions (
                sid TEXT PRIMARY KEY,
                data TEXT NOT NULL,
                expires INTEGER NOT NULL
            )
        `);

        // auto-cleanup interval
        const cleanupInterval = options.cleanupInterval || 1000 * 60 * 15; // Default: 15 mins
        setInterval(() => {
            try {
                this.db.prepare('DELETE FROM sessions WHERE expires <= ?').run(Date.now());
            } catch (e) {
                console.error('🧹 Session cleanup error:', e.message);
            }
        }, cleanupInterval);
    }

    // Fetch a session by ID
    get(sid, cb) {
        try {
            const row = this.db.prepare('SELECT data FROM sessions WHERE sid = ? AND expires > ?').get(sid, Date.now());
            if (row) return cb(null, JSON.parse(row.data));
            cb(null, null); // Session not found or expired
        } catch (err) {
            cb(err);
        }
    }

    // Save or update a session
    set(sid, sessionData, cb) {
        try {
            // Calculate expiration time from the cookie, default to 24 hours
            const expires = sessionData.cookie?.expires
                ? new Date(sessionData.cookie.expires).getTime()
                : Date.now() + 86400000;

            const data = JSON.stringify(sessionData);

            // Upsert (Insert, or Update if the session ID already exists)
            this.db.prepare(`
                INSERT INTO sessions (sid, data, expires)
                VALUES (?, ?, ?)
                ON CONFLICT(sid) DO UPDATE SET data = excluded.data, expires = excluded.expires
            `).run(sid, data, expires);

            cb(null);
        } catch (err) {
            cb(err);
        }
    }

    // Delete a session (e.g., on logout)
    destroy(sid, cb) {
        try {
            this.db.prepare('DELETE FROM sessions WHERE sid = ?').run(sid);
            cb(null);
        } catch (err) {
            cb(err);
        }
    }

    // Refresh the expiration time so active users don't get logged out
    touch(sid, sessionData, cb) {
        try {
            const expires = sessionData.cookie?.expires
                ? new Date(sessionData.cookie.expires).getTime()
                : Date.now() + 86400000;

            this.db.prepare('UPDATE sessions SET expires = ? WHERE sid = ?').run(expires, sid);
            cb(null);
        } catch (err) {
            cb(err);
        }
    }
}
