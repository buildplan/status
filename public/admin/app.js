let token = localStorage.getItem('admin_token');

const showToast = (message, type = 'success') => {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `<span>${message}</span><button class="toast-close">&times;</button>`;
    
    toast.querySelector('.toast-close').addEventListener('click', () => {
        toast.style.animation = 'slideOutRight 0.3s forwards';
        setTimeout(() => toast.remove(), 300);
    });
    
    container.appendChild(toast);
    
    setTimeout(() => {
        if (toast.parentElement) {
            toast.style.animation = 'slideOutRight 0.3s forwards';
            setTimeout(() => toast.remove(), 300);
        }
    }, 4000);
};

const apiFetch = async (url, options = {}) => {
    if (!options.headers) options.headers = {};
    if (token) options.headers['Authorization'] = `Bearer ${token}`;
    options.headers['Content-Type'] = 'application/json';
    
    const res = await fetch(url, options);
    if (res.status === 401) {
        logout();
        throw new Error('Unauthorized');
    }
    return res;
};

const showView = (id) => {
    document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
    document.getElementById(id).classList.remove('hidden');
};

const logout = () => {
    token = null;
    localStorage.removeItem('admin_token');
    showView('login-view');
};

// Login
document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const password = document.getElementById('password').value;
    const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password })
    });
    if (res.ok) {
        const data = await res.json();
        token = data.token;
        localStorage.setItem('admin_token', token);
        document.getElementById('password').value = '';
        document.getElementById('login-error').textContent = '';
        loadDashboard();
    } else {
        document.getElementById('login-error').textContent = 'Invalid password';
    }
});

document.getElementById('logout-btn').addEventListener('click', logout);

// Tabs
document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.add('hidden'));
        e.target.classList.add('active');
        document.getElementById(`tab-${e.target.dataset.tab}`).classList.remove('hidden');
    });
});

// Load Dashboard Data
async function loadDashboard() {
    showView('dashboard-view');
    try {
        const [monRes, incRes, anaRes] = await Promise.all([
            apiFetch('/api/monitors'),
            apiFetch('/api/incidents'),
            apiFetch('/api/analysis')
        ]);
        
        const data = await monRes.json();
        const incData = await incRes.json();
        const anaData = await anaRes.json();
        
        // Settings
        document.getElementById('set-title').value = data.settings.title || '';
        document.getElementById('set-logo').value = data.settings.logo_url || '';
        document.getElementById('set-public-url').value = data.settings.public_url || '';
        document.getElementById('set-footer').value = data.settings.footer_text || '';
        document.getElementById('set-webhook-url').value = data.settings.default_notification_url || '';
        document.getElementById('set-webhook-token').value = data.settings.default_notification_token || '';
        document.getElementById('set-history-days').value = data.settings.history_retention_days || 30;
        document.getElementById('set-footer-info').value = data.settings.footer_info || '';
        document.getElementById('set-show-stats').checked = data.settings.show_footer_stats == 1;

        const publicLink = document.getElementById('public-link');
        if (publicLink && data.publicUrl) {
            publicLink.href = data.publicUrl;
        }
        
        const linksContainer = document.getElementById('footer-links-container');
        if (linksContainer) {
            linksContainer.innerHTML = '';
            let links = [];
            try { links = JSON.parse(data.settings.footer_links || '[]'); } catch(e){}
            
            window.renderLinkInput = (label = '', url = '') => {
                const div = document.createElement('div');
                div.className = 'form-grid';
                div.style.marginBottom = '0.5rem';
                div.style.alignItems = 'flex-end';
                div.innerHTML = `
                    <div class="input-group"><input type="text" placeholder="Label (e.g. GitHub)" class="link-label" value="${label}"></div>
                    <div class="input-group"><input type="url" placeholder="URL" class="link-url" value="${url}"></div>
                    <button type="button" class="btn-danger remove-link" style="padding:0.4rem; height: 42px;">X</button>
                `;
                div.querySelector('.remove-link').addEventListener('click', () => div.remove());
                linksContainer.appendChild(div);
            };
            
            links.forEach(l => window.renderLinkInput(l.label, l.url));
        }
        
        // Monitors
        const tbody = document.getElementById('monitors-tbody');
        tbody.innerHTML = '';
        data.monitors.forEach(m => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td><strong>${m.name}</strong></td>
                <td><span style="opacity:0.7">${m.url}</span></td>
                <td>${m.interval}s</td>
                <td>${m.status.toUpperCase()}</td>
                <td>
                    <button onclick="editMonitor(${m.id})" style="padding: 0.4rem 0.6rem; font-size: 0.8rem;">Edit</button>
                    <button onclick="deleteMonitor(${m.id})" class="btn-danger" style="padding: 0.4rem 0.6rem; font-size: 0.8rem; margin-left:0.5rem">Delete</button>
                </td>
            `;
            tbody.appendChild(tr);
        });
        window.monitorsData = data.monitors;

        // Incidents
        const incTbody = document.getElementById('incidents-tbody');
        incTbody.innerHTML = '';
        incData.incidents.forEach(inc => {
            const tr = document.createElement('tr');
            const date = new Date(inc.created_at).toLocaleString();
            tr.innerHTML = `
                <td><strong>${inc.title}</strong></td>
                <td><span class="status-badge status-${inc.status}">${inc.status}</span></td>
                <td><span style="opacity:0.7;font-size:0.85rem">${date}</span></td>
                <td>
                    <button onclick="editIncident(${inc.id})" style="padding: 0.4rem 0.6rem; font-size: 0.8rem;">Edit</button>
                    <button onclick="deleteIncident(${inc.id})" class="btn-danger" style="padding: 0.4rem 0.6rem; font-size: 0.8rem; margin-left:0.5rem">Delete</button>
                </td>
            `;
            incTbody.appendChild(tr);
        });
        window.incidentsData = incData.incidents;

        // Analytics
        document.getElementById('ana-uptime').textContent = `${anaData.globalUptime}%`;
        document.getElementById('ana-total-checks').textContent = anaData.totalCount.toLocaleString();
        document.getElementById('ana-down-checks').textContent = anaData.downCount.toLocaleString();
        document.getElementById('ana-avg-latency').textContent = `${anaData.avgLatencyAll}ms`;

    } catch (e) {
        console.error(e);
    }
}

// Settings form
document.getElementById('settings-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const payload = {
        title: document.getElementById('set-title').value,
        logo_url: document.getElementById('set-logo').value,
        public_url: document.getElementById('set-public-url').value,
        footer_text: document.getElementById('set-footer').value,
        default_notification_url: document.getElementById('set-webhook-url').value,
        default_notification_token: document.getElementById('set-webhook-token').value,
        history_retention_days: parseInt(document.getElementById('set-history-days').value) || 30,
        footer_info: document.getElementById('set-footer-info').value,
        show_footer_stats: document.getElementById('set-show-stats').checked ? 1 : 0,
        link_labels: Array.from(document.querySelectorAll('.link-label')).map(el => el.value),
        link_urls: Array.from(document.querySelectorAll('.link-url')).map(el => el.value)
    };
    await apiFetch('/api/settings', { method: 'POST', body: JSON.stringify(payload) });
    showToast('Settings saved successfully!');
});

document.getElementById('add-link-btn').addEventListener('click', () => {
    if (window.renderLinkInput) window.renderLinkInput();
});

// Modals Setup
document.querySelectorAll('.close-modal').forEach(btn => {
    btn.addEventListener('click', (e) => {
        document.getElementById(e.target.dataset.target).classList.add('hidden');
    });
});

// Monitors Modal Logic
const monitorModal = document.getElementById('monitor-modal');
document.getElementById('add-monitor-btn').addEventListener('click', () => {
    document.getElementById('monitor-form').reset();
    document.getElementById('mon-id').value = '';
    document.getElementById('modal-title').textContent = 'Add Monitor';
    monitorModal.classList.remove('hidden');
});

window.editMonitor = (id) => {
    const m = window.monitorsData.find(x => x.id === id);
    if (!m) return;
    document.getElementById('mon-id').value = m.id;
    document.getElementById('mon-name').value = m.name;
    document.getElementById('mon-url').value = m.url;
    document.getElementById('mon-keyword').value = m.keyword || '';
    document.getElementById('mon-interval').value = m.interval;
    document.getElementById('mon-threshold').value = m.threshold || 3;
    document.getElementById('mon-notif-url').value = m.notification_url || '';
    document.getElementById('mon-notif-token').value = m.notification_token || '';
    document.getElementById('modal-title').textContent = 'Edit Monitor';
    monitorModal.classList.remove('hidden');
};

window.deleteMonitor = async (id) => {
    if (confirm('Permanently delete this monitor?')) {
        await apiFetch(`/api/monitors/${id}`, { method: 'DELETE' });
        loadDashboard();
    }
};

document.getElementById('monitor-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('mon-id').value;
    const payload = {
        name: document.getElementById('mon-name').value,
        url: document.getElementById('mon-url').value,
        keyword: document.getElementById('mon-keyword').value,
        interval: parseInt(document.getElementById('mon-interval').value),
        threshold: parseInt(document.getElementById('mon-threshold').value),
        notification_url: document.getElementById('mon-notif-url').value,
        notification_token: document.getElementById('mon-notif-token').value
    };
    
    if (id) {
        await apiFetch(`/api/monitors/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
    } else {
        await apiFetch(`/api/monitors`, { method: 'POST', body: JSON.stringify(payload) });
    }
    monitorModal.classList.add('hidden');
    loadDashboard();
});

// Incidents Modal Logic
const incidentModal = document.getElementById('incident-modal');
document.getElementById('add-incident-btn').addEventListener('click', () => {
    document.getElementById('incident-form').reset();
    document.getElementById('inc-id').value = '';
    document.getElementById('inc-modal-title').textContent = 'Report Incident';
    incidentModal.classList.remove('hidden');
});

window.editIncident = (id) => {
    const inc = window.incidentsData.find(x => x.id === id);
    if (!inc) return;
    document.getElementById('inc-id').value = inc.id;
    document.getElementById('inc-title').value = inc.title;
    document.getElementById('inc-status').value = inc.status;
    document.getElementById('inc-desc').value = inc.description || '';
    document.getElementById('inc-modal-title').textContent = 'Update Incident';
    incidentModal.classList.remove('hidden');
};

window.deleteIncident = async (id) => {
    if (confirm('Delete this incident record?')) {
        await apiFetch(`/api/incidents/${id}`, { method: 'DELETE' });
        loadDashboard();
    }
};

document.getElementById('incident-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('inc-id').value;
    const payload = {
        title: document.getElementById('inc-title').value,
        status: document.getElementById('inc-status').value,
        description: document.getElementById('inc-desc').value
    };
    
    if (id) {
        await apiFetch(`/api/incidents/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
    } else {
        await apiFetch(`/api/incidents`, { method: 'POST', body: JSON.stringify(payload) });
    }
    incidentModal.classList.add('hidden');
    loadDashboard();
});


// Init
if (token) {
    loadDashboard();
} else {
    showView('login-view');
}
