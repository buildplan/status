import db from './db.js';

// --- NOTIFICATION HANDLERS ---
async function sendNotification(url, message, status) {
    if (!url) return;

    try {
        // Generic Webhook / Ntfy / Discord / Gotify Payload
        const payload = url.includes('discord')
            ? { content: `**${status.toUpperCase()}:** ${message}` }
            : { message: message, title: `Service ${status.toUpperCase()}`, priority: status === 'down' ? 5 : 3 };

        await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        console.log(`🔔 Notification sent to ${url}`);
    } catch (e) {
        console.error("❌ Notification failed:", e.message);
    }
}

// --- CHECK LOGIC ---
async function checkService(monitor) {
    const start = performance.now();
    let status = 'down';
    let latency = 0;

    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s timeout

        const res = await fetch(monitor.url, {
            method: 'GET',
            signal: controller.signal,
            headers: { 'User-Agent': 'WiredAlter-Status/1.0' }
        });

        clearTimeout(timeoutId);
        latency = Math.round(performance.now() - start);

        if (res.ok) status = 'up';
    } catch (e) {
        latency = 0;
        status = 'down';
    }

    // State Change Detection?
    if (monitor.status !== status && monitor.status !== 'pending') {
        const msg = `Monitor ${monitor.name} is now ${status.toUpperCase()} (${monitor.url})`;
        sendNotification(monitor.notification_url, msg, status);
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
        monitors.forEach(m => checkService(m));
    }, 60000); // Check every 60 seconds (Can be made dynamic per monitor later)

    // Run once immediately on start
    const monitors = db.prepare('SELECT * FROM monitors').all();
    monitors.forEach(m => checkService(m));
}
