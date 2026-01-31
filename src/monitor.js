import db from './db.js';

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
        // Add Authorization header if token exists
        if (token) headers['Authorization'] = `Bearer ${token}`;

        let method = 'POST';
        let body = null;

        // --- 1. DISCORD ---
        if (hostname.endsWith('discord.com') || hostname.endsWith('discordapp.com')) {
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
        // --- 4. NTFY (Plain Text + Headers) ---
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
    let status = 'down';
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

        // Consider 2xx success
        if (res.ok) status = 'up';
    } catch (e) {
        latency = 0;
        status = 'down';
    }

    const icon = status === 'up' ? '✅' : '🔴';
    console.log(`${icon} [${new Date().toLocaleTimeString()}] ${monitor.name}: ${status.toUpperCase()} (${latency}ms)`);
    if (monitor.status !== status && monitor.status !== 'pending') {
        const msg = `Monitor ${monitor.name} is now ${status.toUpperCase()} (${monitor.url})`;
        sendNotification(monitor, msg, status);
    }

    // Update DB
    db.prepare(`
        UPDATE monitors
        SET status = ?, last_checked = CURRENT_TIMESTAMP, response_time = ?
        WHERE id = ?
    `).run(status, latency, monitor.id);

    db.prepare(`
        INSERT INTO heartbeats (monitor_id, status, latency) VALUES (?, ?, ?)
    `).run(monitor.id, status, latency);
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
    }, 1000); // 1000ms = 1 second
}