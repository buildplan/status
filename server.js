import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { streamSSE } from 'hono/streaming';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import db from './src/db.js';
import { startMonitoring } from './src/monitor.js';
import { appEvents } from './src/events.js';

const JWT_SECRET = process.env.SESSION_SECRET;
if (process.env.NODE_ENV === 'production' && !JWT_SECRET) {
    console.error("FATAL: SESSION_SECRET environment variable is required in production!");
    process.exit(1);
}
const ACTIVE_JWT_SECRET = JWT_SECRET || 'complex_password_at_least_32_characters_long';

const ADMIN_PASSWORD_HASH = process.env.ADMIN_PASSWORD || '$2b$10$amhjuiQEqeRGd5AAYhGBtuSYNpWA14mMtMwKMmTZPYPS4n55k.MEe'; // Default hash for 'admin'
const PUBLIC_URL = process.env.PUBLIC_URL;

const publicApp = new Hono();

let publicCache = { data: null, lastUpdated: 0 };
const CACHE_TTL = 10000;

appEvents.on('status_update', () => {
    publicCache = { data: null, lastUpdated: 0 };
});

publicApp.get('/api/status', (c) => {
    const now = Date.now();
    if (publicCache.data && (now - publicCache.lastUpdated < CACHE_TTL)) {
        return c.json(publicCache.data);
    }

    const monitors = db.prepare('SELECT * FROM monitors ORDER BY position ASC, id ASC').all();
    const settings = db.prepare('SELECT * FROM settings WHERE id = 1').get();
    const incidents = db.prepare('SELECT * FROM incidents ORDER BY created_at DESC LIMIT 10').all();
    try {
        settings.footer_links = JSON.parse(settings.footer_links || '[]');
    } catch (e) {
        settings.footer_links = [];
    }

    let globalStatus = 'operational';
    let totalLatency = 0;
    let onlineCount = 0;
    let totalUptimeScore = 0;
    let minTimeUntilCheck = monitors.length > 0 ? 86400000 : 60000;

    const enriched = monitors.map(m => {
        const fullHistory = db.prepare('SELECT status, latency, timestamp FROM heartbeats WHERE monitor_id = ? ORDER BY id DESC LIMIT 1440').all(m.id).reverse();
        const upCount = fullHistory.filter(h => h.status === 'up').length;
        const totalCount = fullHistory.length || 1;
        const uptime = parseFloat(((upCount / totalCount) * 100).toFixed(1));
        totalUptimeScore += uptime;
        
        const history = fullHistory.slice(-50);
        if (m.status === 'up') onlineCount++;
        if (m.status === 'down') globalStatus = 'degraded';
        totalLatency += m.response_time || 0;
        
        const lastChecked = m.last_checked ? new Date(m.last_checked + 'Z').getTime() : 0;
        const nextCheck = lastChecked + (m.interval * 1000);
        const diff = nextCheck - now;
        if (diff < minTimeUntilCheck) minTimeUntilCheck = diff;
        
        return { ...m, history, uptime };
    });

    const avgUptime = monitors.length > 0 ? parseFloat((totalUptimeScore / monitors.length).toFixed(1)) : 100;
    let nextUpdateSeconds = Math.ceil((minTimeUntilCheck + 3000) / 1000);
    if (nextUpdateSeconds < 5) nextUpdateSeconds = 5;
    const avgLatency = monitors.length > 0 ? Math.round(totalLatency / monitors.length) : 0;
    if ((onlineCount / monitors.length) < 0.8 && monitors.length > 0) globalStatus = 'outage';

    publicCache.data = {
        monitors: enriched,
        settings,
        incidents,
        stats: { active: monitors.length, online: onlineCount, avgLatency, status: globalStatus, uptime: avgUptime },
        targetNextCheck: now + minTimeUntilCheck,
        nextUpdateSeconds
    };
    publicCache.lastUpdated = now;

    return c.json(publicCache.data);
});

publicApp.get('/api/stream', (c) => {
    return streamSSE(c, async (stream) => {
        const onUpdate = async () => {
            try { await stream.writeSSE({ data: 'refresh' }); } catch(e){}
        };
        appEvents.on('status_update', onUpdate);
        
        while (!c.req.raw.signal.aborted) {
            await stream.sleep(15000);
            try { await stream.writeSSE({ event: 'ping', data: 'ping' }); } catch(e){}
        }
        
        appEvents.off('status_update', onUpdate);
    });
});

publicApp.use('/*', serveStatic({ root: './public/app' }));

const adminApp = new Hono();

adminApp.post('/api/login', async (c) => {
    const { password } = await c.req.json();
    
    let isValid = false;
    try {
        isValid = await bcrypt.compare(password, ADMIN_PASSWORD_HASH);
    } catch (err) {
        console.error("Bcrypt compare error:", err);
    }
    
    if (isValid) {
        const token = jwt.sign({ admin: true }, ACTIVE_JWT_SECRET, { expiresIn: '24h' });
        return c.json({ token });
    }
    return c.json({ error: 'Invalid password' }, 401);
});

adminApp.use('/api/*', async (c, next) => {
    const authHeader = c.req.header('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return c.json({ error: 'Unauthorized' }, 401);
    }
    const token = authHeader.split(' ')[1];
    try {
        jwt.verify(token, ACTIVE_JWT_SECRET);
        await next();
    } catch {
        return c.json({ error: 'Unauthorized' }, 401);
    }
});

adminApp.get('/api/monitors', (c) => {
    const monitors = db.prepare('SELECT * FROM monitors ORDER BY position ASC, id ASC').all();
    const settings = db.prepare('SELECT * FROM settings WHERE id = 1').get();
    return c.json({ monitors, settings, publicUrl: settings.public_url || PUBLIC_URL || 'http://localhost:3000' });
});

adminApp.post('/api/monitors/reorder', async (c) => {
    const { order } = await c.req.json();
    if (Array.isArray(order)) {
        const updateStmt = db.prepare('UPDATE monitors SET position = ? WHERE id = ?');
        const transaction = db.transaction((ids) => {
            ids.forEach((id, index) => { updateStmt.run(index, id); });
        });
        try {
            transaction(order);
            return c.json({ success: true });
        } catch (err) {
            return c.json({ success: false }, 500);
        }
    }
    return c.json({ error: "Invalid data" }, 400);
});

adminApp.post('/api/monitors', async (c) => {
    const { name, url, notification_url, notification_token, interval, threshold, keyword } = await c.req.json();
    db.prepare(`
        INSERT INTO monitors (name, url, notification_url, notification_token, interval, threshold, keyword)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(name, url, notification_url, notification_token, interval || 60, threshold || 3, keyword || '');
    return c.json({ success: true });
});

adminApp.delete('/api/monitors/:id', (c) => {
    const id = c.req.param('id');
    db.prepare('DELETE FROM monitors WHERE id = ?').run(id);
    return c.json({ success: true });
});

adminApp.put('/api/monitors/:id', async (c) => {
    const id = c.req.param('id');
    const { name, url, interval, notification_url, notification_token, threshold, keyword } = await c.req.json();
    db.prepare(`
        UPDATE monitors
        SET name = ?, url = ?, interval = ?, notification_url = ?, notification_token = ?, threshold = ?, keyword = ?
        WHERE id = ?
    `).run(name, url, interval || 60, notification_url, notification_token, threshold || 3, keyword || '', id);
    return c.json({ success: true });
});

adminApp.post('/api/settings', async (c) => {
    const {
        title, logo_url, footer_text, public_url,
        default_notification_url, default_notification_token,
        footer_info, show_footer_stats, link_labels, link_urls
    } = await c.req.json();
    
    let footerLinks = [];
    if (link_labels && link_urls) {
        const labels = Array.isArray(link_labels) ? link_labels : [link_labels];
        const urls = Array.isArray(link_urls) ? link_urls : [link_urls];
        footerLinks = labels.map((label, i) => ({ label, url: urls[i] })).filter(l => l.label && l.url);
    }
    const statsFlag = show_footer_stats ? 1 : 0;
    
    db.prepare(`
        UPDATE settings
        SET title = ?, logo_url = ?, footer_text = ?, public_url = ?,
            default_notification_url = ?, default_notification_token = ?,
            footer_info = ?, show_footer_stats = ?, footer_links = ?
        WHERE id = 1
    `).run(
        title, logo_url, footer_text, public_url || '',
        default_notification_url, default_notification_token,
        footer_info || '', statsFlag, JSON.stringify(footerLinks)
    );
    publicCache = { data: null, lastUpdated: 0 }; // clear cache on settings update
    appEvents.emit('status_update');
    return c.json({ success: true });
});

// Incidents API
adminApp.get('/api/incidents', (c) => {
    const incidents = db.prepare('SELECT * FROM incidents ORDER BY created_at DESC').all();
    return c.json({ incidents });
});

adminApp.post('/api/incidents', async (c) => {
    const { title, description, status } = await c.req.json();
    db.prepare('INSERT INTO incidents (title, description, status) VALUES (?, ?, ?)')
      .run(title, description, status || 'investigating');
    publicCache = { data: null, lastUpdated: 0 };
    appEvents.emit('status_update');
    return c.json({ success: true });
});

adminApp.put('/api/incidents/:id', async (c) => {
    const id = c.req.param('id');
    const { title, description, status } = await c.req.json();
    db.prepare('UPDATE incidents SET title = ?, description = ?, status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run(title, description, status, id);
    publicCache = { data: null, lastUpdated: 0 };
    appEvents.emit('status_update');
    return c.json({ success: true });
});

adminApp.delete('/api/incidents/:id', (c) => {
    const id = c.req.param('id');
    db.prepare('DELETE FROM incidents WHERE id = ?').run(id);
    publicCache = { data: null, lastUpdated: 0 };
    appEvents.emit('status_update');
    return c.json({ success: true });
});

// Analysis API
adminApp.get('/api/analysis', (c) => {
    // Total downtime checks
    const downCount = db.prepare("SELECT count(*) as count FROM heartbeats WHERE status='down'").get().count;
    const upCount = db.prepare("SELECT count(*) as count FROM heartbeats WHERE status='up'").get().count;
    const totalCount = downCount + upCount || 1;
    const globalUptime = ((upCount / totalCount) * 100).toFixed(2);
    
    // Average Latency
    const avgLatencyRow = db.prepare("SELECT avg(latency) as avg_lat FROM heartbeats WHERE status='up'").get();
    const avgLatencyAll = avgLatencyRow.avg_lat ? Math.round(avgLatencyRow.avg_lat) : 0;

    // Outages count (consecutive fails > threshold would be accurate, but we can approximate by counting transitions)
    const monitorStats = db.prepare("SELECT monitor_id, count(*) as count FROM heartbeats WHERE status='down' GROUP BY monitor_id").all();

    return c.json({
        globalUptime,
        downCount,
        upCount,
        totalCount,
        avgLatencyAll,
        monitorStats
    });
});

adminApp.use('/*', serveStatic({ root: './public/admin' }));

serve({ fetch: publicApp.fetch, port: 3000 }, (info) => console.log(`🌍 Public Status Page running on port ${info.port}`));
serve({ fetch: adminApp.fetch, port: 3001 }, (info) => console.log(`🔒 Admin Dashboard running on port ${info.port}`));

startMonitoring();

const shutdown = () => {
    console.log('🛑 Shutting down...');
    try {
        db.close();
        console.log('💾 Database connection closed');
        process.exit(0);
    } catch (err) {
        process.exit(1);
    }
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
