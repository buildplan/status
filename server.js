import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { getIronSession } from 'iron-session'; // FIXED IMPORT
import db from './src/db.js';
import { startMonitoring } from './src/monitor.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin';

// --- CONFIGURATION ---
// Generate a secure random password if one isn't provided
const COOKIE_PASSWORD = process.env.SESSION_SECRET || 'complex_password_at_least_32_characters_long';

const sessionConfig = {
    password: COOKIE_PASSWORD,
    cookieName: 'wiredalter_status_session',
    ttl: 60 * 60 * 24, // 24 hours
    cookieOptions: {
        secure: process.env.NODE_ENV === 'production', // Secure in prod (HTTPS)
        httpOnly: true,
    }
};

// Middleware
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// --- FIXED SESSION MIDDLEWARE ---
// We manually retrieve the session and attach it to the request
app.use(async (req, res, next) => {
    try {
        req.session = await getIronSession(req, res, sessionConfig);
        next();
    } catch (err) {
        console.error("Session Error:", err);
        next(err);
    }
});

// --- ROUTES ---

// Public Status Page
app.get('/', (req, res) => {
    const monitors = db.prepare('SELECT * FROM monitors').all();
    const enriched = monitors.map(m => {
        const history = db.prepare('SELECT status, latency, timestamp FROM heartbeats WHERE monitor_id = ? ORDER BY id DESC LIMIT 50').all(m.id).reverse();
        return { ...m, history };
    });

    res.render('index', { monitors: enriched });
});

// Admin Dashboard
app.get('/admin', (req, res) => {
    if (!req.session.authenticated) return res.redirect('/login');
    const monitors = db.prepare('SELECT * FROM monitors').all();
    res.render('admin', { monitors });
});

// Login
app.get('/login', (req, res) => res.render('login'));

app.post('/login', async (req, res) => {
    if (req.body.password === ADMIN_PASSWORD) {
        req.session.authenticated = true;
        await req.session.save(); // REQUIRED: Explicit save
        res.redirect('/admin');
    } else {
        res.redirect('/login?error=1');
    }
});

// Logout
app.get('/logout', async (req, res) => {
    req.session.destroy();
    res.redirect('/');
});

// API: Add Monitor
app.post('/api/monitors', (req, res) => {
    if (!req.session.authenticated) return res.status(401).send();
    const { name, url, notification_url, notification_token, interval } = req.body;
    db.prepare(`
        INSERT INTO monitors (name, url, notification_url, notification_token, interval)
        VALUES (?, ?, ?, ?, ?)
    `).run(name, url, notification_url, notification_token, interval || 60);
    res.redirect('/admin');
});

// API: Delete Monitor
app.post('/api/monitors/delete/:id', (req, res) => {
    if (!req.session.authenticated) return res.status(401).send();
    db.prepare('DELETE FROM monitors WHERE id = ?').run(req.params.id);
    res.redirect('/admin');
});

// Start
app.listen(PORT, () => {
    console.log(`🌍 Status Service running on port ${PORT}`);
    startMonitoring();
});
