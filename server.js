import express from 'express';
import { rateLimit } from 'express-rate-limit';
import path from 'path';
import { fileURLToPath } from 'url';
import { getIronSession } from 'iron-session';
import db from './src/db.js';
import { startMonitoring } from './src/monitor.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// --- CONFIGURATION ---
const COOKIE_PASSWORD = process.env.SESSION_SECRET || 'complex_password_at_least_32_characters_long';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin';
const PUBLIC_URL = process.env.PUBLIC_URL;

const sessionConfig = {
    password: COOKIE_PASSWORD,
    cookieName: 'wiredalter_status_session',
    ttl: 60 * 60 * 24, // 24 hours
    cookieOptions: {
        secure: process.env.NODE_ENV === 'production',
        httpOnly: true,
    }
};

// APP 1: PUBLIC INTERFACE (Port 3000)
const publicApp = express();
publicApp.set('trust proxy', 'loopback, linklocal, uniquelocal');
const publicLimiter = rateLimit({
    windowMs: 1 * 60 * 1000,
    limit: 60,
    standardHeaders: true,
    legacyHeaders: false,
    message: "Too many requests to the status page. Please wait a moment."
});

// Security middleware
if (PUBLIC_URL) {
    try {
        const allowedHost = new URL(PUBLIC_URL).host;
        console.log(`🔒 Security: Restricting public access to host: ${allowedHost}`);
        publicApp.use((req, res, next) => {
            if (req.headers.host !== allowedHost) {
                return res.status(403).send(`Access Denied: Please visit ${PUBLIC_URL}`);
            }
            next();
        });
    } catch (e) {
        console.error("❌ Invalid PUBLIC_URL provided. Security middleware skipped.");
    }
}

publicApp.set('view engine', 'ejs');
publicApp.set('views', path.join(__dirname, 'views'));
publicApp.use(express.static('public'));
publicApp.use(publicLimiter);

// Public Status Page
publicApp.get('/', (req, res) => {
    const monitors = db.prepare('SELECT * FROM monitors').all();
    const settings = db.prepare('SELECT * FROM settings WHERE id = 1').get();
    let globalStatus = 'operational';
    let totalLatency = 0;
    let onlineCount = 0;
    const enriched = monitors.map(m => {
        const history = db.prepare('SELECT status, latency, timestamp FROM heartbeats WHERE monitor_id = ? ORDER BY id DESC LIMIT 50').all(m.id).reverse();
        const upCount = history.filter(h => h.status === 'up').length;
        const totalCount = history.length || 1;
        const uptime = Math.round((upCount / totalCount) * 100);
        if (m.status === 'up') onlineCount++;
        if (m.status === 'down') globalStatus = 'degraded';
        totalLatency += m.response_time || 0;
        return { ...m, history, uptime };
    });
    const avgLatency = monitors.length > 0 ? Math.round(totalLatency / monitors.length) : 0;
    if ((onlineCount / monitors.length) < 0.8 && monitors.length > 0) globalStatus = 'outage';
    res.render('index', {
        monitors: enriched,
        settings,
        stats: { active: monitors.length, online: onlineCount, avgLatency, status: globalStatus }
    });
});

// APP 2: ADMIN INTERFACE (Port 3001)
const adminApp = express();
adminApp.set('trust proxy', 'loopback, linklocal, uniquelocal');
const adminLimiter = rateLimit({
	windowMs: 15 * 60 * 1000,
	limit: 100,
	standardHeaders: true,
	legacyHeaders: false,
    message: "Too many requests from this IP, please try again after 15 minutes"
});

adminApp.use(adminLimiter);
adminApp.use(express.urlencoded({ extended: true }));
adminApp.set('view engine', 'ejs');
adminApp.set('views', path.join(__dirname, 'views'));
adminApp.use(express.static('public'));


// Admin Session Middleware
adminApp.use(async (req, res, next) => {
    try {
        const isTunnel = req.headers.host?.includes('localhost') || req.headers.host?.includes('127.0.0.1');
        const dynamicConfig = {
            ...sessionConfig,
            cookieOptions: {
                ...sessionConfig.cookieOptions,
                secure: process.env.NODE_ENV === 'production' && !isTunnel
            }
        };
        req.session = await getIronSession(req, res, dynamicConfig);
        next();
    } catch (err) {
        console.error("Session Error:", err);
        next(err);
    }
});

// Admin Routes
adminApp.get('/', (req, res) => res.redirect('/admin'));

adminApp.get('/admin', (req, res) => {
    if (!req.session.authenticated) return res.redirect('/login');
    const monitors = db.prepare('SELECT * FROM monitors').all();
    const settings = db.prepare('SELECT * FROM settings WHERE id = 1').get();
    res.render('admin', { monitors, settings, publicUrl: PUBLIC_URL || 'http://localhost:3000' });
});

adminApp.get('/login', (req, res) => res.render('login', { publicUrl: PUBLIC_URL || 'http://localhost:3000' }));

adminApp.post('/login', async (req, res) => {
    if (req.body.password === ADMIN_PASSWORD) {
        req.session.authenticated = true;
        await req.session.save();
        res.redirect('/admin');
    } else {
        res.redirect('/login?error=1');
    }
});

adminApp.get('/logout', async (req, res) => {
    req.session.destroy();
    res.redirect('/');
});

// API Routes
adminApp.post('/api/monitors', (req, res) => {
    if (!req.session.authenticated) return res.status(401).send();
    const { name, url, notification_url, notification_token, interval, threshold } = req.body;
    db.prepare(`
        INSERT INTO monitors (name, url, notification_url, notification_token, interval, threshold)
        VALUES (?, ?, ?, ?, ?, ?)
    `).run(name, url, notification_url, notification_token, interval || 60, threshold || 3);
    res.redirect('/admin');
});

adminApp.post('/api/monitors/delete/:id', (req, res) => {
    if (!req.session.authenticated) return res.status(401).send();
    db.prepare('DELETE FROM monitors WHERE id = ?').run(req.params.id);
    res.redirect('/admin');
});

adminApp.post('/api/monitors/edit/:id', (req, res) => {
    if (!req.session.authenticated) return res.status(401).send();
    const { name, url, interval, notification_url, notification_token, threshold } = req.body;
    try {
        db.prepare(`
            UPDATE monitors
            SET name = ?, url = ?, interval = ?, notification_url = ?, notification_token = ?, threshold = ?
            WHERE id = ?
        `).run(name, url, interval || 60, notification_url, notification_token, threshold || 3, req.params.id);
        res.redirect('/admin');
    } catch (err) {
        console.error("Failed to update monitor:", err);
        res.redirect('/admin?error=update_failed');
    }
});

// API: Update Settings
adminApp.post('/api/settings', (req, res) => {
    if (!req.session.authenticated) return res.status(401).send();
    const { title, logo_url, footer_text, default_notification_url, default_notification_token } = req.body;
    db.prepare(`
        UPDATE settings
        SET title = ?, logo_url = ?, footer_text = ?, default_notification_url = ?, default_notification_token = ?
        WHERE id = 1
    `).run(title, logo_url, footer_text, default_notification_url, default_notification_token);
    res.redirect('/admin');
});

// START BOTH SERVERS
const publicServer = publicApp.listen(3000, () => console.log(`🌍 Public Status Page running on port 3000`));
const adminServer = adminApp.listen(3001, () => console.log(`🔒 Admin Dashboard running on port 3001 (Internal Only)`));

startMonitoring();

// GRACEFUL SHUTDOWN
const shutdown = () => {
    console.log('🛑 SIGTERM/SIGINT received. Shutting down...');

    publicServer.close(() => console.log('🌍 Public server closed'));
    adminServer.close(() => console.log('🔒 Admin server closed'));

    try {
        db.close();
        console.log('💾 Database connection closed');
        process.exit(0);
    } catch (err) {
        console.error('❌ Error during shutdown:', err);
        process.exit(1);
    }
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
