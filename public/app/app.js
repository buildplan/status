// Theme Logic
const toggleThemeBtn = document.getElementById('toggle-theme');
const iconSun = document.getElementById('icon-sun');
const iconMoon = document.getElementById('icon-moon');

function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    if (theme === 'light') {
        iconSun.classList.add('hidden');
        iconMoon.classList.remove('hidden');
    } else {
        iconSun.classList.remove('hidden');
        iconMoon.classList.add('hidden');
    }
}

let currentTheme = localStorage.getItem('theme') || 'dark';
applyTheme(currentTheme);

toggleThemeBtn.addEventListener('click', () => {
    currentTheme = currentTheme === 'dark' ? 'light' : 'dark';
    localStorage.setItem('theme', currentTheme);
    
    if (!document.startViewTransition) {
        applyTheme(currentTheme);
    } else {
        document.startViewTransition(() => applyTheme(currentTheme));
    }
});

// Layout Logic
const toggleLayoutBtn = document.getElementById('toggle-layout');
const iconList = document.getElementById('icon-list');
const iconGrid = document.getElementById('icon-grid');
const monitorsList = document.getElementById('monitors-list');

function applyLayout(layout) {
    if (layout === 'grid') {
        monitorsList.classList.add('grid-view');
        iconGrid.classList.add('hidden');
        iconList.classList.remove('hidden');
    } else {
        monitorsList.classList.remove('grid-view');
        iconList.classList.add('hidden');
        iconGrid.classList.remove('hidden');
    }
}

let currentLayout = localStorage.getItem('layout') || 'list';
applyLayout(currentLayout);

toggleLayoutBtn.addEventListener('click', () => {
    currentLayout = currentLayout === 'list' ? 'grid' : 'list';
    localStorage.setItem('layout', currentLayout);
    applyLayout(currentLayout);
});

// Data Fetching & Rendering
let eventSource = null;

async function fetchStatus() {
    try {
        const res = await fetch('/api/status');
        const data = await res.json();
        render(data);
    } catch (e) {
        console.error("Failed to fetch status:", e);
    }
}

function initSSE() {
    if (eventSource) return;
    eventSource = new EventSource('/api/stream');
    eventSource.onmessage = (e) => {
        if (e.data === 'refresh') {
            fetchStatus();
        }
    };
    eventSource.onerror = () => {
        eventSource.close();
        eventSource = null;
        setTimeout(initSSE, 5000);
    };
}

function render(data) {
    // Header & Settings
    if (data.settings.title) {
        document.getElementById('page-title').textContent = data.settings.title;
        document.getElementById('footer-title').textContent = data.settings.title;
        document.title = data.settings.title;
    }
    
    // Global Status
    const pill = document.getElementById('global-status-pill');
    const statusText = document.getElementById('status-text');
    const statusSubtext = document.getElementById('status-subtext');
    
    pill.className = `global-status-pill ${data.stats.status}`;
    
    if (data.stats.status === 'operational') {
        statusText.textContent = "All Systems Operational";
        statusSubtext.textContent = `${data.stats.uptime}% UPTIME TODAY`;
    } else if (data.stats.status === 'degraded') {
        statusText.textContent = "Partial Degradation";
        statusSubtext.textContent = "SOME SERVICES DOWN";
    } else {
        statusText.textContent = "Major Outage";
        statusSubtext.textContent = "CRITICAL FAILURES";
    }
    
    // Stats
    document.getElementById('stat-active').textContent = data.stats.active;
    document.getElementById('stat-online').textContent = data.stats.online;
    document.getElementById('stat-latency').textContent = `${data.stats.avgLatency}ms`;
    
    // Footer Stats Bar
    if (data.settings.show_footer_stats) {
        document.getElementById('footer-stats-bar').classList.remove('hidden');
        document.getElementById('f-stat-monitors').textContent = data.stats.active;
        document.getElementById('f-stat-online').textContent = `${data.stats.online} / ${data.stats.active}`;
        document.getElementById('f-stat-latency').textContent = `${data.stats.avgLatency}ms`;
    } else {
        document.getElementById('footer-stats-bar').classList.add('hidden');
    }
    
    // Monitors
    const existingMonitorIds = new Set(Array.from(monitorsList.children).map(c => c.dataset.id));
    
    data.monitors.forEach(m => {
        let card = document.getElementById(`monitor-${m.id}`);
        if (!card) {
            card = document.createElement('div');
            card.id = `monitor-${m.id}`;
            card.dataset.id = m.id;
            card.className = 'monitor-card';
            monitorsList.appendChild(card);
        }
        existingMonitorIds.delete(String(m.id));
        
        const stateHash = JSON.stringify(m);
        if (card.dataset.state === stateHash) return; // Skip if no changes
        card.dataset.state = stateHash;
        
        let isUp = m.status === 'up';
        let isDown = m.status === 'down';
        
        let iconHtml = '';
        if (isUp) {
            iconHtml = `<svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg>`;
        } else if (isDown) {
            iconHtml = `<svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path></svg>`;
        } else {
            iconHtml = `<svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>`;
        }
        
        let badgeColor = m.uptime === 100 ? 'text-text-secondary' : 'text-warning';
        let badgeText = m.uptime === 100 ? '100%' : `${m.uptime}%`;
        
        // Graph SVG
        let graphHtml = '';
        if (m.history && m.history.length > 0) {
            const h = m.history;
            const maxLat = Math.max(...h.map(x => x.latency), 100); 
            let points = "";
            h.forEach((pt, i) => {
                const x = (i / (h.length - 1 || 1)) * 100;
                const y = 40 - ((pt.latency / maxLat) * 40);
                points += `${x},${y} `;
            });
            let strokeColor = isUp ? 'var(--success)' : 'var(--danger)';
            graphHtml = `
                <svg viewBox="0 0 100 40" preserveAspectRatio="none" style="width:100%;height:100%;overflow:visible;">
                    <path d="M0,40 ${points} 100,40 Z" fill="url(#grad${m.id})" />
                    <polyline points="${points}" fill="none" stroke="${strokeColor}" stroke-width="2" stroke-linejoin="round" />
                    <defs>
                        <linearGradient id="grad${m.id}" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stop-color="${strokeColor}" stop-opacity="0.3"/>
                            <stop offset="100%" stop-color="${strokeColor}" stop-opacity="0"/>
                        </linearGradient>
                    </defs>
                </svg>
            `;
        }
        
        // Bars
        let barsHtml = '<div class="m-bars">';
        if (m.history) {
            m.history.forEach(h => {
                let hClass = 'down';
                let height = 100;
                if (h.status === 'up') {
                    hClass = h.latency > 500 ? 'slow' : 'up';
                    height = Math.max(20, Math.min(100, (h.latency / 2)));
                }
                barsHtml += `<div class="m-bar ${hClass}" style="height: ${height}%">
                    <div class="custom-tooltip">${h.status.toUpperCase()} - ${h.latency}ms<br>${new Date(h.timestamp).toLocaleTimeString()}</div>
                </div>`;
            });
            for(let i=0; i < (50 - m.history.length); i++) {
                barsHtml += `<div class="m-bar empty" style="height: 10%"></div>`;
            }
        }
        barsHtml += '</div>';

        card.innerHTML = `
            <div class="card-header">
                <div class="m-info">
                    <div class="m-icon ${isUp ? 'up' : (isDown ? 'down' : 'pending')}">${iconHtml}</div>
                    <div class="m-texts">
                        <div class="m-title-row">
                            <h3 class="m-title" title="${m.name}">${m.name}</h3>
                            <span class="m-badge ${badgeColor}">${badgeText}</span>
                        </div>
                        <a href="${m.url}" target="_blank" class="m-url">${m.url}</a>
                    </div>
                </div>
                <div class="m-stats">
                    <div class="m-graph">${graphHtml}</div>
                    <div class="m-latency-info">
                        <div class="m-latency-val">${m.response_time || 0}ms</div>
                        <div class="m-latency-label">Current Latency</div>
                    </div>
                </div>
            </div>
            ${barsHtml}
        `;
    });
    
    // Remove deleted monitors
    existingMonitorIds.forEach(id => {
        const el = document.getElementById(`monitor-${id}`);
        if (el) el.remove();
    });
    
    // Incidents
    const incidentsContainer = document.getElementById('incidents-container');
    const incidentsList = document.getElementById('incidents-list');
    incidentsList.innerHTML = '';
    
    if (data.incidents && data.incidents.length > 0) {
        incidentsContainer.classList.remove('hidden');
        data.incidents.forEach(inc => {
            const card = document.createElement('div');
            card.className = `incident-card status-${inc.status}`;
            
            const date = new Date(inc.created_at).toLocaleString();
            
            card.innerHTML = `
                <div class="inc-header">
                    <h3 class="inc-title">${inc.title}</h3>
                    <span class="inc-status-badge">${inc.status}</span>
                </div>
                <div class="inc-date">Reported: ${date}</div>
                <div class="inc-desc">${inc.description || 'No description provided.'}</div>
            `;
            incidentsList.appendChild(card);
        });
    } else {
        incidentsContainer.classList.add('hidden');
    }

    // Footer
    document.getElementById('footer-text').textContent = `${data.settings.footer_text || ''} • © ${new Date().getFullYear()}`;
    
    const infoEl = document.getElementById('footer-info');
    if (data.settings.footer_info) {
        infoEl.textContent = data.settings.footer_info;
        infoEl.classList.remove('hidden');
    } else {
        infoEl.classList.add('hidden');
    }
    
    const linksDiv = document.getElementById('footer-links');
    linksDiv.innerHTML = '';
    if (data.settings.footer_links) {
        data.settings.footer_links.forEach(l => {
            const a = document.createElement('a');
            a.href = l.url;
            a.textContent = l.label;
            a.target = "_blank";
            linksDiv.appendChild(a);
        });
    }
}

fetchStatus();
initSSE();

// Register Service Worker for PWA
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js').catch(err => {
            console.log('SW registration failed: ', err);
        });
    });
}
