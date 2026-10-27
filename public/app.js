// ==============================================================================
// APEX ENTERPRISE IDENTITY & QR VERIFICATION SPA
// ==============================================================================

const state = {
  user: null,
  org: null,
  role: null,
  currentRoute: 'dashboard',
  selectedIdentity: null,
  html5QrCode: null,
  stats: null
};

// --- Avatar & Visual Utilities ---
function renderInitialsAvatar(name, size = 36) {
  const safeName = (name || 'U').trim();
  const parts = safeName.split(' ').filter(Boolean);
  let initials = 'U';
  if (parts.length >= 2) {
    initials = (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  } else if (parts.length === 1) {
    initials = parts[0].substring(0, 2).toUpperCase();
  }

  const gradients = [
    'linear-gradient(135deg, #1e3a8a 0%, #3b82f6 100%)', // Sapphire
    'linear-gradient(135deg, #065f46 0%, #10b981 100%)', // Emerald
    'linear-gradient(135deg, #5b21b6 0%, #8b5cf6 100%)', // Violet
    'linear-gradient(135deg, #9a3412 0%, #f97316 100%)', // Amber
    'linear-gradient(135deg, #0f766e 0%, #14b8a6 100%)', // Teal
    'linear-gradient(135deg, #831843 0%, #ec4899 100%)'  // Rose
  ];

  let hash = 0;
  for (let i = 0; i < safeName.length; i++) {
    hash = (safeName.charCodeAt(i) + ((hash << 5) - hash)) | 0;
  }
  const bg = gradients[Math.abs(hash) % gradients.length];
  const fontSize = Math.max(10, Math.floor(size * 0.38));

  return `<div class="avatar-placeholder" style="width: ${size}px; height: ${size}px; background: ${bg}; color: #ffffff; display: flex; align-items: center; justify-content: center; font-weight: 700; font-family: var(--font-display); font-size: ${fontSize}px; flex-shrink: 0; border: 1px solid rgba(255,255,255,0.25); box-shadow: 0 2px 5px rgba(0,0,0,0.08);">
    ${initials}
  </div>`;
}

function renderAvatar(photoUrl, name, size = 36) {
  if (photoUrl && photoUrl.trim() && photoUrl !== '/uploads/default-avatar.png') {
    const escapedName = (name || 'Personnel').replace(/"/g, '&quot;');
    const jsEscapedName = (name || 'Personnel').replace(/'/g, "\\'");
    return `
      <img src="${photoUrl}" alt="${escapedName}" class="avatar-img" style="width: ${size}px; height: ${size}px; object-fit: cover;" onerror="this.outerHTML=renderInitialsAvatar('${jsEscapedName}', ${size})" />
    `;
  }
  return renderInitialsAvatar(name, size);
}

function formatRelativeTime(dateString) {
  if (!dateString) return '';
  const date = new Date(dateString);
  const now = new Date();
  const diffSecs = Math.floor((now - date) / 1000);

  if (diffSecs < 60) return 'Just now';
  if (diffSecs < 3600) return `${Math.floor(diffSecs / 60)}m ago`;
  if (diffSecs < 86400) return `${Math.floor(diffSecs / 3600)}h ago`;
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

// --- API Client Helpers ---
async function api(url, options = {}) {
  try {
    const token = localStorage.getItem('auth_token');
    const headers = {
      'Accept': 'application/json',
      ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
      ...(options.headers || {})
    };

    const res = await fetch(url, {
      ...options,
      headers
    });

    if (res.status === 401 && !url.includes('/api/auth/login')) {
      localStorage.removeItem('auth_token');
      state.user = null;
      render();
      return null;
    }

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || data.message || `Request failed with status ${res.status}`);
    }
    return data;
  } catch (err) {
    console.error('API Error:', err);
    throw err;
  }
}

// --- Session Verification ---
async function initSession() {
  // Check if current URL is a public verification link: /verify/<token>
  const pathParts = window.location.pathname.split('/').filter(Boolean);
  if (pathParts[0] === 'verify' && pathParts[1]) {
    state.currentRoute = 'public-verify';
    state.verifyToken = pathParts[1];
    render();
    return;
  }

  try {
    const session = await api('/api/auth/me');
    if (session && session.user) {
      state.user = session.user;
      state.org = session.organisation;
      state.role = session.role;
      // Handle hash routing
      const hash = window.location.hash.replace('#', '') || 'dashboard';
      state.currentRoute = hash;
    } else {
      state.user = null;
    }
  } catch (e) {
    state.user = null;
  }
  render();
}

function navigate(route) {
  state.currentRoute = route;
  window.location.hash = route;
  // Cleanup scanner if active
  if (state.html5QrCode && state.html5QrCode.isScanning) {
    state.html5QrCode.stop().catch(() => {});
  }
  render();
}

// --- Render Engine ---
function render() {
  const root = document.getElementById('appRoot');

  // 1. Public Verification View (e.g. from mobile QR scan)
  if (state.currentRoute === 'public-verify') {
    renderPublicVerifyView(root);
    return;
  }

  // 2. Unauthenticated -> Login View
  if (!state.user) {
    renderLoginView(root);
    return;
  }

  // 3. Authenticated -> Enterprise Platform Shell
  renderAppShell(root);
}

// --- 1. LOGIN VIEW ---
function renderLoginView(container) {
  container.innerHTML = `
    <div style="min-height: 100vh; display: flex; align-items: center; justify-content: center; background: #090d16; padding: 20px;">
      <div style="width: 100%; max-width: 400px; background: #ffffff; border-radius: 8px; border: 1px solid #1e293b; padding: 32px; box-shadow: 0 20px 50px rgba(0,0,0,0.4);">
        <div style="margin-bottom: 24px; text-align: left;">
          <div style="width: 36px; height: 36px; background: #2563eb; border-radius: 6px; display: flex; align-items: center; justify-content: center; color: #ffffff; font-weight: 700; margin-bottom: 12px;">
            AI
          </div>
          <h1 style="font-size: 18px; font-weight: 700; color: #0f172a; letter-spacing: -0.01em;">Apex Identity Platform</h1>
          <p style="font-size: 12px; color: #64748b; margin-top: 4px;">Sign in with your authorized staff credentials.</p>
        </div>

        <div id="loginAlert" style="display: none; padding: 10px 12px; border-radius: 6px; font-size: 12px; margin-bottom: 16px;"></div>

        <form id="loginForm">
          <div class="form-group">
            <label class="form-label">Email Address</label>
            <input type="email" id="loginEmail" class="form-control" value="admin@gracechapel.org" required placeholder="name@organisation.org" />
          </div>

          <div class="form-group">
            <label class="form-label">Password</label>
            <input type="password" id="loginPassword" class="form-control" value="admin123" required placeholder="••••••••" />
          </div>

          <button type="submit" id="loginBtn" class="btn btn-primary" style="width: 100%; margin-top: 8px; padding: 10px;">
            Sign In to Identity Workspace
          </button>
        </form>

        <div style="margin-top: 24px; padding-top: 16px; border-top: 1px solid #f1f5f9; font-size: 11px; color: #94a3b8; text-align: center;">
          Default Super Admin: <code style="color: #0f172a;">admin@gracechapel.org</code> &bull; Pass: <code style="color: #0f172a;">admin123</code>
        </div>
      </div>
    </div>
  `;

  document.getElementById('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('loginBtn');
    const alertBox = document.getElementById('loginAlert');
    btn.disabled = true;
    btn.innerText = 'Authenticating...';
    alertBox.style.display = 'none';

    try {
      const email = document.getElementById('loginEmail').value;
      const password = document.getElementById('loginPassword').value;

      const res = await api('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });

      if (res && res.token) {
        localStorage.setItem('auth_token', res.token);
      }

      state.user = res.user;
      state.org = res.organisation;
      state.role = res.organisation.role;
      state.currentRoute = 'dashboard';
      render();
    } catch (err) {
      alertBox.className = 'badge badge-revoked';
      alertBox.style.display = 'block';
      alertBox.innerText = err.message || 'Login failed';
      btn.disabled = false;
      btn.innerText = 'Sign In to Identity Workspace';
    }
  });
}

// --- 2. MAIN APP SHELL ---
function renderAppShell(container) {
  container.innerHTML = `
    <div class="app-shell">
      <!-- Sidebar -->
      <aside class="sidebar">
        <div class="sidebar-header">
          <div class="org-badge-icon">${(state.org.name || 'AI').substring(0, 2).toUpperCase()}</div>
          <div style="overflow: hidden;">
            <div class="org-title">${state.org.name || 'Apex Identity'}</div>
            <div class="org-subtitle">Prefix: ${state.org.id_prefix || 'ID'} &bull; ${state.role.replace('_', ' ').toUpperCase()}</div>
          </div>
        </div>

        <nav class="sidebar-nav">
          <a class="nav-item ${state.currentRoute === 'dashboard' ? 'active' : ''}" onclick="navigate('dashboard')">
            <i data-lucide="layout-dashboard"></i> Dashboard
          </a>
          <a class="nav-item ${state.currentRoute === 'scan' ? 'active' : ''}" onclick="navigate('scan')">
            <i data-lucide="scan-line"></i> Scan & Verify
          </a>
          <a class="nav-item ${state.currentRoute === 'directory' ? 'active' : ''}" onclick="navigate('directory')">
            <i data-lucide="users"></i> People Directory
          </a>
          ${['super_admin', 'identity_manager'].includes(state.role) ? `
            <a class="nav-item ${state.currentRoute === 'register' ? 'active' : ''}" onclick="navigate('register')">
              <i data-lucide="user-plus"></i> Register Person
            </a>
          ` : ''}
          <a class="nav-item ${state.currentRoute === 'cards' ? 'active' : ''}" onclick="navigate('cards')">
            <i data-lucide="credit-card"></i> ID Card & Print
          </a>
          <a class="nav-item ${state.currentRoute === 'history' ? 'active' : ''}" onclick="navigate('history')">
            <i data-lucide="history"></i> Verification Log
          </a>
          ${state.role === 'super_admin' ? `
            <a class="nav-item ${state.currentRoute === 'settings' ? 'active' : ''}" onclick="navigate('settings')">
              <i data-lucide="sliders"></i> Settings
            </a>
          ` : ''}
        </nav>

        <div class="sidebar-footer">
          <div class="user-profile-badge">
            <div class="user-avatar" style="background: linear-gradient(135deg, #1e3a8a 0%, #3b82f6 100%);">
              ${(state.user.fullName || 'U').substring(0, 1).toUpperCase()}
            </div>
            <div style="overflow: hidden; max-width: 130px;">
              <div style="font-size: 12.5px; font-weight: 700; color: #ffffff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-family: var(--font-display);">
                ${state.user.fullName}
              </div>
              <div style="font-size: 10.5px; color: #94a3b8; display: flex; align-items: center; gap: 4px; text-transform: capitalize;">
                <span style="width: 5px; height: 5px; border-radius: 50%; background: #10b981;"></span>
                ${state.role.replace('_', ' ')}
              </div>
            </div>
          </div>
          <button onclick="handleLogout()" title="Sign Out" style="background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.08); border-radius: 6px; padding: 6px; color: #94a3b8; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: all 0.15s ease;" onmouseover="this.style.color='#f43f5e'; this.style.background='rgba(244,63,94,0.1)'" onmouseout="this.style.color='#94a3b8'; this.style.background='rgba(255,255,255,0.06)'">
            <i data-lucide="log-out" style="width: 15px; height: 15px;"></i>
          </button>
        </div>
      </aside>

      <!-- Main Content Area -->
      <main class="main-content">
        <header class="topbar">
          <div class="topbar-left">
            <div style="display: flex; align-items: center; gap: 8px;">
              <span style="display: inline-flex; width: 8px; height: 8px; border-radius: 50%; background: #2563eb;"></span>
              <span style="font-size: 13.5px; font-weight: 700; color: #0f172a; font-family: var(--font-display);">
                ${state.org.name || 'Grace Chapel International'}
              </span>
            </div>
            <span style="color: #cbd5e1; font-weight: 300;">/</span>
            <span style="font-size: 12px; color: #475569; font-weight: 600; text-transform: capitalize; background: #f1f5f9; padding: 2px 9px; border-radius: 6px; border: 1px solid #e2e8f0;">
              ${state.currentRoute.replace('-', ' ')}
            </span>
          </div>
          <div class="topbar-right">
            <button class="btn btn-secondary btn-sm" onclick="navigate('scan')" style="border-color: #cbd5e1;">
              <i data-lucide="scan" style="width: 14px; height: 14px; color: #2563eb;"></i> Quick Scan
            </button>
            ${['super_admin', 'identity_manager'].includes(state.role) ? `
              <button class="btn btn-primary btn-sm" onclick="navigate('register')">
                <i data-lucide="plus" style="width: 14px; height: 14px;"></i> Register Marshal
              </button>
            ` : ''}
          </div>
        </header>

        <div class="page-container" id="pageContent">
          <!-- Dynamic Route Content Loaded Here -->
        </div>
      </main>
    </div>
  `;

  lucide.createIcons();
  renderCurrentRoute();
}

async function handleLogout() {
  await api('/api/auth/logout', { method: 'POST' }).catch(() => {});
  localStorage.removeItem('auth_token');
  state.user = null;
  render();
}

// Route Switcher
function renderCurrentRoute() {
  const container = document.getElementById('pageContent');
  if (!container) return;

  switch (state.currentRoute) {
    case 'dashboard':
      loadDashboardView(container);
      break;
    case 'scan':
      loadScannerView(container);
      break;
    case 'directory':
      loadDirectoryView(container);
      break;
    case 'register':
      loadRegisterView(container);
      break;
    case 'cards':
      loadCardsManagementView(container);
      break;
    case 'history':
      loadHistoryView(container);
      break;
    case 'settings':
      loadSettingsView(container);
      break;
    default:
      loadDashboardView(container);
  }
}

// --- 3. DASHBOARD VIEW ---
async function loadDashboardView(container) {
  container.innerHTML = `
    <div class="page-header">
      <div>
        <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 6px;">
          <h1 class="page-title">Operations Command & ID Fleet</h1>
          <span class="live-pulse-badge">
            <span class="pulse-dot"></span> Live Fleet Synchronized
          </span>
        </div>
        <div class="page-description">
          ${state.org?.name || 'Grace Chapel International'} &bull; Traffic Safety & Identity Verification Directorate
        </div>
      </div>
      <div style="display: flex; align-items: center; gap: 8px;">
        <button class="btn btn-secondary btn-sm" onclick="loadDashboardView(document.getElementById('pageContent'))" title="Refresh Live Data">
          <i data-lucide="refresh-cw" style="width: 14px; height: 14px;"></i> Refresh
        </button>
        ${['super_admin', 'identity_manager'].includes(state.role) ? `
          <button class="btn btn-accent btn-sm" onclick="navigate('register')">
            <i data-lucide="user-plus" style="width: 14px; height: 14px;"></i> Register Marshal
          </button>
        ` : ''}
        <button class="btn btn-primary btn-sm" onclick="navigate('scan')">
          <i data-lucide="scan" style="width: 14px; height: 14px;"></i> Scan Terminal
        </button>
      </div>
    </div>

    <div id="dashboardLoader" style="padding: 60px 20px; text-align: center; color: var(--text-muted); font-family: var(--font-display);">
      <div style="display: inline-block; width: 28px; height: 28px; border: 3px solid #e2e8f0; border-top-color: #2563eb; border-radius: 50%; animation: spin 0.8s linear infinite; margin-bottom: 12px;"></div>
      <div style="font-size: 13px; font-weight: 500;">Connecting to cloud identity telemetry...</div>
    </div>
  `;
  lucide.createIcons();

  try {
    const data = await api('/api/dashboard/stats');
    state.stats = data;

    const m = data.metrics;
    container.innerHTML = `
      <div class="page-header">
        <div>
          <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 6px; flex-wrap: wrap;">
            <h1 class="page-title">Operations Command & ID Fleet</h1>
            <span class="live-pulse-badge">
              <span class="pulse-dot"></span> Live Fleet Synchronized
            </span>
          </div>
          <div class="page-description">
            ${state.org?.name || 'Grace Chapel International'} &bull; Traffic Safety & Biometric Verification Directorate
          </div>
        </div>
        <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
          <button class="btn btn-secondary btn-sm" onclick="loadDashboardView(document.getElementById('pageContent'))">
            <i data-lucide="refresh-cw" style="width: 14px; height: 14px;"></i> Sync
          </button>
          ${['super_admin', 'identity_manager'].includes(state.role) ? `
            <button class="btn btn-accent btn-sm" onclick="navigate('register')">
              <i data-lucide="user-plus" style="width: 14px; height: 14px;"></i> Register Marshal
            </button>
          ` : ''}
          <button class="btn btn-primary btn-sm" onclick="navigate('scan')">
            <i data-lucide="scan" style="width: 14px; height: 14px;"></i> Scan Terminal
          </button>
        </div>
      </div>

      <!-- Sculpted Floating Metric Grid -->
      <div class="stat-grid">
        <!-- Total Registered Personnel -->
        <div class="stat-card">
          <div class="stat-card-top">
            <div class="stat-label">Total Registered Marshals</div>
            <div class="stat-icon-pill blue">
              <i data-lucide="users" style="width: 18px; height: 18px;"></i>
            </div>
          </div>
          <div class="stat-value">${m.totalIdentities}</div>
          <div class="stat-sub">
            <span style="color: #059669; font-weight: 700;">● ${m.activeIdentities} Active</span>
            <span style="color: #cbd5e1;">&bull;</span>
            <span>${m.suspendedIdentities} Suspended</span>
          </div>
        </div>

        <!-- Active Field Credentials -->
        <div class="stat-card">
          <div class="stat-card-top">
            <div class="stat-label">Active Field Badges</div>
            <div class="stat-icon-pill emerald">
              <i data-lucide="shield-check" style="width: 18px; height: 18px;"></i>
            </div>
          </div>
          <div class="stat-value" style="color: #059669;">${m.activeCards}</div>
          <div class="stat-sub">
            <span class="status-chip active" style="font-size: 11px; padding: 2px 8px;">
              <span class="chip-dot"></span> Valid In Field
            </span>
          </div>
        </div>

        <!-- Revoked / Voided Badges -->
        <div class="stat-card">
          <div class="stat-card-top">
            <div class="stat-label">Security Revocations</div>
            <div class="stat-icon-pill rose">
              <i data-lucide="shield-alert" style="width: 18px; height: 18px;"></i>
            </div>
          </div>
          <div class="stat-value" style="color: #e11d48;">${m.revokedCards}</div>
          <div class="stat-sub">
            <span style="color: #e11d48; font-weight: 600;">
              ${m.revokedCards > 0 ? `${m.revokedCards} Badges Voided / Cancelled` : 'Zero Revocation Flags'}
            </span>
          </div>
        </div>

        <!-- 30-Day Verifications -->
        <div class="stat-card">
          <div class="stat-card-top">
            <div class="stat-label">30-Day Verifications</div>
            <div class="stat-icon-pill purple">
              <i data-lucide="activity" style="width: 18px; height: 18px;"></i>
            </div>
          </div>
          <div class="stat-value">${m.totalScans30Days}</div>
          <div class="stat-sub">
            <span style="color: #059669; font-weight: 700;">${m.verifiedScans30Days} Valid</span>
            <span style="color: #cbd5e1;">&bull;</span>
            <span style="color: #e11d48; font-weight: 700;">${m.revokedScans30Days} Rejected</span>
          </div>
        </div>
      </div>

      <!-- Unified Dual Command Console Grid -->
      <div class="command-console-panel">
        <!-- Recently Registered Personnel -->
        <div class="console-panel-left">
          <div class="panel-heading">
            <div style="display: flex; align-items: center; gap: 8px;">
              <i data-lucide="id-card" style="width: 18px; height: 18px; color: #2563eb;"></i>
              <span>Recently Registered Personnel</span>
            </div>
            <a onclick="navigate('directory')" style="font-size: 12px; font-weight: 600; color: #2563eb; cursor: pointer; text-decoration: none; display: flex; align-items: center; gap: 4px;">
              Full Directory &rarr;
            </a>
          </div>
          <div class="table-container">
            <table class="data-table">
              <thead>
                <tr>
                  <th>Personnel & Rank</th>
                  <th>ID Number</th>
                  <th>Branch & Dept</th>
                  <th>Credential</th>
                  <th style="text-align: right;">Action</th>
                </tr>
              </thead>
              <tbody>
                ${data.recentPeople.length > 0 ? data.recentPeople.map(p => `
                  <tr>
                    <td>
                      <div style="display: flex; align-items: center; gap: 12px;">
                        <div class="avatar-wrapper">
                          ${renderAvatar(p.photo_url, p.full_name, 36)}
                        </div>
                        <div>
                          <div style="font-weight: 700; color: #0f172a; font-size: 13px; font-family: var(--font-display);">
                            ${p.title ? p.title + ' ' : ''}${p.full_name}
                          </div>
                          <div style="display: inline-block; font-size: 10px; font-weight: 600; color: #2563eb; background: #eff6ff; padding: 2px 7px; border-radius: 4px; margin-top: 3px; border: 1px solid #dbeafe;">
                            ${p.position || 'Staff Marshal'}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td>
                      <span class="id-code">${p.id_number}</span>
                    </td>
                    <td>
                      <div style="font-weight: 600; color: #334155; font-size: 12.5px;">${p.branch || 'Central'}</div>
                      <div style="font-size: 11px; color: var(--text-muted);">${p.department || 'Traffic Operations'}</div>
                    </td>
                    <td>
                      <span class="status-chip ${p.card_status === 'active' ? 'active' : (p.card_status === 'revoked' ? 'revoked' : 'neutral')}">
                        <span class="chip-dot"></span>
                        ${(p.card_status || 'Unissued').toUpperCase()}
                      </span>
                    </td>
                    <td style="text-align: right;">
                      <button class="btn btn-secondary btn-sm" onclick="navigate('directory')" title="View in Directory" style="padding: 5px 9px;">
                        <i data-lucide="arrow-up-right" style="width: 13px; height: 13px;"></i>
                      </button>
                    </td>
                  </tr>
                `).join('') : `
                  <tr><td colspan="5" style="text-align: center; color: var(--text-muted); padding: 36px;">No personnel registered in database.</td></tr>
                `}
              </tbody>
            </table>
          </div>
        </div>

        <!-- Recent Verification Activity Feed -->
        <div class="console-panel-right">
          <div class="panel-heading">
            <div style="display: flex; align-items: center; gap: 8px;">
              <i data-lucide="radio" style="width: 18px; height: 18px; color: #10b981;"></i>
              <span>Live Scan Stream</span>
            </div>
            <a onclick="navigate('history')" style="font-size: 12px; font-weight: 600; color: #2563eb; cursor: pointer; text-decoration: none; display: flex; align-items: center; gap: 4px;">
              Audit Log &rarr;
            </a>
          </div>
          <div style="display: flex; flex-direction: column; gap: 10px;">
            ${data.recentVerifications.length > 0 ? data.recentVerifications.map(v => {
              const isVerified = v.outcome === 'verified';
              const isRevoked = v.outcome === 'revoked';
              return `
                <div style="display: flex; align-items: flex-start; justify-content: space-between; padding: 10px 12px; border-radius: var(--radius-md); background: ${isVerified ? '#f8fafc' : (isRevoked ? '#fff1f2' : '#f8fafc')}; border: 1px solid ${isVerified ? '#f1f5f9' : (isRevoked ? '#fecdd3' : '#e2e8f0')}; transition: all 0.15s ease;">
                  <div style="display: flex; align-items: center; gap: 10px;">
                    <div style="width: 32px; height: 32px; border-radius: var(--radius-md); display: flex; align-items: center; justify-content: center; background: ${isVerified ? '#ecfdf5' : (isRevoked ? '#fee2e2' : '#f1f5f9')}; color: ${isVerified ? '#059669' : (isRevoked ? '#e11d48' : '#64748b')}; flex-shrink: 0;">
                      <i data-lucide="${isVerified ? 'shield-check' : (isRevoked ? 'shield-alert' : 'help-circle')}" style="width: 18px; height: 18px;"></i>
                    </div>
                    <div>
                      <div style="font-size: 13px; font-weight: 700; color: #0f172a; font-family: var(--font-display);">
                        ${v.person_name || 'Unrecognized Credential'}
                      </div>
                      <div style="font-size: 11px; color: var(--text-muted); margin-top: 1px;">
                        ${v.id_number ? `<span style="font-family: var(--font-data); font-weight: 600; color: #475569;">${v.id_number}</span> &bull; ` : ''}
                        <span>${formatRelativeTime(v.created_at)}</span>
                      </div>
                    </div>
                  </div>
                  <span class="status-chip ${isVerified ? 'active' : (isRevoked ? 'revoked' : 'neutral')}" style="font-size: 11px; padding: 2px 8px;">
                    <span class="chip-dot"></span>
                    ${v.outcome.toUpperCase()}
                  </span>
                </div>
              `;
            }).join('') : `
              <div style="text-align: center; color: var(--text-muted); padding: 36px; font-size: 12px; font-family: var(--font-display);">
                <i data-lucide="scan" style="width: 24px; height: 24px; margin-bottom: 8px; opacity: 0.5;"></i>
                <div>No scans recorded in system yet.</div>
              </div>
            `}
          </div>
        </div>
      </div>
    `;
    lucide.createIcons();
  } catch (err) {
    container.innerHTML = `
      <div class="card" style="border-left: 4px solid #e11d48; padding: 20px;">
        <div style="font-weight: 700; color: #e11d48; font-size: 14px; margin-bottom: 4px;">Telemetry Connection Error</div>
        <div style="color: var(--text-muted); font-size: 12.5px;">${err.message}</div>
        <button class="btn btn-secondary btn-sm" style="margin-top: 12px;" onclick="loadDashboardView(document.getElementById('pageContent'))">Try Again</button>
      </div>
    `;
  }
}

// --- 4. SCAN & VERIFY VIEW (MOBILE FIRST) ---
function loadScannerView(container) {
  container.innerHTML = `
    <div class="page-header">
      <div>
        <h1 class="page-title">Scan & Verify Credential</h1>
        <div class="page-description">Real-time mobile camera scanner for physical ID badges and QR codes.</div>
      </div>
    </div>

    <div class="scanner-container">
      <div class="card" style="padding: 24px;">
        <div id="cameraInstructions" style="font-size: 13px; color: var(--text-muted); margin-bottom: 16px;">
          Position the QR code inside the camera viewfinder to verify identity against live records.
        </div>

        <div id="qrReader" style="margin: 0 auto; min-height: 280px; display: flex; align-items: center; justify-content: center; background: #000000; color: #ffffff;">
          <button class="btn btn-accent" id="startScanBtn">
            <i data-lucide="camera"></i> Open Camera Scanner
          </button>
        </div>

        <div style="margin-top: 16px; display: flex; gap: 8px; justify-content: center;">
          <button class="btn btn-secondary btn-sm" id="stopScanBtn" style="display: none;">
            <i data-lucide="camera-off"></i> Stop Camera
          </button>
        </div>

        <!-- Manual Lookup Fallback -->
        <div style="margin-top: 24px; padding-top: 20px; border-top: 1px solid var(--border-subtle); text-align: left;">
          <label class="form-label">Manual Token / ID Verification Fallback</label>
          <div style="display: flex; gap: 8px;">
            <input type="text" id="manualTokenInput" class="form-control" placeholder="Paste 48-char verification token..." />
            <button class="btn btn-primary" id="manualVerifyBtn">Verify</button>
          </div>
        </div>
      </div>

      <!-- Verification Result Render Area -->
      <div id="verificationResultArea"></div>
    </div>
  `;
  lucide.createIcons();

  const startBtn = document.getElementById('startScanBtn');
  const stopBtn = document.getElementById('stopScanBtn');
  const manualBtn = document.getElementById('manualVerifyBtn');

  startBtn.addEventListener('click', () => {
    startCameraScanner();
  });

  stopBtn.addEventListener('click', () => {
    stopCameraScanner();
  });

  manualBtn.addEventListener('click', () => {
    const val = document.getElementById('manualTokenInput').value.trim();
    if (val) {
      // If full URL was pasted, extract token
      const token = val.includes('/verify/') ? val.split('/verify/')[1].split('/')[0] : (val.includes('/p/') ? val.split('/p/')[1].split('/')[0] : val);
      verifyToken(token);
    }
  });
}

function startCameraScanner() {
  const readerDiv = document.getElementById('qrReader');
  const startBtn = document.getElementById('startScanBtn');
  const stopBtn = document.getElementById('stopScanBtn');

  if (startBtn) startBtn.style.display = 'none';
  if (stopBtn) stopBtn.style.display = 'inline-flex';

  state.html5QrCode = new Html5Qrcode("qrReader");
  const config = { fps: 10, qrbox: { width: 220, height: 220 } };

  state.html5QrCode.start(
    { facingMode: "environment" },
    config,
    (decodedText) => {
      // Detected QR
      console.log('Scanned text:', decodedText);
      // Stop scanner upon successful read
      stopCameraScanner();
      // Extract token from URL
      let token = decodedText;
      if (decodedText.includes('/verify/')) {
        token = decodedText.split('/verify/')[1].split('?')[0].split('#')[0];
      } else if (decodedText.includes('/p/')) {
        token = decodedText.split('/p/')[1].split('?')[0].split('#')[0];
      }
      verifyToken(token);
    },
    (errorMessage) => {
      // Scanning frame error, keep scanning
    }
  ).catch(err => {
    readerDiv.innerHTML = `
      <div style="padding: 20px; color: #fee2e2; text-align: center;">
        <div style="font-weight: 600; margin-bottom: 6px;">Camera Access Unavailable</div>
        <div style="font-size: 12px;">${err.message || 'Permission denied or no camera device found.'}</div>
        <div style="margin-top: 12px;">Please use the manual token fallback below.</div>
      </div>
    `;
    if (stopBtn) stopBtn.style.display = 'none';
  });
}

function stopCameraScanner() {
  if (state.html5QrCode && state.html5QrCode.isScanning) {
    state.html5QrCode.stop().then(() => {
      state.html5QrCode.clear();
      const startBtn = document.getElementById('startScanBtn');
      const stopBtn = document.getElementById('stopScanBtn');
      if (startBtn) startBtn.style.display = 'inline-flex';
      if (stopBtn) stopBtn.style.display = 'none';
    }).catch(() => {});
  }
}

async function verifyToken(token) {
  const resultArea = document.getElementById('verificationResultArea');
  if (!resultArea) return;

  resultArea.innerHTML = `
    <div class="card" style="padding: 24px; text-align: center;">
      <div style="color: var(--text-muted);">Querying live database for token: <code style="font-weight: 600;">${token.substring(0, 12)}...</code></div>
    </div>
  `;

  try {
    const data = await api(`/api/verify/${token}`);
    renderVerificationProfileCard(resultArea, data);
  } catch (err) {
    resultArea.innerHTML = `
      <div class="verification-result-card">
        <div class="verif-banner revoked">
          <i data-lucide="alert-triangle" style="width: 24px; height: 24px;"></i>
          <div>
            <div style="font-weight: 700; font-size: 15px;">Verification Failed</div>
            <div style="font-size: 12px; opacity: 0.9;">${err.message}</div>
          </div>
        </div>
      </div>
    `;
    lucide.createIcons();
  }
}

function renderVerificationProfileCard(container, data) {
  const outcomeClass = data.outcome; // 'verified', 'revoked', 'expired', 'suspended', 'invalid'
  const isVerified = data.outcome === 'verified';

  container.innerHTML = `
    <div class="verification-result-card">
      <div class="verif-banner ${outcomeClass}">
        <i data-lucide="${isVerified ? 'check-circle' : 'shield-alert'}" style="width: 24px; height: 24px; flex-shrink: 0;"></i>
        <div>
          <div style="font-weight: 700; font-size: 15px;">${data.headline}</div>
          <div style="font-size: 12px; opacity: 0.95;">${data.message}</div>
        </div>
      </div>

      <div style="padding: 20px;">
        <div style="display: flex; gap: 16px; align-items: center; margin-bottom: 20px; padding-bottom: 16px; border-bottom: 1px solid var(--border-subtle);">
          <img src="${data.identity.photoUrl || 'https://via.placeholder.com/100'}" style="width: 70px; height: 70px; border-radius: 50%; object-fit: cover; border: 2px solid #cbd5e1; background: #f1f5f9;" />
          <div>
            <div style="font-size: 17px; font-weight: 700; color: #0f172a;">
              ${data.identity.title ? data.identity.title + ' ' : ''}${data.identity.fullName}
            </div>
            <div style="font-size: 12px; font-weight: 600; color: var(--accent-blue); margin-top: 2px;">
              ${data.identity.position || 'Registered Member'}
            </div>
            <div style="font-size: 11px; color: var(--text-muted); margin-top: 2px;">
              ${data.identity.department || 'General'} &bull; Branch: <strong>${data.identity.branch || 'Main Sanctuary'}</strong>
            </div>
          </div>
        </div>

        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; font-size: 12px; margin-bottom: 16px;">
          <div>
            <span style="color: var(--text-muted); display: block;">ID Number</span>
            <code style="font-weight: 700; font-size: 13px;">${data.identity.idNumber}</code>
          </div>
          <div>
            <span style="color: var(--text-muted); display: block;">Card Number</span>
            <span style="font-weight: 600;">${data.card.cardNumber}</span>
          </div>
          <div>
            <span style="color: var(--text-muted); display: block;">Issue Date</span>
            <span>${data.card.issueDate ? data.card.issueDate.split('T')[0] : '—'}</span>
          </div>
          <div>
            <span style="color: var(--text-muted); display: block;">Expiry Date</span>
            <span>${data.card.expiryDate ? data.card.expiryDate.split('T')[0] : 'Indefinite'}</span>
          </div>
        </div>

        ${data.identity.phone || data.identity.email ? `
          <div style="background: #f8fafc; border-radius: 6px; padding: 12px; margin-bottom: 16px; font-size: 12px;">
            <div style="font-weight: 600; margin-bottom: 6px; color: #334155;">Authorized Operational Contact</div>
            ${data.identity.phone ? `<div>Phone: <strong>${data.identity.phone}</strong></div>` : ''}
            ${data.identity.email ? `<div>Email: <strong>${data.identity.email}</strong></div>` : ''}
            ${data.identity.emergencyContactPhone ? `<div>Emergency Contact: <strong>${data.identity.emergencyContactName} (${data.identity.emergencyContactPhone})</strong></div>` : ''}
          </div>
        ` : ''}

        <div style="display: flex; justify-content: space-between; align-items: center; font-size: 11px; color: var(--text-muted); border-top: 1px solid var(--border-subtle); padding-top: 12px;">
          <span>Org: <strong>${data.organisation.name}</strong></span>
          <span>Verified At: ${new Date(data.timestamp).toLocaleTimeString()}</span>
        </div>
      </div>
    </div>
  `;
  lucide.createIcons();
}

// --- 5. PEOPLE DIRECTORY VIEW ---
let directoryPage = 1;
async function loadDirectoryView(container) {
  container.innerHTML = `
    <div class="page-header">
      <div>
        <h1 class="page-title">People Directory</h1>
        <div class="page-description">Search, filter, inspect credential statuses, and manage card issuance.</div>
      </div>
      <div>
        ${['super_admin', 'identity_manager'].includes(state.role) ? `
          <button class="btn btn-accent btn-sm" onclick="navigate('register')">
            <i data-lucide="user-plus" style="width: 14px; height: 14px;"></i> Register Person
          </button>
        ` : ''}
      </div>
    </div>

    <!-- Search & Filter Bar -->
    <div class="card" style="padding: 14px 18px; margin-bottom: 16px;">
      <div style="display: flex; gap: 12px; align-items: center; flex-wrap: wrap;">
        <div style="flex: 2; min-width: 220px;">
          <input type="text" id="directorySearchInput" class="form-control" placeholder="Search by name, ID number, or email..." />
        </div>
        <div style="flex: 1; min-width: 140px;">
          <select id="directoryStatusFilter" class="form-control">
            <option value="all">All Statuses</option>
            <option value="active">Active Only</option>
            <option value="suspended">Suspended</option>
            <option value="expired">Expired</option>
          </select>
        </div>
        <button class="btn btn-primary btn-sm" id="directorySearchBtn">Search</button>
      </div>
    </div>

    <!-- Table Container -->
    <div class="table-container">
      <div id="directoryTableContainer" style="padding: 20px; text-align: center; color: var(--text-muted);">
        Loading directory records...
      </div>
    </div>

    <!-- Pagination Controls -->
    <div id="directoryPagination" style="display: flex; justify-content: space-between; align-items: center; margin-top: 16px; font-size: 13px; color: var(--text-muted);"></div>

    <!-- Modal for Identity Details & Card Reissue -->
    <div class="modal-overlay" id="identityModal">
      <div class="modal-dialog">
        <div class="modal-header">
          <h2 style="font-size: 15px; font-weight: 600;" id="modalPersonName">Identity Record</h2>
          <button onclick="closeIdentityModal()" style="background: none; border: none; font-size: 16px; cursor: pointer;">✕</button>
        </div>
        <div class="modal-body" id="modalPersonBody"></div>
        <div class="modal-footer" id="modalPersonFooter"></div>
      </div>
    </div>
  `;
  lucide.createIcons();

  document.getElementById('directorySearchBtn').addEventListener('click', () => {
    directoryPage = 1;
    fetchDirectoryList();
  });

  document.getElementById('directorySearchInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      directoryPage = 1;
      fetchDirectoryList();
    }
  });

  fetchDirectoryList();
}

async function fetchDirectoryList() {
  const container = document.getElementById('directoryTableContainer');
  const paginationContainer = document.getElementById('directoryPagination');
  const search = document.getElementById('directorySearchInput')?.value || '';
  const status = document.getElementById('directoryStatusFilter')?.value || 'all';

  try {
    const data = await api(`/api/identities?search=${encodeURIComponent(search)}&status=${status}&page=${directoryPage}&limit=12`);

    if (data.identities.length === 0) {
      container.innerHTML = `<div style="padding: 30px; color: var(--text-muted);">No matching identities found.</div>`;
      if (paginationContainer) paginationContainer.innerHTML = '';
      return;
    }

    container.innerHTML = `
      <table class="data-table">
        <thead>
          <tr>
            <th>Member</th>
            <th>Permanent ID</th>
            <th>Branch & Unit</th>
            <th>Membership</th>
            <th>Approval</th>
            <th>Credential</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          ${data.identities.map(p => `
            <tr>
              <td>
                <div style="display: flex; align-items: center; gap: 10px;">
                  <img src="${p.photo_url || 'https://via.placeholder.com/80'}" style="width: 34px; height: 34px; border-radius: 50%; object-fit: cover; background: #e2e8f0;" />
                  <div>
                    <strong>${p.title ? p.title + ' ' : ''}${p.full_name}</strong>
                    <div style="font-size: 11px; color: var(--text-muted);">${p.position || 'Member'}</div>
                  </div>
                </div>
              </td>
              <td><code style="font-weight: 700; color: #1e293b;">${p.id_number}</code></td>
              <td>
                <div style="font-weight: 600;">${p.branch || 'Main Sanctuary'}</div>
                <div style="font-size: 11px; color: var(--text-muted);">${p.department || 'General'}</div>
              </td>
              <td>
                <span class="badge ${p.status === 'active' ? 'badge-verified' : (p.status === 'suspended' ? 'badge-suspended' : 'badge-neutral')}">
                  ${p.status}
                </span>
              </td>
              <td>
                <span class="badge ${p.approval_status === 'approved' ? 'badge-verified' : 'badge-expired'}">
                  ${p.approval_status || 'approved'}
                </span>
              </td>
              <td>
                <span class="badge ${p.card_status === 'active' ? 'badge-verified' : (p.card_status === 'revoked' ? 'badge-revoked' : 'badge-neutral')}">
                  ${p.card_status || 'None'}
                </span>
              </td>
              <td>
                <div style="display: flex; gap: 6px;">
                  <button class="btn btn-secondary btn-sm" onclick="openIdentityModal(${p.id})">
                    Inspect / Edit
                  </button>
                  <a href="/verify/${p.verification_token}" target="_blank" class="btn btn-secondary btn-sm" title="View Public Scan Profile">
                    &nearr;
                  </a>
                </div>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;

    // Pagination
    const pg = data.pagination;
    if (paginationContainer) {
      paginationContainer.innerHTML = `
        <div>Showing ${(pg.page - 1) * pg.limit + 1} to ${Math.min(pg.page * pg.limit, pg.totalCount)} of ${pg.totalCount} personnel</div>
        <div style="display: flex; gap: 6px;">
          <button class="btn btn-secondary btn-sm" ${pg.page <= 1 ? 'disabled' : ''} onclick="changeDirPage(${pg.page - 1})">Previous</button>
          <button class="btn btn-secondary btn-sm" ${pg.page >= pg.totalPages ? 'disabled' : ''} onclick="changeDirPage(${pg.page + 1})">Next</button>
        </div>
      `;
    }
  } catch (err) {
    container.innerHTML = `<div style="padding: 20px; color: var(--status-revoked);">Error: ${err.message}</div>`;
  }
}

function changeDirPage(newPage) {
  directoryPage = newPage;
  fetchDirectoryList();
}

async function openIdentityModal(personId) {
  const modal = document.getElementById('identityModal');
  const body = document.getElementById('modalPersonBody');
  const footer = document.getElementById('modalPersonFooter');
  modal.classList.add('open');

  body.innerHTML = 'Loading permanent identity and credential history...';

  try {
    const data = await api(`/api/identities/${personId}`);
    const p = data.identity;
    const cards = data.cards;

    document.getElementById('modalPersonName').innerText = `${p.title ? p.title + ' ' : ''}${p.full_name} (${p.id_number})`;

    body.innerHTML = `
      <div id="modalProfileView">
        <div style="display: flex; gap: 16px; margin-bottom: 16px; align-items: center;">
          <img src="${p.photo_url || 'https://via.placeholder.com/100'}" style="width: 72px; height: 72px; border-radius: 6px; object-fit: cover; background: #e2e8f0; border: 2px solid #cbd5e1;" />
          <div>
            <div style="font-size: 16px; font-weight: 700;">${p.full_name}</div>
            <div style="font-size: 12px; color: var(--accent-blue); font-weight: 600;">${p.position || 'Member'} &bull; ${p.department || 'General'}</div>
            <div style="font-size: 12px; color: var(--text-muted); margin-top: 2px;">Branch: <strong>${p.branch || 'Main Sanctuary'}</strong></div>
            <div style="font-size: 11px; color: var(--text-muted); margin-top: 4px;">Permanent ID: <code style="font-weight: 700;">${p.id_number}</code> &bull; Status: <span class="badge ${p.status === 'active' ? 'badge-verified' : 'badge-neutral'}">${p.status}</span></div>
          </div>
        </div>

        <div style="margin-top: 16px; border-top: 1px solid var(--border-subtle); padding-top: 12px;">
          <h3 style="font-size: 13px; font-weight: 600; margin-bottom: 8px;">Issued Credentials & Physical Cards (${cards.length})</h3>
          <div style="display: flex; flex-direction: column; gap: 8px; max-height: 160px; overflow-y: auto;">
            ${cards.map(c => `
              <div style="display: flex; align-items: center; justify-content: space-between; padding: 8px 12px; background: #f8fafc; border-radius: 6px; border: 1px solid var(--border-subtle); font-size: 12px;">
                <div>
                  <strong>${c.card_number}</strong>
                  ${c.is_current ? '<span class="badge badge-verified" style="margin-left: 6px;">CURRENT</span>' : ''}
                  <div style="font-size: 11px; color: var(--text-muted);">Issued: ${c.issue_date?.split('T')[0]} &bull; Token: ${c.verification_token.substring(0, 10)}...</div>
                  ${c.revocation_reason ? `<div style="font-size: 11px; color: var(--status-revoked);">Reason: ${c.revocation_reason}</div>` : ''}
                </div>
                <div style="display: flex; align-items: center; gap: 6px;">
                  <span class="badge ${c.status === 'active' ? 'badge-verified' : (c.status === 'revoked' ? 'badge-revoked' : 'badge-neutral')}">${c.status}</span>
                  ${c.status === 'active' && ['super_admin', 'identity_manager'].includes(state.role) ? `
                    <button class="btn btn-danger btn-sm" onclick="revokeCard(${c.id}, ${p.id})">Revoke</button>
                  ` : ''}
                </div>
              </div>
            `).join('')}
          </div>
        </div>
      </div>

      <!-- Edit Personnel Profile Form (Hidden by default) -->
      <div id="modalProfileEditForm" style="display: none; padding-top: 8px;">
        <h3 style="font-size: 14px; font-weight: 600; margin-bottom: 12px; color: var(--accent-blue);">Super Admin: Correct Personnel Profile</h3>
        <form id="editPersonForm">
          <div class="form-row">
            <div style="flex: 1;">
              <label class="form-label">Title</label>
              <input type="text" id="editTitle" class="form-control" value="${p.title || ''}" />
            </div>
            <div style="flex: 2;">
              <label class="form-label">Full Legal Name</label>
              <input type="text" id="editFullName" class="form-control" value="${p.full_name}" required />
            </div>
          </div>

          <div class="form-row" style="margin-top: 10px;">
            <div style="flex: 1;">
              <label class="form-label">Branch / Assembly</label>
              <input type="text" id="editBranch" class="form-control" value="${p.branch || 'Main Sanctuary'}" required />
            </div>
            <div style="flex: 1;">
              <label class="form-label">Department / Unit</label>
              <input type="text" id="editDepartment" class="form-control" value="${p.department || ''}" required />
            </div>
            <div style="flex: 1;">
              <label class="form-label">Rank / Position</label>
              <input type="text" id="editPosition" class="form-control" value="${p.position || ''}" />
            </div>
          </div>

          <div class="form-row" style="margin-top: 10px;">
            <div style="flex: 1;">
              <label class="form-label">Membership Status</label>
              <select id="editStatus" class="form-control">
                <option value="active" ${p.status === 'active' ? 'selected' : ''}>Active</option>
                <option value="suspended" ${p.status === 'suspended' ? 'selected' : ''}>Suspended</option>
                <option value="inactive" ${p.status === 'inactive' ? 'selected' : ''}>Inactive</option>
              </select>
            </div>
            <div style="flex: 1;">
              <label class="form-label">Registration Approval</label>
              <select id="editApproval" class="form-control">
                <option value="approved" ${p.approval_status === 'approved' ? 'selected' : ''}>Approved</option>
                <option value="pending" ${p.approval_status === 'pending' ? 'selected' : ''}>Pending Verification</option>
              </select>
            </div>
          </div>

          <div class="form-group" style="margin-top: 10px;">
            <label class="form-label">Replace Photograph (Optional)</label>
            <input type="file" id="editPhotoFile" accept="image/*" class="form-control" />
          </div>

          <div class="form-group" style="margin-top: 10px; background: #fffbeb; padding: 10px; border-radius: 6px; border: 1px solid #fde68a;">
            <label class="form-label" style="color: #92400e;">Mandatory Reason for Correction / Change *</label>
            <input type="text" id="editReason" class="form-control" required placeholder="e.g. Corrected surname spelling, transferred to Ikeja Branch" />
          </div>

          <div style="display: flex; gap: 8px; justify-content: flex-end; margin-top: 14px;">
            <button type="button" class="btn btn-secondary btn-sm" onclick="toggleEditProfileView(false)">Cancel</button>
            <button type="submit" id="saveEditBtn" class="btn btn-primary btn-sm">Save & Record Audit Trail</button>
          </div>
        </form>
      </div>
    `;

    footer.innerHTML = `
      <button class="btn btn-secondary btn-sm" onclick="closeIdentityModal()">Close</button>
      ${['super_admin', 'identity_manager'].includes(state.role) ? `
        <button class="btn btn-secondary btn-sm" id="btnToggleEditProfile" onclick="toggleEditProfileView(true)">
          Edit Personnel Profile
        </button>
        <button class="btn btn-primary btn-sm" onclick="reissueCard(${p.id})">
          Reissue New Card
        </button>
      ` : ''}
    `;

    // Handle Edit Form Submit
    document.getElementById('editPersonForm')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const saveBtn = document.getElementById('saveEditBtn');
      saveBtn.disabled = true;
      saveBtn.innerText = 'Saving changes...';

      const formData = new FormData();
      formData.append('title', document.getElementById('editTitle').value);
      formData.append('fullName', document.getElementById('editFullName').value);
      formData.append('branch', document.getElementById('editBranch').value);
      formData.append('department', document.getElementById('editDepartment').value);
      formData.append('position', document.getElementById('editPosition').value);
      formData.append('status', document.getElementById('editStatus').value);
      formData.append('approvalStatus', document.getElementById('editApproval').value);
      formData.append('reason', document.getElementById('editReason').value);

      const photoInput = document.getElementById('editPhotoFile');
      if (photoInput && photoInput.files && photoInput.files[0]) {
        formData.append('photo', photoInput.files[0]);
      }

      try {
        const res = await fetch(`/api/identities/${p.id}`, {
          method: 'PUT',
          body: formData
        });
        const resData = await res.json();
        if (!res.ok) throw new Error(resData.error || 'Failed to update profile.');

        alert('Personnel profile corrected successfully! Audit entry recorded.');
        openIdentityModal(p.id);
        fetchDirectoryList();
      } catch (err) {
        alert('Error updating profile: ' + err.message);
        saveBtn.disabled = false;
        saveBtn.innerText = 'Save & Record Audit Trail';
      }
    });
  } catch (err) {
    body.innerHTML = `Error: ${err.message}`;
  }
}

function toggleEditProfileView(showEdit) {
  const profileView = document.getElementById('modalProfileView');
  const editForm = document.getElementById('modalProfileEditForm');
  const toggleBtn = document.getElementById('btnToggleEditProfile');

  if (profileView && editForm) {
    profileView.style.display = showEdit ? 'none' : 'block';
    editForm.style.display = showEdit ? 'block' : 'none';
  }
  if (toggleBtn) {
    toggleBtn.style.display = showEdit ? 'none' : 'inline-flex';
  }
}

function closeIdentityModal() {
  document.getElementById('identityModal').classList.remove('open');
}

async function revokeCard(cardId, personId) {
  const reason = prompt('Please enter the reason for revoking this card (e.g. Lost, Stolen, Defaced, Replaced):');
  if (!reason) return;

  try {
    await api(`/api/cards/${cardId}/revoke`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason })
    });
    alert('Card has been revoked.');
    openIdentityModal(personId);
    fetchDirectoryList();
  } catch (err) {
    alert('Error revoking card: ' + err.message);
  }
}

async function reissueCard(personId) {
  const reason = prompt('Reason for reissuing new card (e.g. Annual renewal, Replacement for lost card):', 'Annual renewal');
  if (!reason) return;

  try {
    await api(`/api/cards/reissue/${personId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason })
    });
    alert('New card successfully reissued with fresh secure token!');
    openIdentityModal(personId);
    fetchDirectoryList();
  } catch (err) {
    alert('Error reissuing card: ' + err.message);
  }
}

// --- 6. REGISTER PERSON VIEW ---
function loadRegisterView(container) {
  container.innerHTML = `
    <div class="page-header">
      <div>
        <h1 class="page-title">Register Person & Issue ID Card</h1>
        <div class="page-description">Create a stable identity record and automatically issue an active physical ID card.</div>
      </div>
    </div>

    <div class="card" style="max-width: 780px;">
      <form id="registerPersonForm">
        <div class="form-row">
          <div style="flex: 1;">
            <label class="form-label">Honorific Title</label>
            <select id="regTitle" class="form-control">
              <option value="">None</option>
              <option value="Pastor">Pastor</option>
              <option value="Elder">Elder</option>
              <option value="Deacon">Deacon</option>
              <option value="Sis">Sis</option>
              <option value="Bro">Bro</option>
              <option value="Mr">Mr</option>
              <option value="Mrs">Mrs</option>
              <option value="Dr">Dr</option>
            </select>
          </div>
          <div style="flex: 2;">
            <label class="form-label">First Name *</label>
            <input type="text" id="regFirstName" class="form-control" required placeholder="e.g. David" />
          </div>
          <div style="flex: 2;">
            <label class="form-label">Last Name *</label>
            <input type="text" id="regLastName" class="form-control" required placeholder="e.g. Oyedele" />
          </div>
        </div>

        <div class="form-row" style="margin-top: 14px;">
          <div style="flex: 1;">
            <label class="form-label">Branch or Location *</label>
            <input type="text" id="regBranch" class="form-control" required placeholder="e.g. Main Sanctuary, Lekki Assembly, Ikeja" value="Main Sanctuary" />
          </div>
          <div style="flex: 1;">
            <label class="form-label">Department / Unit *</label>
            <input type="text" id="regDepartment" class="form-control" required placeholder="e.g. Traffic Operations Command, Protocol" />
          </div>
          <div style="flex: 1;">
            <label class="form-label">Position / Rank</label>
            <input type="text" id="regPosition" class="form-control" placeholder="e.g. Chief Traffic Marshal, Senior Officer" />
          </div>
        </div>

        <div class="form-row" style="margin-top: 14px;">
          <div style="flex: 1;">
            <label class="form-label">Email Address</label>
            <input type="email" id="regEmail" class="form-control" placeholder="person@organisation.org" />
          </div>
          <div style="flex: 1;">
            <label class="form-label">Phone Number</label>
            <input type="text" id="regPhone" class="form-control" placeholder="+234..." />
          </div>
          <div style="flex: 1;">
            <label class="form-label">Registration Approval Status</label>
            <select id="regApproval" class="form-control">
              <option value="approved">Approved & Verified</option>
              <option value="pending">Pending Admin Verification</option>
            </select>
          </div>
        </div>

        <div class="form-row" style="margin-top: 14px;">
          <div style="flex: 1;">
            <label class="form-label">Emergency Contact Name</label>
            <input type="text" id="regEmergName" class="form-control" placeholder="Next of Kin / Contact" />
          </div>
          <div style="flex: 1;">
            <label class="form-label">Emergency Contact Phone</label>
            <input type="text" id="regEmergPhone" class="form-control" placeholder="+234..." />
          </div>
        </div>

        <!-- Photograph Upload -->
        <div style="margin-top: 16px; padding: 16px; background: #f8fafc; border: 1px solid var(--border-subtle); border-radius: 8px;">
          <label class="form-label">Upload Profile Photograph *</label>
          <div style="display: flex; gap: 16px; align-items: center;">
            <img id="photoPreviewImg" src="" style="width: 70px; height: 70px; border-radius: 50%; object-fit: cover; display: none; border: 2px solid var(--accent-blue);" />
            <div>
              <input type="file" id="regPhotoFile" accept="image/*" class="form-control" required />
              <div style="font-size: 11px; color: var(--text-muted); margin-top: 4px;">High-resolution portrait photo for card printing (JPG, PNG, WebP)</div>
            </div>
          </div>
        </div>

        <div style="margin-top: 20px; display: flex; justify-content: flex-end; gap: 10px;">
          <button type="button" class="btn btn-secondary" onclick="navigate('directory')">Cancel</button>
          <button type="submit" id="submitRegBtn" class="btn btn-primary">
            Register Identity & Generate Card
          </button>
        </div>
      </form>
    </div>
  `;

  const photoInput = document.getElementById('regPhotoFile');
  const previewImg = document.getElementById('photoPreviewImg');

  photoInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (ev) => {
        previewImg.src = ev.target.result;
        previewImg.style.display = 'block';
      };
      reader.readAsDataURL(file);
    }
  });

  document.getElementById('registerPersonForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('submitRegBtn');
    btn.disabled = true;
    btn.innerText = 'Creating Identity & Issuing Card...';

    const formData = new FormData();
    const firstName = document.getElementById('regFirstName').value.trim();
    const lastName = document.getElementById('regLastName').value.trim();

    formData.append('title', document.getElementById('regTitle').value);
    formData.append('firstName', firstName);
    formData.append('lastName', lastName);
    formData.append('fullName', `${firstName} ${lastName}`);
    formData.append('branch', document.getElementById('regBranch').value.trim());
    formData.append('department', document.getElementById('regDepartment').value.trim());
    formData.append('position', document.getElementById('regPosition').value.trim());
    formData.append('approvalStatus', document.getElementById('regApproval').value);
    formData.append('email', document.getElementById('regEmail').value.trim());
    formData.append('phone', document.getElementById('regPhone').value.trim());
    formData.append('emergencyContactName', document.getElementById('regEmergName').value.trim());
    formData.append('emergencyContactPhone', document.getElementById('regEmergPhone').value.trim());
    formData.append('emergencyContactPhone', document.getElementById('regEmergPhone').value.trim());

    if (photoInput.files && photoInput.files[0]) {
      formData.append('photo', photoInput.files[0]);
    }

    try {
      const res = await fetch('/api/identities', {
        method: 'POST',
        body: formData
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to register identity.');

      alert(`Identity registered successfully!\nID Number: ${data.identity.id_number}\nCard Issued: ${data.card.card_number}`);
      navigate('directory');
    } catch (err) {
      alert('Error: ' + err.message);
      btn.disabled = false;
      btn.innerText = 'Register Identity & Generate Card';
    }
  });
}

// --- 7. ID CARD MANAGEMENT & PHYSICAL PRINT VIEW ---
async function loadCardsManagementView(container) {
  container.innerHTML = `
    <div class="page-header">
      <div>
        <h1 class="page-title">Physical ID Card Management & Printing</h1>
        <div class="page-description">Standard CR80 format physical card generation with security QR code and print layout.</div>
      </div>
      <div>
        <button class="btn btn-primary btn-sm" onclick="printCard()">
          <i data-lucide="printer" style="width: 14px; height: 14px;"></i> Print ID Card
        </button>
      </div>
    </div>

    <!-- Member Picker -->
    <div class="card" style="padding: 16px; margin-bottom: 20px;">
      <label class="form-label">Select Registered Person to Preview & Print</label>
      <select id="cardPersonSelect" class="form-control" style="max-width: 450px;">
        <option value="">Loading members...</option>
      </select>
    </div>

    <!-- Visual CR80 Card Preview -->
    <div id="cardPreviewContainer">
      <div style="text-align: center; color: var(--text-muted); padding: 40px;">Select a person above to preview their printable badge.</div>
    </div>
  `;
  lucide.createIcons();

  try {
    const data = await api('/api/identities?limit=100');
    const sel = document.getElementById('cardPersonSelect');
    if (!sel) return;

    sel.innerHTML = '<option value="">Select person...</option>' + data.identities.map(p => `
      <option value="${p.id}">${p.full_name} (${p.id_number}) — Card: ${p.card_status || 'None'}</option>
    `).join('');

    sel.addEventListener('change', async (e) => {
      const id = e.target.value;
      if (id) {
        renderCardForPerson(id);
      }
    });

    // Auto-select first person if available
    if (data.identities.length > 0) {
      sel.value = data.identities[0].id;
      renderCardForPerson(data.identities[0].id);
    }
  } catch (err) {
    console.error(err);
  }
}

async function renderCardForPerson(personId) {
  const container = document.getElementById('cardPreviewContainer');
  if (!container) return;

  container.innerHTML = 'Rendering CR80 high-contrast badge preview...';

  try {
    const data = await api(`/api/identities/${personId}`);
    const p = data.identity;
    const currentCard = data.cards.find(c => c.is_current) || data.cards[0];

    if (!currentCard) {
      container.innerHTML = `<div class="card" style="padding: 20px; color: var(--status-revoked);">No card has been issued for this person yet.</div>`;
      return;
    }

    const cardHtml = `
      <div class="cr80-card-wrapper" id="badgeContainer">
        <!-- FRONT OF CARD -->
        <div>
          <div style="font-size: 11px; font-weight: 600; text-transform: uppercase; color: var(--text-muted); margin-bottom: 6px; text-align: center;">Front Layout (CR80 Standard)</div>
          <div class="cr80-card">
            <div class="cr80-header">
              <div class="cr80-org-name">${state.org.name || 'Grace Chapel International'}</div>
              <div style="font-size: 9px; opacity: 0.8; font-weight: 600;">OFFICIAL ID</div>
            </div>
            <div class="cr80-body">
              <img class="cr80-photo" src="${p.photo_url || 'https://via.placeholder.com/100'}" alt="Badge Photo" />
              <div class="cr80-info">
                <div class="cr80-name">${p.title ? p.title + ' ' : ''}${p.full_name}</div>
                <div class="cr80-rank">${p.position || 'Registered Member'}</div>
                <div class="cr80-dept">${p.department || 'General Assembly'} &bull; ${p.branch || 'Main Sanctuary'}</div>
                <div class="cr80-id-badge">${p.id_number}</div>
              </div>
            </div>
            <div class="cr80-footer">
              <span>Card: ${currentCard.card_number}</span>
              <span>Expires: ${currentCard.expiry_date ? currentCard.expiry_date.split('T')[0] : 'Indefinite'}</span>
            </div>
          </div>
        </div>

        <!-- BACK OF CARD -->
        <div>
          <div style="font-size: 11px; font-weight: 600; text-transform: uppercase; color: var(--text-muted); margin-bottom: 6px; text-align: center;">Back Layout (QR & Recovery)</div>
          <div class="cr80-card">
            <div class="cr80-header" style="background: #1e293b;">
              <div class="cr80-org-name" style="font-size: 9px;">VERIFICATION & RETURN</div>
              <div style="font-size: 8px;">SCAN WITH PHONE</div>
            </div>
            <div class="cr80-back-body">
              <div class="cr80-qr-wrapper">
                <img class="cr80-qr-image" src="/api/cards/${currentCard.id}/qr" alt="Verification QR" />
              </div>
              <div class="cr80-back-instruction">
                Scan with any smartphone camera to verify authentic credentials against official live records.
              </div>
            </div>
            <div class="cr80-footer">
              <span>Property of ${state.org.name}</span>
              <span>Status: ${currentCard.status.toUpperCase()}</span>
            </div>
          </div>
        </div>
      </div>
    `;

    container.innerHTML = cardHtml;

    // Prepare print area
    const printArea = document.getElementById('printCardArea');
    if (printArea) {
      printArea.innerHTML = cardHtml;
    }
  } catch (err) {
    container.innerHTML = `Error: ${err.message}`;
  }
}

function printCard() {
  window.print();
}

// --- 8. VERIFICATION HISTORY VIEW ---
async function loadHistoryView(container) {
  container.innerHTML = `
    <div class="page-header">
      <div>
        <h1 class="page-title">Verification History & Audit Log</h1>
        <div class="page-description">Immutable record of all QR scans, verification outcomes, and operational inspections.</div>
      </div>
    </div>

    <div class="table-container">
      <div id="historyTableContainer" style="padding: 20px; text-align: center; color: var(--text-muted);">
        Loading verification log...
      </div>
    </div>
  `;

  try {
    const list = await api('/api/audit/verifications?limit=40');
    const tableDiv = document.getElementById('historyTableContainer');

    if (list.length === 0) {
      tableDiv.innerHTML = `<div style="padding: 30px;">No scan events recorded yet.</div>`;
      return;
    }

    tableDiv.innerHTML = `
      <table class="data-table">
        <thead>
          <tr>
            <th>Timestamp</th>
            <th>Person / Identity</th>
            <th>ID Number</th>
            <th>Outcome</th>
            <th>Scanned By</th>
            <th>IP Address</th>
          </tr>
        </thead>
        <tbody>
          ${list.map(ev => `
            <tr>
              <td>${new Date(ev.created_at).toLocaleString()}</td>
              <td><strong>${ev.person_name || 'Unrecognized Card'}</strong></td>
              <td><code>${ev.id_number || '—'}</code></td>
              <td>
                <span class="badge ${ev.outcome === 'verified' ? 'badge-verified' : (ev.outcome === 'revoked' ? 'badge-revoked' : 'badge-expired')}">
                  ${ev.outcome}
                </span>
              </td>
              <td>${ev.scanned_by_name || 'Public Visitor'}</td>
              <td><code>${ev.ip_address || '—'}</code></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  } catch (err) {
    container.innerHTML = `Error: ${err.message}`;
  }
}

// --- 9. SETTINGS VIEW ---
async function loadSettingsView(container) {
  container.innerHTML = `
    <div class="page-header">
      <div>
        <h1 class="page-title">Organisation Settings</h1>
        <div class="page-description">Manage organization branding, ID number sequence rules, and verification policies.</div>
      </div>
    </div>

    <div class="card" style="max-width: 680px;">
      <form id="orgSettingsForm">
        <div class="form-group">
          <label class="form-label">Organisation Name</label>
          <input type="text" id="setOrgName" class="form-control" required />
        </div>

        <div class="form-row">
          <div style="flex: 1;">
            <label class="form-label">ID Number Prefix</label>
            <input type="text" id="setIdPrefix" class="form-control" placeholder="e.g. GCI, CORP" required />
          </div>
          <div style="flex: 1;">
            <label class="form-label">Default Card Validity (Days)</label>
            <input type="number" id="setValidity" class="form-control" min="30" max="3650" />
          </div>
        </div>

        <div class="form-row" style="margin-top: 14px;">
          <div style="flex: 1;">
            <label class="form-label">Security / Contact Email</label>
            <input type="email" id="setContactEmail" class="form-control" />
          </div>
          <div style="flex: 1;">
            <label class="form-label">Contact Phone</label>
            <input type="text" id="setContactPhone" class="form-control" />
          </div>
        </div>

        <div class="form-group" style="margin-top: 14px;">
          <label class="form-label">Verification Instructions (Printed on Card Back)</label>
          <textarea id="setInstructions" class="form-control" rows="2"></textarea>
        </div>

        <div style="margin-top: 20px; display: flex; justify-content: flex-end;">
          <button type="submit" class="btn btn-primary">Save Settings</button>
        </div>
      </form>
    </div>
  `;

  try {
    const s = await api('/api/organisation/settings');
    document.getElementById('setOrgName').value = s.name || '';
    document.getElementById('setIdPrefix').value = s.id_prefix || '';
    document.getElementById('setValidity').value = s.default_validity_days || 365;
    document.getElementById('setContactEmail').value = s.contact_email || '';
    document.getElementById('setContactPhone').value = s.contact_phone || '';
    document.getElementById('setInstructions').value = s.verification_instructions || '';

    document.getElementById('orgSettingsForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await api('/api/organisation/settings', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: document.getElementById('setOrgName').value,
            idPrefix: document.getElementById('setIdPrefix').value,
            defaultValidityDays: document.getElementById('setValidity').value,
            contactEmail: document.getElementById('setContactEmail').value,
            contactPhone: document.getElementById('setContactPhone').value,
            verificationInstructions: document.getElementById('setInstructions').value
          })
        });
        alert('Settings updated successfully.');
        state.org.name = document.getElementById('setOrgName').value;
        render();
      } catch (err) {
        alert('Error: ' + err.message);
      }
    });
  } catch (err) {
    container.innerHTML = `Error: ${err.message}`;
  }
}

// --- 10. PUBLIC SCAN VERIFICATION VIEW ---
async function renderPublicVerifyView(container) {
  container.innerHTML = `
    <div style="min-height: 100vh; background: #f8fafc; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 20px;">
      <div id="publicVerifyContent" style="width: 100%; max-width: 440px;">
        <div class="card" style="text-align: center; padding: 30px;">
          <div style="color: var(--text-muted);">Verifying credential token...</div>
        </div>
      </div>
    </div>
  `;

  const target = document.getElementById('publicVerifyContent');
  try {
    const data = await api(`/api/verify/${state.verifyToken}`);
    renderVerificationProfileCard(target, data);
  } catch (err) {
    target.innerHTML = `
      <div class="verification-result-card">
        <div class="verif-banner revoked">
          <i data-lucide="shield-alert" style="width: 24px; height: 24px;"></i>
          <div>
            <div style="font-weight: 700; font-size: 15px;">Credential Not Verified</div>
            <div style="font-size: 12px; opacity: 0.9;">${err.message}</div>
          </div>
        </div>
      </div>
    `;
    lucide.createIcons();
  }
}

// Initialize on Load
window.addEventListener('DOMContentLoaded', initSession);
window.addEventListener('hashchange', () => {
  const hash = window.location.hash.replace('#', '') || 'dashboard';
  if (state.user && state.currentRoute !== hash) {
    state.currentRoute = hash;
    render();
  }
});
