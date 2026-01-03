import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { getIronSession } from 'iron-session';
import db from './src/db.js';
import { startMonitoring } from './src/monitor.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// --- CONFIGURATION ---
const COOKIE_PASSWORD = process.env.SESSION_SECRET || 'complex_password_at_least_32_characters_long';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin';

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
publicApp.set('view engine', 'ejs');
publicApp.set('views', path.join(__dirname, 'views'));
publicApp.use(express.static('public')); // Serve CSS/Assets

// Public Route: Status Page
publicApp.get('/', (req, res) => {
    const monitors = db.prepare('SELECT * FROM monitors').all();
    let globalStatus = 'operational';
    let totalLatency = 0;
    let onlineCount = 0;

    const enriched = monitors.map(m => {
        // Get last 50 checks
        const history = db.prepare('SELECT status, latency, timestamp FROM heartbeats WHERE monitor_id = ? ORDER BY id DESC LIMIT 50').all(m.id).reverse();

        // Calculate Uptime
        const upCount = history.filter(h => h.status === 'up').length;
        const totalCount = history.length || 1;
        const uptime = Math.round((upCount / totalCount) * 100);

        // Global Stats calculations
        if (m.status === 'up') onlineCount++;
        if (m.status === 'down') globalStatus = 'degraded';
        totalLatency += m.response_time || 0;

        return { ...m, history, uptime };
    });

    const avgLatency = monitors.length > 0 ? Math.round(totalLatency / monitors.length) : 0;

    // If less than 80% services are up, mark as outage
    if ((onlineCount / monitors.length) < 0.8 && monitors.length > 0) globalStatus = 'outage';
    res.render('index', {
        monitors: enriched,
        stats: {
            active: monitors.length,
            online: onlineCount,
            avgLatency,
            status: globalStatus
        }
    });
});

// APP 2: ADMIN INTERFACE (Port 3001)
const adminApp = express();
adminApp.use(express.urlencoded({ extended: true }));
adminApp.set('view engine', 'ejs');
adminApp.set('views', path.join(__dirname, 'views'));
adminApp.use(express.static('public')); // Share assets


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
    res.render('admin', { monitors });
});

adminApp.get('/login', (req, res) => res.render('login'));

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

// API Routes (Only accessible on Admin Port)
adminApp.post('/api/monitors', (req, res) => {
    if (!req.session.authenticated) return res.status(401).send();
    const { name, url, notification_url, notification_token, interval } = req.body;
    db.prepare(`
        INSERT INTO monitors (name, url, notification_url, notification_token, interval)
        VALUES (?, ?, ?, ?, ?)
    `).run(name, url, notification_url, notification_token, interval || 60);
    res.redirect('/admin');
});

adminApp.post('/api/monitors/delete/:id', (req, res) => {
    if (!req.session.authenticated) return res.status(401).send();
    db.prepare('DELETE FROM monitors WHERE id = ?').run(req.params.id);
    res.redirect('/admin');
});

adminApp.post('/api/monitors/edit/:id', (req, res) => {
    if (!req.session.authenticated) return res.status(401).send();
    const { name, url, interval, notification_url, notification_token } = req.body;
    try {
        db.prepare(`
            UPDATE monitors
            SET name = ?, url = ?, interval = ?, notification_url = ?, notification_token = ?
            WHERE id = ?
        `).run(name, url, interval || 60, notification_url, notification_token, req.params.id);
        res.redirect('/admin');
    } catch (err) {
        console.error("Failed to update monitor:", err);
        res.redirect('/admin?error=update_failed');
    }
});

// START BOTH SERVERS
publicApp.listen(3000, () => console.log(`🌍 Public Status Page running on port 3000`));
adminApp.listen(3001, () => console.log(`🔒 Admin Dashboard running on port 3001 (Internal Only)`));

startMonitoring();
