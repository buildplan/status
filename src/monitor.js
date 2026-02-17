import db from './db.js';

const DISCORD_HOSTS = new Set([
    'discord.com',
    'www.discord.com',
    'canary.discord.com',
    'ptb.discord.com',
    'discordapp.com',
    'canary.discordapp.com',
    'ptb.discordapp.com'
]);

// --- NOTIFICATION HANDLERS ---
async function sendNotification(monitor, message, status) {
    let url = monitor.notification_url;
    let token = monitor.notification_token;

    // If this monitor has no specific URL, check for global default
    if (!url) {
        const settings = db.prepare('SELECT default_notification_url, default_notification_token FROM settings WHERE id = 1').get();
        if (settings && settings.default_notification_url) {
            url = settings.default_notification_url;
            token = settings.default_notification_token;
        }
    }

    // If still no URL found, abort
    if (!url) return;

    try {
        const targetUrl = new URL(url);
        const hostname = targetUrl.hostname;

        const headers = { 'Content-Type': 'application/json' };
        if (token) headers['Authorization'] = `Bearer ${token}`;

        let method = 'POST';
        let body = null;

        // --- 1. DISCORD ---
        if (DISCORD_HOSTS.has(hostname)) {
            body = JSON.stringify({
                content: `**${status.toUpperCase()}:** ${message}`
            });
        }
        // --- 2. SLACK ---
        else if (hostname === 'hooks.slack.com') {
            body = JSON.stringify({
                text: `*${status.toUpperCase()}:* ${message}`
            });
        }
        // --- 3. MICROSOFT TEAMS ---
        else if (hostname === 'outlook.office.com' || hostname === 'webhook.office.com') {
            body = JSON.stringify({
                "@type": "MessageCard",
                "themeColor": status === 'up' ? "00FF00" : "FF0000",
                "title": `Service ${status.toUpperCase()}: ${monitor.name}`,
                "text": message
            });
        }
        // --- 4. NTFY (Generic Webhook) ---
        else {
            headers['Title'] = `Service ${status.toUpperCase()}: ${monitor.name}`;
            headers['Priority'] = status === 'down' ? '5' : '3';
            headers['Tags'] = status === 'down' ? 'rotating_light' : 'white_check_mark';
            delete headers['Content-Type'];
            body = message;
        }

        await fetch(url, { method, headers, body });
        console.log(`🔔 Notification sent for ${monitor.name}`);
    } catch (e) {
        console.error(`❌ Notification failed for ${monitor.name}:`, e.message);
    }
}

// --- CHECK LOGIC ---
async function checkService(monitor) {
    const start = performance.now();
    let isUp = false;
    let latency = 0;

    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);

        const res = await fetch(monitor.url, {
            method: 'GET',
            signal: controller.signal,
            headers: { 'User-Agent': 'WiredAlter-Status/1.0' }
        });

        clearTimeout(timeoutId);
        latency = Math.round(performance.now() - start);

        if (res.ok || (res.status >= 200 && res.status < 400)) {
            isUp = true;
        }
    } catch (e) {
        latency = 0;
        isUp = false;
    }

    // --- FLAPPING PROTECTION LOGIC ---
    // 1. If UP: Reset fails, mark as UP immediately
    if (isUp) {
        if (monitor.status !== 'up') {
            const msg = `Monitor ${monitor.name} is RECOVERED (${latency}ms)`;
            console.log(`✅ [${new Date().toLocaleTimeString()}] ${monitor.name} RECOVERED`);
            sendNotification(monitor, msg, 'up');

            // Update DB: Status=up, Fails=0
            db.prepare('UPDATE monitors SET status=?, response_time=?, last_checked=CURRENT_TIMESTAMP, consecutive_fails=0 WHERE id=?').run('up', latency, monitor.id);
        } else {
             // Just update latency
             db.prepare('UPDATE monitors SET response_time=?, last_checked=CURRENT_TIMESTAMP, consecutive_fails=0 WHERE id=?').run(latency, monitor.id);
        }
    }
    // 2. If DOWN: Increment fails, only alert if threshold reached
    else {
        const currentFails = (monitor.consecutive_fails || 0) + 1;
        const THRESHOLD = 3; // Hardcoded for now

        console.log(`⚠️ [${new Date().toLocaleTimeString()}] ${monitor.name} failed check (${currentFails}/${THRESHOLD})`);

        if (currentFails >= THRESHOLD && monitor.status !== 'down') {
            const msg = `Monitor ${monitor.name} is DOWN after ${currentFails} checks`;
            console.log(`🔴 [${new Date().toLocaleTimeString()}] ${monitor.name} CONFIRMED DOWN`);
            sendNotification(monitor, msg, 'down');

            // Mark as down
            db.prepare('UPDATE monitors SET status=?, response_time=0, last_checked=CURRENT_TIMESTAMP, consecutive_fails=? WHERE id=?').run('down', currentFails, monitor.id);
        } else {
            db.prepare('UPDATE monitors SET consecutive_fails=?, last_checked=CURRENT_TIMESTAMP WHERE id=?').run(currentFails, monitor.id);
        }
    }

    // Log Heartbeat (Always)
    db.prepare(`
        INSERT INTO heartbeats (monitor_id, status, latency) VALUES (?, ?, ?)
    `).run(monitor.id, isUp ? 'up' : 'down', latency);
}

// --- LOOP ---
export function startMonitoring() {
    console.log("🚀 Monitoring Engine Started");
    setInterval(() => {
        const monitors = db.prepare('SELECT * FROM monitors').all();
        const now = Date.now();
        monitors.forEach(m => {
            const lastChecked = m.last_checked ? new Date(m.last_checked + 'Z').getTime() : 0;
            const nextCheck = lastChecked + (m.interval * 1000);
            if (now >= nextCheck) {
                checkService(m);
            }
        });
    }, 1000);
}
