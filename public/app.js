// ==============================================================================
// APEX ENTERPRISE IDENTITY & QR VERIFICATION SPA
// ==============================================================================

// --- INITIAL ROUTING CHECK (Immediate Verification Interceptor) ---
// This runs synchronously before anything else in the app loads
(function checkForVerification() {
  const path = window.location.pathname;
  const pathParts = path.split('/').filter(Boolean);
  
  // Check if current URL is a QR verification route (/verify/:token or /p/:token)
  if (path.startsWith('/verify/') || path.startsWith('/p/') || (pathParts.length >= 2 && (pathParts[0] === 'verify' || pathParts[0] === 'p'))) {
    const token = pathParts[pathParts.length - 1];
    
    // Set global flags so no background or deferred router redirects kick the user to login/dashboard
    window.__IS_VERIFICATION_ROUTE__ = true;
    window.__VERIFICATION_TOKEN__ = token;

    function mountVerify() {
      // Hide any legacy shell elements if present
      const sidebar = document.querySelector('.sidebar');
      if (sidebar) sidebar.style.display = 'none';
      const topbar = document.querySelector('.topbar');
      if (topbar) topbar.style.display = 'none';

      const root = document.getElementById('appRoot') || document.body;
      if (root) {
        renderPublicVerifyView(root, token);
      }
    }

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', mountVerify, { once: true });
    } else {
      mountVerify();
    }
  }
})();

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
function getAuthHeaders() {
  const token = localStorage.getItem('auth_token');
  return token ? { 'Authorization': `Bearer ${token}` } : {};
}

async function api(url, options = {}) {
  try {
    const headers = {
      'Accept': 'application/json',
      ...getAuthHeaders(),
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

// --- FRONTEND ROUTER ---
function handleRouting() {
  const path = window.location.pathname;
  const hash = window.location.hash;

  // 1. Prevent router from interfering if on verification route
  if (window.__IS_VERIFICATION_ROUTE__ || path.startsWith('/verify/') || path.startsWith('/p/')) {
    return;
  }

  // 2. Normal Hash / Path Self-Registration
  if (path === '/register' || hash === '#register' || hash === '#public-register') {
    state.currentRoute = 'public-register';
    const container = document.getElementById('appRoot');
    if (container) {
      loadPublicRegisterView(container);
    }
    return;
  }

  // 3. Normal App Routing (Hash Navigation)
  if (hash) {
    const route = hash.replace('#', '');
    if (state.currentRoute !== route) {
      state.currentRoute = route;
      if (state.user) {
        renderCurrentRoute();
      } else {
        render();
      }
    }
  }
}

// --- Session Verification ---
async function initSession() {
  const path = window.location.pathname;
  const hash = window.location.hash;
  const pathParts = path.split('/').filter(Boolean);

  // If on verification route, do not restore admin session or redirect
  if (window.__IS_VERIFICATION_ROUTE__ || path.startsWith('/verify/') || path.startsWith('/p/')) {
    return;
  }

  // If token is in localStorage, attempt to restore user session
  if (localStorage.getItem('auth_token')) {
    try {
      const session = await api('/api/auth/me');
      if (session && session.user) {
        state.user = session.user;
        state.org = session.organisation;
        state.role = session.role;
      }
    } catch (e) {
      // Session expired or invalid
    }
  }

  // 2. Check if current URL is public self-registration: /register or #register
  if (pathParts[0] === 'register' || hash === '#register' || hash === '#public-register') {
    state.currentRoute = 'public-register';
    render();
    return;
  }

  if (state.user) {
    const route = hash.replace('#', '') || 'dashboard';
    state.currentRoute = route;
  } else {
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

  // 2. Public Self-Registration View (Auto-Approval with Instant CR80 Card)
  if (state.currentRoute === 'public-register') {
    loadPublicRegisterView(root);
    return;
  }

  // 3. Unauthenticated -> Login View
  if (!state.user) {
    renderLoginView(root);
    return;
  }

  // 4. Authenticated -> Enterprise Platform Shell
  renderAppShell(root);
}

// --- 1. LOGIN VIEW ---
function renderLoginView(container) {
  container.innerHTML = `
    <div style="min-height: 100vh; display: flex; align-items: center; justify-content: center; background: #090d16; padding: 20px;">
      <div style="width: 100%; max-width: 420px; background: #ffffff; border-radius: 12px; border: 1px solid #1e293b; padding: 32px; box-shadow: 0 20px 50px rgba(0,0,0,0.4);">
        <div style="margin-bottom: 24px; text-align: left;">
          <div style="width: 40px; height: 40px; background: linear-gradient(135deg, #1e3a8a 0%, #2563eb 100%); border-radius: 8px; display: flex; align-items: center; justify-content: center; color: #ffffff; font-weight: 800; font-size: 16px; margin-bottom: 14px; box-shadow: 0 4px 10px rgba(37,99,235,0.3);">
            GCI
          </div>
          <h1 style="font-size: 20px; font-weight: 800; color: #0f172a; letter-spacing: -0.02em;">Apex Identity Platform</h1>
          <p style="font-size: 12.5px; color: #64748b; margin-top: 4px;">Sign in with your authorized administrative credentials.</p>
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

          <button type="submit" id="loginBtn" class="btn btn-primary" style="width: 100%; margin-top: 8px; padding: 11px; font-weight: 600;">
            Sign In to Identity Workspace
          </button>
        </form>

        <!-- Public Self-Registration Option -->
        <div style="margin-top: 20px; padding: 14px; background: #f8fafc; border: 1px dashed #cbd5e1; border-radius: 8px; text-align: center;">
          <div style="font-size: 12px; font-weight: 700; color: #1e3a8a; display: flex; align-items: center; justify-content: center; gap: 6px;">
            <span>🎖️</span> New Member or Traffic Marshal?
          </div>
          <div style="font-size: 11px; color: #64748b; margin: 4px 0 10px;">
            Register now to receive your official permanent ID &amp; instant digital QR card.
          </div>
          <button type="button" class="btn btn-secondary btn-sm" onclick="navigate('public-register')" style="width: 100%; font-weight: 600;">
            Self-Register for Digital ID &rarr;
          </button>
        </div>

        <div style="margin-top: 20px; padding-top: 14px; border-top: 1px solid #f1f5f9; font-size: 11px; color: #94a3b8; text-align: center;">
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
          <a class="nav-item ${state.currentRoute === 'enrollment' ? 'active' : ''}" onclick="navigate('enrollment')">
            <i data-lucide="qr-code"></i> Public Enrollment
          </a>
          <a class="nav-item ${state.currentRoute === 'attendance' ? 'active' : ''}" onclick="navigate('attendance')">
            <i data-lucide="clipboard-check"></i> Attendance Register
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
    case 'enrollment':
      renderEnrollmentQRView(container);
      break;
    case 'attendance':
      renderAttendanceRegisterView(container);
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
          <ul class="activity-feed" id="liveScanFeed">
            <li class="activity-item">
              <span class="activity-meta" style="color: var(--text-muted);">Loading scan stream...</span>
            </li>
          </ul>
        </div>
      </div>
    `;
    lucide.createIcons();
    loadLiveVerificationActivity();
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

// --- LIVE VERIFICATION ACTIVITY FEED ---
function _getScanStatusClass(outcome) {
  if (!outcome) return 'expired';
  const s = outcome.toUpperCase();
  if (s === 'VERIFIED') return 'verified';
  if (s === 'REVOKED' || s === 'INVALID') return 'revoked';
  if (s === 'SUSPENDED') return 'suspended';
  return 'expired';
}

function _esc(str) {
  if (!str) return '';
  return String(str).replace(/[&<>'"]/g, t => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[t] || t));
}

async function loadLiveVerificationActivity() {
  const feed = document.getElementById('liveScanFeed');
  if (!feed) return;
  try {
    // Reuse already-fetched stats if available, otherwise fetch history
    let events = [];
    if (state.stats && state.stats.recentVerifications && state.stats.recentVerifications.length) {
      events = state.stats.recentVerifications;
    } else {
      const res = await api('/api/history?limit=5');
      events = Array.isArray(res) ? res : (res && res.data ? res.data : []);
    }
    if (!events.length) {
      feed.innerHTML = `<li class="activity-item"><span class="activity-meta">No scans recorded in system yet.</span></li>`;
      return;
    }
    feed.innerHTML = events.slice(0, 5).map(v => {
      const name = v.person_name || v.full_name || 'Unrecognized Credential';
      const idNum = v.id_number || '';
      const outcome = v.outcome || v.status || 'UNKNOWN';
      const ts = v.created_at || v.timestamp;
      const timeStr = ts ? formatRelativeTime(ts) : '--';
      const cls = _getScanStatusClass(outcome);
      return `
        <li class="activity-item">
          <div class="activity-details">
            <span class="activity-name">${_esc(name)}</span>
            <span class="activity-meta">${idNum ? _esc(idNum) + ' &bull; ' : ''}${timeStr}</span>
          </div>
          <span class="status-badge ${cls}">${_esc(outcome)}</span>
        </li>`;
    }).join('');
  } catch (err) {
    if (feed) feed.innerHTML = `<li class="activity-item"><span class="activity-meta" style="color:#e11d48;">Failed to load live activity.</span></li>`;
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
      <span id="cam-status" style="font-family: var(--font-mono); font-size: 11px; font-weight: 700; letter-spacing: 0.6px; padding: 3px 10px; border-radius: 3px; background: #1e293b; color: #94a3b8; text-transform: uppercase; flex-shrink: 0;">STANDBY</span>
    </div>

    <div class="scanner-container">
      <div class="card" style="padding: 24px;">
        <div id="cameraInstructions" style="font-size: 13px; color: var(--text-muted); margin-bottom: 16px;">
          Point your rear camera at the QR code on the ID badge.
          On <strong>iPhone / Safari</strong>, use the <strong>Photo Scan</strong> button below if live camera doesn't start.
        </div>

        <div id="qrReader" style="margin: 0 auto; min-height: 280px; display: flex; align-items: center; justify-content: center; background: #000000; color: #ffffff;">
          <button class="btn btn-accent" id="startScanBtn">
            <i data-lucide="camera"></i> Open Camera Scanner
          </button>
        </div>

        <div style="margin-top: 16px; display: flex; gap: 8px; justify-content: center; flex-wrap: wrap; align-items: center;">
          <button class="btn btn-secondary btn-sm" id="stopScanBtn" style="display: none;">
            <i data-lucide="camera-off"></i> Stop Camera
          </button>

          <!-- iOS / Safari fallback: file input opens native camera, scanFile() decodes the photo -->
          <label id="photoScanLabel" class="btn btn-secondary btn-sm" style="cursor: pointer; display: inline-flex; align-items: center; gap: 6px;" title="Take a photo of the QR code (best for iPhone / Safari)">
            <i data-lucide="image"></i> Photo Scan (iOS)
            <input type="file" id="qrPhotoInput" accept="image/*" capture="environment" style="display: none;" />
          </label>
        </div>

        <!-- Live status message -->
        <p id="scanner-msg" style="margin-top: 14px; font-family: var(--font-mono); font-size: 11.5px; color: var(--text-muted); text-align: center; min-height: 18px;">Ready. Grant camera permission then tap Open Camera Scanner.</p>

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

  startBtn.addEventListener('click', () => startCameraScanner());
  stopBtn.addEventListener('click',  () => stopCameraScanner());

  manualBtn.addEventListener('click', () => {
    const val = document.getElementById('manualTokenInput').value.trim();
    if (val) {
      const token = val.includes('/verify/') ? val.split('/verify/')[1].split('/')[0]
                  : val.includes('/p/')      ? val.split('/p/')[1].split('/')[0]
                  : val;
      verifyToken(token);
    }
  });

  // ─── iOS / Safari Photo Scan fallback ───
  const photoInput = document.getElementById('qrPhotoInput');
  photoInput.addEventListener('change', async (e) => {
    if (!e.target.files || !e.target.files.length) return;
    const file = e.target.files[0];
    const resultArea = document.getElementById('verificationResultArea');
    if (resultArea) {
      resultArea.innerHTML = `<div class="card" style="padding: 20px; text-align: center; color: var(--text-muted); font-size: 13px;">Scanning photo for QR code...</div>`;
    }
    setScannerStatus('DECODING', 'Decoding image — please wait...');
    try {
      const tempReader = new Html5Qrcode('qrReader');
      const decodedText = await tempReader.scanFile(file, false);
      const token = decodedText.includes('/verify/') ? decodedText.split('/verify/')[1].split('?')[0].split('#')[0]
                  : decodedText.includes('/p/')      ? decodedText.split('/p/')[1].split('?')[0].split('#')[0]
                  : decodedText;
      setScannerStatus('LIVE', 'QR code decoded — verifying credential...');
      verifyToken(token);
    } catch (err) {
      setScannerStatus('FAILED', 'No QR code found. Ensure the image is clear and try again.');
      const ra = document.getElementById('verificationResultArea');
      if (ra) {
        ra.innerHTML = `
          <div class="card" style="padding: 20px; border-left: 4px solid #e11d48;">
            <div style="font-weight: 700; color: #e11d48; font-size: 13px; margin-bottom: 4px;">No QR Code Detected in Photo</div>
            <div style="color: var(--text-muted); font-size: 12px;">Make sure the QR code is clearly visible and well-lit. Try again or paste the token manually.</div>
          </div>`;
      }
    }
    photoInput.value = '';
  });
}

// ─── Scanner status helper ───
function setScannerStatus(status, msg) {
  const badge = document.getElementById('cam-status');
  const msgEl = document.getElementById('scanner-msg');
  const styles = {
    STANDBY:      { bg: '#1e293b', color: '#94a3b8' },
    INITIALIZING: { bg: '#1e3a8a', color: '#93c5fd' },
    LIVE:         { bg: '#065f46', color: '#6ee7b7' },
    DECODING:     { bg: '#713f12', color: '#fde68a' },
    STOPPED:      { bg: '#1e293b', color: '#94a3b8' },
    FAILED:       { bg: '#7f1d1d', color: '#fca5a5' },
  };
  if (badge) {
    const s = styles[status] || styles.STANDBY;
    badge.textContent = status;
    badge.style.background = s.bg;
    badge.style.color = s.color;
  }
  if (msgEl && msg) msgEl.textContent = msg;
}

async function startCameraScanner() {
  const readerDiv = document.getElementById('qrReader');
  const startBtn  = document.getElementById('startScanBtn');
  const stopBtn   = document.getElementById('stopScanBtn');

  setScannerStatus('INITIALIZING', 'Requesting camera access...');

  // Ensure any previous stream is fully dead before starting (fixes Safari NotReadableError)
  await stopCameraScanner(true /* silent */);

  if (startBtn) startBtn.style.display = 'none';
  if (stopBtn)  stopBtn.style.display  = 'inline-flex';

  const config = {
    fps: 10,
    qrbox: { width: 220, height: 220 },
    // iOS Safari needs videoConstraints to be minimal — no exact constraints
    videoConstraints: {
      facingMode: { ideal: 'environment' }
    }
  };

  const onSuccess = (decodedText) => {
    stopCameraScanner();
    let token = decodedText;
    if (decodedText.includes('/verify/')) {
      token = decodedText.split('/verify/')[1].split('?')[0].split('#')[0];
    } else if (decodedText.includes('/p/')) {
      token = decodedText.split('/p/')[1].split('?')[0].split('#')[0];
    }
    verifyToken(token);
  };

  const onError = () => { /* frame-level errors are normal — keep scanning */ };

  // ─── Strategy 1: getCameras() + explicit deviceId (most reliable on iOS Safari) ───
  try {
    const devices = await Html5Qrcode.getCameras();
    if (devices && devices.length) {
      // Pick rear camera: prefer label containing 'back'/'rear', else last device (iOS convention)
      let cameraId = devices[devices.length - 1].id; // iOS puts rear last
      for (const d of devices) {
        const label = (d.label || '').toLowerCase();
        if (label.includes('back') || label.includes('rear') || label.includes('environment')) {
          cameraId = d.id;
          break;
        }
      }
      state.html5QrCode = new Html5Qrcode('qrReader');
      await state.html5QrCode.start(cameraId, config, onSuccess, onError);
      setScannerStatus('LIVE', 'Camera active — align the QR code inside the viewfinder.');
      return; // success — done
    }
  } catch (e1) {
    console.warn('getCameras strategy failed, trying facingMode fallback:', e1);
  }

  // ─── Strategy 2: facingMode ideal (non-exact — Safari tolerates this) ───
  try {
    state.html5QrCode = new Html5Qrcode('qrReader');
    await state.html5QrCode.start({ facingMode: { ideal: 'environment' } }, config, onSuccess, onError);
    setScannerStatus('LIVE', 'Camera active — align the QR code inside the viewfinder.');
    return;
  } catch (e2) {
    console.warn('facingMode ideal failed, trying user-facing camera:', e2);
  }

  // ─── Strategy 3: Front camera last resort ───
  try {
    state.html5QrCode = new Html5Qrcode('qrReader');
    await state.html5QrCode.start({ facingMode: 'user' }, config, onSuccess, onError);
    setScannerStatus('LIVE', 'Front camera active — rear unavailable on this device.');
    return;
  } catch (e3) {
    setScannerStatus('FAILED', e3.message || 'Camera denied. Use Photo Scan or paste token below.');
    console.error('All camera strategies failed:', e3);
    if (readerDiv) {
      readerDiv.innerHTML = `
        <div style="padding: 24px; color: #fee2e2; text-align: center;">
          <div style="font-weight: 700; font-size: 14px; margin-bottom: 8px;">Camera Access Unavailable</div>
          <div style="font-size: 12px; opacity: 0.85; margin-bottom: 12px;">${e3.message || 'Permission denied or no camera device found.'}</div>
          <div style="font-size: 12px; color: #fcd34d;">👆 Use the <strong>Photo Scan (iOS)</strong> button above, or paste your token below.</div>
        </div>`;
    }
    if (stopBtn) stopBtn.style.display = 'none';
    if (startBtn) startBtn.style.display = 'inline-flex';
  }
}

async function stopCameraScanner() {
  if (!state.html5QrCode) return;
  try {
    if (state.html5QrCode.isScanning) {
      await state.html5QrCode.stop();
    }
    state.html5QrCode.clear();
  } catch (e) {
    // Silently ignore — scanner may already be stopped
  } finally {
    state.html5QrCode = null;
    const startBtn = document.getElementById('startScanBtn');
    const stopBtn  = document.getElementById('stopScanBtn');
    if (startBtn) startBtn.style.display = 'inline-flex';
    if (stopBtn)  stopBtn.style.display  = 'none';
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
    await renderVerificationProfileCard(resultArea, data);
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

async function renderVerificationProfileCard(container, data) {
  const outcomeClass = data.outcome; // 'verified', 'revoked', 'expired', 'suspended', 'invalid'
  const isVerified = data.outcome === 'verified';
  const identityId = data.identity?.id || data.identity?.identityId;

  // Check for active attendance session
  let activeSession = null;
  try {
    const sRes = await fetch('/api/attendance/sessions/active', { headers: getAuthHeaders() });
    if (sRes.ok) activeSession = await sRes.json();
  } catch (e) {}

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

        <!-- Active Roll-Call Attendance Box -->
        ${activeSession ? `
          <div style="margin-top: 14px; margin-bottom: 14px; padding: 14px 16px; background: #0f172a; border-radius: 8px; border: 1px solid #1e293b; color: #ffffff;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
              <div style="font-size: 11px; font-weight: 800; color: #10b981; letter-spacing: 1px; display: flex; align-items: center; gap: 6px;">
                <span style="display: inline-block; width: 7px; height: 7px; border-radius: 50%; background: #10b981; box-shadow: 0 0 8px #10b981;"></span>
                ACTIVE LIST: <span style="color: #ffffff;">${escapeHtml(activeSession.event_name)}</span>
              </div>
              <span style="font-size: 10.5px; color: #94a3b8; font-family: monospace;">INSTANT CHECK-IN</span>
            </div>
            <button id="btnCheckIn_${identityId}" onclick="logAttendance('${identityId}', '${escapeHtml(activeSession.event_name)}')" class="btn btn-primary" style="width: 100%; background: #10b981; border-color: #10b981; color: #ffffff; padding: 11px; font-size: 13.5px; font-weight: 700; border-radius: 6px; cursor: pointer; box-shadow: 0 4px 12px rgba(16, 185, 129, 0.35);">
              ✓ Mark as Present (${escapeHtml(activeSession.event_name)})
            </button>
            <div id="attendanceMsg" style="font-size: 12px; margin-top: 8px; display: none; font-weight: 600; text-align: center;"></div>
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
      <button class="btn btn-secondary btn-sm" onclick="navigateToPrintCard(${p.id})">
        <i data-lucide="printer" style="width: 13px; height: 13px;"></i> Print Badge
      </button>
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

function navigateToPrintCard(personId) {
  state.selectedPersonForPrint = personId;
  closeIdentityModal();
  navigate('cards');
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

// --- REUSABLE CR80 PHYSICAL & DIGITAL ID CARD GENERATOR ---
function renderCR80CardHtml(p, currentCard, orgName = 'Grace Chapel International') {
  const token = currentCard.verification_token || currentCard.verificationToken;
  const qrUrl = token 
    ? `/api/cards/token/${token}/qr` 
    : (currentCard.id ? `/api/cards/${currentCard.id}/qr` : '/api/cards/1/qr');

  const issueDateStr = currentCard.issue_date || currentCard.issueDate;
  const expiryDateStr = currentCard.expiry_date || currentCard.expiryDate;
  const statusStr = (currentCard.status || 'ACTIVE').toUpperCase();
  const photoUrl = p.photo_url || p.photoUrl || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=200&q=80';
  const permanentId = p.id_number || p.permanentId || p.idNumber || 'GCI-2026-000';
  const cardNumber = currentCard.card_number || currentCard.number || `CRD-${permanentId}-01`;
  const fullName = p.full_name || p.fullName || p.name || 'Registered Member';
  const rank = p.position || 'Registered Marshal / Member';
  const dept = p.department || 'Operations Command';
  const branch = p.branch || 'Main Sanctuary';

  return `
    <div class="cr80-card-wrapper" id="badgeContainer">
      <!-- FRONT OF CARD -->
      <div>
        <div class="cr80-card-label">Front Layout &bull; CR80 Standard (85.6 &times; 53.98mm)</div>
        <div class="cr80-card">
          <div class="cr80-hologram"></div>
          <div class="cr80-header">
            <div class="cr80-header-left">
              <div class="cr80-org-name">${orgName}</div>
              <div class="cr80-org-sub">Institutional Credential &bull; Official ID</div>
            </div>
            <div class="cr80-header-crest">GCI</div>
          </div>
          <div class="cr80-body">
            <img class="cr80-photo" src="${photoUrl}" alt="${fullName}" onerror="this.src='https://ui-avatars.com/api/?name=${encodeURIComponent(fullName)}&background=090d16&color=d4af37&bold=true'" />
            <div class="cr80-info">
              <div class="cr80-name">${p.title ? p.title + ' ' : ''}${fullName}</div>
              <div class="cr80-rank">${rank}</div>
              <div class="cr80-dept">${dept} &bull; ${branch}</div>
              <div class="cr80-id-badge">${permanentId}</div>
              <div class="cr80-valid-strip">
                <div class="cr80-valid-item">
                  <span class="cr80-valid-label">Issued</span>
                  <span class="cr80-valid-value">${issueDateStr ? String(issueDateStr).split('T')[0] : '2026-01-01'}</span>
                </div>
                <div class="cr80-valid-item">
                  <span class="cr80-valid-label">Expires</span>
                  <span class="cr80-valid-value">${expiryDateStr ? String(expiryDateStr).split('T')[0] : 'Indefinite'}</span>
                </div>
              </div>
            </div>
          </div>
          <div class="cr80-footer">
            <span class="cr80-footer-text">CARD: ${cardNumber}</span>
            <span class="cr80-status-pill ${statusStr.toLowerCase()}">${statusStr}</span>
          </div>
        </div>
      </div>

      <!-- BACK OF CARD -->
      <div>
        <div class="cr80-card-label">Back Layout &bull; Security &amp; Verification</div>
        <div class="cr80-card">
          <div class="cr80-magstripe"></div>
          <div class="cr80-back-header">
            <span style="font-size: 8.5px; font-weight: 700; letter-spacing: 0.5px;">SECURITY VERIFICATION</span>
            <span style="font-size: 7.5px; color: #d4af37; font-family: var(--font-data);">SEC-ID-${String(cardNumber).slice(-6)}</span>
          </div>
          <div class="cr80-back-body">
            <div class="cr80-qr-block">
              <div class="cr80-qr-wrapper">
                <img class="cr80-qr-image" src="${qrUrl}" alt="Verification QR" />
              </div>
              <span class="cr80-qr-label">SCAN TO VERIFY</span>
            </div>
            <div class="cr80-back-info">
              <div class="cr80-back-instruction">
                Scan with any smartphone camera to verify live credential authenticity against official records.
              </div>
              <div class="cr80-security-text">
                Property of ${orgName}. Found cards must be returned to Security or Admin Office immediately. Tampering is strictly prohibited.
              </div>
            </div>
          </div>
          <div class="cr80-footer">
            <span class="cr80-footer-text">STATUS: ${statusStr}</span>
            <span class="cr80-footer-text">&bull; AUTHORIZED CREDENTIAL</span>
          </div>
        </div>
      </div>
    </div>
  `;
}

// Render Success Screen for Auto-Approved Registration
function renderRegistrationSuccess(container, result, isPublic = false) {
  const p = result.identity;
  const card = result.card;
  const orgName = (state.org && state.org.name) || 'Grace Chapel International';
  const cardHtml = renderCR80CardHtml(p, card, orgName);

  // Load into hidden print area for 1-click printing
  const printArea = document.getElementById('printCardArea');
  if (printArea) {
    printArea.innerHTML = cardHtml;
  }

  container.innerHTML = `
    <div style="max-width: 860px; margin: 0 auto; padding: 24px 16px;">
      <div class="card" style="padding: 32px; border-radius: 12px; box-shadow: 0 10px 30px rgba(0,0,0,0.06); text-align: center;">
        
        <!-- Animated Success Badge -->
        <div style="width: 64px; height: 64px; background: #ecfdf5; border: 2px solid #a7f3d0; border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 16px; color: #059669; font-size: 32px; font-weight: 800;">
          &#10003;
        </div>

        <h2 style="font-size: 24px; font-weight: 800; color: #0f172a; margin-bottom: 6px;">
          Registration Complete &bull; Auto-Approved
        </h2>
        <p style="font-size: 13.5px; color: #64748b; max-width: 520px; margin: 0 auto 24px;">
          Welcome, <strong>${p.fullName || p.name}</strong>! Your permanent GCI institutional identity has been generated and your active digital credential is ready.
        </p>

        <!-- Permanent ID Callout Banner -->
        <div style="background: linear-gradient(135deg, #090d16 0%, #1e293b 100%); border-radius: 8px; padding: 18px 24px; max-width: 480px; margin: 0 auto 28px; color: #ffffff; border: 1px solid #334155;">
          <div style="font-size: 11px; text-transform: uppercase; letter-spacing: 1px; color: #94a3b8; margin-bottom: 4px;">
            Permanent Institutional ID
          </div>
          <div style="font-family: var(--font-data); font-size: 26px; font-weight: 800; color: #d4af37; letter-spacing: 1px;">
            ${p.permanentId}
          </div>
          <div style="font-size: 11.5px; color: #a7f3d0; margin-top: 4px; display: flex; align-items: center; justify-content: center; gap: 6px;">
            <span style="display: inline-block; width: 7px; height: 7px; background: #10b981; border-radius: 50%;"></span>
            Status: ACTIVE &bull; Card No: ${card.number || card.card_number}
          </div>
        </div>

        <!-- Render CR80 Badge (Front and Back) -->
        <div style="margin: 24px 0;">
          <div style="font-size: 13px; font-weight: 700; color: #1e3a8a; margin-bottom: 12px; text-transform: uppercase; letter-spacing: 0.5px;">
            Official CR80 Identity Card Preview
          </div>
          ${cardHtml}
        </div>

        <!-- Primary Action CTAs -->
        <div style="display: flex; gap: 12px; justify-content: center; flex-wrap: wrap; margin-top: 28px;">
          <a href="/verify/${card.verificationToken}" target="_blank" class="btn btn-primary" style="display: inline-flex; align-items: center; gap: 8px; text-decoration: none; padding: 11px 20px; font-weight: 600;">
            <i data-lucide="external-link" style="width: 16px; height: 16px;"></i> View Live Digital ID
          </a>

          <button type="button" class="btn btn-accent" onclick="printCard()" style="display: inline-flex; align-items: center; gap: 8px; padding: 11px 20px; font-weight: 600;">
            <i data-lucide="printer" style="width: 16px; height: 16px;"></i> Print Physical Badge (CR80)
          </button>

          ${isPublic ? `
            <button type="button" class="btn btn-secondary" onclick="loadPublicRegisterView(document.getElementById('appRoot'))" style="padding: 11px 18px;">
              Register Another Member
            </button>
            <button type="button" class="btn btn-secondary" onclick="navigate('dashboard')" style="padding: 11px 18px;">
              Admin Login
            </button>
          ` : `
            <button type="button" class="btn btn-secondary" onclick="navigate('directory')" style="padding: 11px 18px;">
              Back to Directory
            </button>
            <button type="button" class="btn btn-secondary" onclick="navigate('register')" style="padding: 11px 18px;">
              Register Another Person
            </button>
          `}
        </div>

      </div>
    </div>
  `;
  lucide.createIcons();
}

// Public Member Self-Registration Portal (No login required)
function loadPublicRegisterView(container) {
  container.innerHTML = `
    <div style="min-height: 100vh; background: #090d16; padding: 32px 16px;">
      <div style="max-width: 820px; margin: 0 auto;">
        
        <!-- Branded Header -->
        <div class="portal-header" style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 24px; padding-bottom: 16px; border-bottom: 1px solid #1e293b;">
          <div style="display: flex; align-items: center; gap: 14px;">
            <div class="header-brand-icon" style="width: 44px; height: 44px; background: linear-gradient(135deg, #1e3a8a 0%, #2563eb 100%); border-radius: 10px; display: flex; align-items: center; justify-content: center; color: #ffffff; font-weight: 800; font-size: 17px; box-shadow: 0 4px 12px rgba(37,99,235,0.3); flex-shrink: 0;">
              GCI
            </div>
            <div>
              <h1 style="font-size: 19px; font-weight: 800; color: #f8fafc; letter-spacing: -0.01em; margin: 0;">
                Grace Chapel International &bull; Digital ID Portal
              </h1>
              <p style="font-size: 12px; color: #94a3b8; margin: 3px 0 0;">
                Official Institutional Personnel &amp; Traffic Marshal Self-Registration
              </p>
            </div>
          </div>

          <button type="button" class="btn btn-secondary btn-sm" onclick="state.currentRoute='login'; render();" style="font-size: 11.5px; padding: 8px 14px; white-space: nowrap;">
            Staff Sign In &rarr;
          </button>
        </div>

        <div class="card" style="padding: 28px; border-radius: 12px; background: #ffffff;">
          <div style="margin-bottom: 20px;">
            <h2 style="font-size: 19px; font-weight: 800; color: #0f172a; margin-bottom: 4px;">
              Member / Marshal Registration Form
            </h2>
            <p style="font-size: 13px; color: #64748b; line-height: 1.5;">
              Fill in your verified details below. Upon submission, your Permanent ID and instant QR verification badge will be generated automatically.
            </p>
          </div>

          <div id="publicRegAlert" style="display: none; padding: 12px; border-radius: 6px; font-size: 12.5px; margin-bottom: 18px;"></div>

          <form id="publicRegisterForm">
            <div class="reg-form-grid">
              <!-- Name Section -->
              <div class="reg-input-group title-group">
                <label>Honorific</label>
                <select id="pubTitle" name="title">
                  <option value="Bro" selected>Bro</option>
                  <option value="Sis">Sis</option>
                  <option value="Pastor">Pastor</option>
                  <option value="Elder">Elder</option>
                  <option value="Deacon">Deacon</option>
                  <option value="Mr">Mr</option>
                  <option value="Mrs">Mrs</option>
                  <option value="Dr">Dr</option>
                </select>
              </div>

              <div class="reg-input-group">
                <label>First Name *</label>
                <input type="text" id="pubFirstName" name="first_name" required placeholder="e.g. David" />
              </div>

              <div class="reg-input-group">
                <label>Last Name *</label>
                <input type="text" id="pubLastName" name="last_name" required placeholder="e.g. Oyedele" />
              </div>

              <!-- Organization Section -->
              <div class="reg-input-group">
                <label>Branch / Assembly *</label>
                <select id="pubBranch" name="branch" required>
                  <option value="Main Sanctuary" selected>Main Sanctuary</option>
                  <option value="Lagos Command">Lagos Command</option>
                  <option value="Abuja Command">Abuja Command</option>
                  <option value="Headquarters Command">Headquarters Command</option>
                </select>
              </div>

              <div class="reg-input-group">
                <label>Department / Unit *</label>
                <select id="pubDepartment" name="department" required>
                  <option value="Traffic Operations" selected>Traffic Operations</option>
                  <option value="Traffic Safety">Traffic Safety</option>
                  <option value="Administration">Administration</option>
                  <option value="Protocol & Security">Protocol & Security</option>
                </select>
              </div>

              <div class="reg-input-group">
                <label>Designation / Role</label>
                <input type="text" id="pubPosition" name="position" value="Traffic Marshal" placeholder="e.g. Traffic Marshal" />
              </div>

              <!-- Contact Section -->
              <div class="reg-input-group full-width">
                <label>Email Address *</label>
                <input type="email" id="pubEmail" name="email" required placeholder="your.name@example.com" />
              </div>

              <div class="reg-input-group full-width">
                <label>Phone Number *</label>
                <input type="tel" id="pubPhone" name="phone" required placeholder="+234 800 000 0000" />
              </div>

              <div class="reg-input-group">
                <label>Emergency Contact Name</label>
                <input type="text" id="pubEmergName" name="emergency_name" placeholder="Next of Kin / Spouse" />
              </div>

              <div class="reg-input-group">
                <label>Emergency Phone</label>
                <input type="tel" id="pubEmergPhone" name="emergency_phone" placeholder="+234..." />
              </div>
            </div>

            <!-- Profile Photograph Upload Section -->
            <div class="reg-photo-upload" style="margin-top: 24px; background: #f8fafc; padding: 20px; border-radius: 8px; border: 1.5px dashed #cbd5e1; text-align: center;">
              <label style="display: block; font-weight: 700; font-size: 12px; color: #1e3a8a; margin-bottom: 12px; text-transform: uppercase; letter-spacing: 0.5px;">
                Portrait Photograph for ID Card (Clear Face) *
              </label>
              <div style="display: flex; flex-direction: column; align-items: center; gap: 12px;">
                <img id="pubPhotoPreview" src="" style="width: 80px; height: 96px; border-radius: 6px; object-fit: cover; display: none; border: 2.5px solid #2563eb; box-shadow: 0 4px 10px rgba(0,0,0,0.1);" />
                <input type="file" id="pubPhotoFile" name="photo" accept="image/*" capture="user" required style="font-size: 13px; max-width: 320px; width: 100%;" />
                <p style="font-size: 11.5px; color: #64748b; margin: 0;">
                  Passport style portrait photo (JPG, PNG, WebP &bull; Max 10MB). Tap to take selfie or choose from photos.
                </p>
              </div>
            </div>

            <div style="margin-top: 24px;">
              <button type="submit" id="pubSubmitBtn" class="btn btn-primary" style="width: 100%; padding: 14px; font-size: 15px; font-weight: 700;">
                Submit Registration &amp; Generate Instant ID Card
              </button>
            </div>
          </form>
        </div>

      </div>
    </div>
  `;

  const photoInput = document.getElementById('pubPhotoFile');
  const previewImg = document.getElementById('pubPhotoPreview');
  const alertBox = document.getElementById('publicRegAlert');

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

  document.getElementById('publicRegisterForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('pubSubmitBtn');
    btn.disabled = true;
    btn.innerText = 'Auto-Approving & Generating Credential...';
    alertBox.style.display = 'none';

    const formData = new FormData();
    const firstName = document.getElementById('pubFirstName').value.trim();
    const lastName = document.getElementById('pubLastName').value.trim();

    formData.append('title', document.getElementById('pubTitle').value);
    formData.append('firstName', firstName);
    formData.append('lastName', lastName);
    formData.append('fullName', `${firstName} ${lastName}`);
    formData.append('branch', document.getElementById('pubBranch').value.trim());
    formData.append('department', document.getElementById('pubDepartment').value.trim());
    formData.append('position', document.getElementById('pubPosition').value.trim());
    formData.append('email', document.getElementById('pubEmail').value.trim());
    formData.append('phone', document.getElementById('pubPhone').value.trim());
    formData.append('emergencyContactName', document.getElementById('pubEmergName').value.trim());
    formData.append('emergencyContactPhone', document.getElementById('pubEmergPhone').value.trim());

    if (photoInput.files && photoInput.files[0]) {
      formData.append('photo', photoInput.files[0]);
    }

    try {
      const res = await fetch('/api/identities/register', {
        method: 'POST',
        body: formData
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to complete registration.');

      renderRegistrationSuccess(container, data, true);
    } catch (err) {
      alertBox.className = 'badge badge-revoked';
      alertBox.style.display = 'block';
      alertBox.innerText = 'Error: ' + err.message;
      btn.disabled = false;
      btn.innerText = 'Submit Registration & Generate Instant ID Card';
    }
  });
}

// --- 6. REGISTER PERSON VIEW (Staff Console) ---
function loadRegisterView(container) {
  container.innerHTML = `
    <div class="page-header">
      <div>
        <h1 class="page-title">Register Person & Issue ID Card</h1>
        <div class="page-description">Auto-approval workflow: creates permanent record and generates instant CR80 digital badge.</div>
      </div>
    </div>

    <div class="card" style="max-width: 780px;">
      <div id="adminRegAlert" style="display: none; padding: 12px; border-radius: 6px; font-size: 12.5px; margin-bottom: 18px;"></div>
      
      <form id="registerPersonForm">
        <div class="reg-form-grid">
          <div class="reg-input-group title-group">
            <label class="form-label">Title</label>
            <select id="regTitle" class="form-control">
              <option value="">None</option>
              <option value="Pastor">Pastor</option>
              <option value="Elder">Elder</option>
              <option value="Deacon">Deacon</option>
              <option value="Sis">Sis</option>
              <option value="Bro" selected>Bro</option>
              <option value="Mr">Mr</option>
              <option value="Mrs">Mrs</option>
              <option value="Dr">Dr</option>
            </select>
          </div>
          <div class="reg-input-group">
            <label class="form-label">First Name *</label>
            <input type="text" id="regFirstName" class="form-control" required placeholder="e.g. David" />
          </div>
          <div class="reg-input-group">
            <label class="form-label">Last Name *</label>
            <input type="text" id="regLastName" class="form-control" required placeholder="e.g. Oyedele" />
          </div>

          <div class="reg-input-group">
            <label class="form-label">Branch or Location *</label>
            <input type="text" id="regBranch" class="form-control" required placeholder="e.g. Main Sanctuary, Lekki Assembly, Ikeja" value="Main Sanctuary" />
          </div>
          <div class="reg-input-group">
            <label class="form-label">Department / Unit *</label>
            <input type="text" id="regDepartment" class="form-control" required placeholder="e.g. Traffic Operations Command, Protocol" value="Traffic Operations Command" />
          </div>
          <div class="reg-input-group">
            <label class="form-label">Position / Rank</label>
            <input type="text" id="regPosition" class="form-control" placeholder="e.g. Chief Traffic Marshal, Senior Officer" value="Traffic Marshal" />
          </div>

          <div class="reg-input-group full-width">
            <label class="form-label">Email Address</label>
            <input type="email" id="regEmail" class="form-control" placeholder="person@organisation.org" />
          </div>
          <div class="reg-input-group full-width">
            <label class="form-label">Phone Number</label>
            <input type="text" id="regPhone" class="form-control" placeholder="+234..." />
          </div>
          <div class="reg-input-group">
            <label class="form-label">Approval Policy</label>
            <select id="regApproval" class="form-control">
              <option value="approved" selected>Auto-Approved (Instant Active Card)</option>
              <option value="pending">Pending Audit Verification</option>
            </select>
          </div>

          <div class="reg-input-group">
            <label class="form-label">Emergency Contact Name</label>
            <input type="text" id="regEmergName" class="form-control" placeholder="Next of Kin / Contact" />
          </div>
          <div class="reg-input-group">
            <label class="form-label">Emergency Contact Phone</label>
            <input type="text" id="regEmergPhone" class="form-control" placeholder="+234..." />
          </div>
        </div>

        <!-- Photograph Upload -->
        <div style="margin-top: 16px; padding: 16px; background: #f8fafc; border: 1px solid var(--border-subtle); border-radius: 8px;">
          <label class="form-label">Upload Profile Photograph *</label>
          <div style="display: flex; gap: 16px; align-items: center;">
            <img id="photoPreviewImg" src="" style="width: 72px; height: 86px; border-radius: 4px; object-fit: cover; display: none; border: 2px solid var(--accent-blue);" />
            <div>
              <input type="file" id="regPhotoFile" accept="image/*" class="form-control" required />
              <div style="font-size: 11px; color: var(--text-muted); margin-top: 4px;">High-resolution portrait photo for CR80 card printing (JPG, PNG, WebP)</div>
            </div>
          </div>
        </div>

        <div style="margin-top: 20px; display: flex; justify-content: flex-end; gap: 10px;">
          <button type="button" class="btn btn-secondary" onclick="navigate('directory')">Cancel</button>
          <button type="submit" id="submitRegBtn" class="btn btn-primary">
            Register Identity &amp; Auto-Issue Card
          </button>
        </div>
      </form>
    </div>
  `;

  const photoInput = document.getElementById('regPhotoFile');
  const previewImg = document.getElementById('photoPreviewImg');
  const alertBox = document.getElementById('adminRegAlert');

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
    if (alertBox) alertBox.style.display = 'none';

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
    formData.append('email', document.getElementById('regEmail').value.trim());
    formData.append('phone', document.getElementById('regPhone').value.trim());
    formData.append('emergencyContactName', document.getElementById('regEmergName').value.trim());
    formData.append('emergencyContactPhone', document.getElementById('regEmergPhone').value.trim());

    if (photoInput.files && photoInput.files[0]) {
      formData.append('photo', photoInput.files[0]);
    }

    try {
      const res = await fetch('/api/identities/register', {
        method: 'POST',
        body: formData
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to register identity.');

      renderRegistrationSuccess(container, data, false);
    } catch (err) {
      if (alertBox) {
        alertBox.className = 'badge badge-revoked';
        alertBox.style.display = 'block';
        alertBox.innerText = 'Error: ' + err.message;
      } else {
        alert('Error: ' + err.message);
      }
      btn.disabled = false;
      btn.innerText = 'Register Identity & Auto-Issue Card';
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

    // Auto-select targeted person or first person if available
    const targetPersonId = state.selectedPersonForPrint || (data.identities.length > 0 ? data.identities[0].id : null);
    if (targetPersonId) {
      sel.value = targetPersonId;
      renderCardForPerson(targetPersonId);
      state.selectedPersonForPrint = null;
    }
  } catch (err) {
    console.error(err);
  }
}

async function renderCardForPerson(personId) {
  const container = document.getElementById('cardPreviewContainer');
  if (!container) return;

  container.innerHTML = '<div style="padding: 40px; text-align: center; color: var(--text-muted); font-size: 13px;">Rendering high-security CR80 credential preview...</div>';

  try {
    const data = await api(`/api/identities/${personId}`);
    const p = data.identity;
    const currentCard = data.cards.find(c => c.is_current) || data.cards[0];

    if (!currentCard) {
      container.innerHTML = `<div class="card" style="padding: 20px; color: var(--status-revoked); text-align: center;">No active credential card issued for this person.</div>`;
      return;
    }

    const cardHtml = renderCR80CardHtml(p, currentCard, (state.org && state.org.name) || 'Grace Chapel International');
    container.innerHTML = cardHtml;

    // Prepare print area
    const printArea = document.getElementById('printCardArea');
    if (printArea) {
      printArea.innerHTML = cardHtml;
    }
  } catch (err) {
    container.innerHTML = `<div style="padding: 20px; color: var(--status-revoked); text-align: center;">Error: ${err.message}</div>`;
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

// --- 9. PUBLIC ENROLLMENT QR PORTAL ---
async function renderEnrollmentQRView(container) {
  container.innerHTML = `
    <div class="page-header">
      <div>
        <h1 class="page-title">Public Enrollment & Registration QR</h1>
        <div class="page-description">
          Generate, preview, and download the official registration QR code for banners, flyers, projector screens, and member WhatsApp groups.
        </div>
      </div>
      <div>
        <button class="btn btn-primary btn-sm" onclick="printEnrollmentFlyer()">
          <i data-lucide="printer" style="width: 14px; height: 14px;"></i> Print Enrollment Flyer
        </button>
      </div>
    </div>

    <div style="display: grid; grid-template-columns: minmax(320px, 460px) 1fr; gap: 24px; align-items: start;">
      <!-- QR Preview Card -->
      <div class="card" style="padding: 28px; text-align: center;">
        <div id="enrollmentQrLoading" style="font-family: var(--font-data); color: var(--text-muted); padding: 40px 0;">
          <div style="margin: 0 auto 12px; width: 28px; height: 28px; border: 3px solid #e2e8f0; border-top-color: #2563eb; border-radius: 50%; animation: spin 0.8s linear infinite;"></div>
          Generating ultra high-resolution registration QR code...
        </div>

        <div id="enrollmentQrContainer" style="display: none;">
          <div style="background: #ffffff; padding: 18px; border: 1.5px solid var(--border-color); border-radius: 12px; display: inline-block; margin-bottom: 20px; box-shadow: 0 4px 15px rgba(0,0,0,0.06);">
            <img id="registrationQRImg" src="" alt="Public Registration QR" style="width: 250px; height: 250px; display: block; border-radius: 4px;" />
            <div style="margin-top: 10px; font-size: 11px; font-weight: 800; color: #1e3a8a; letter-spacing: 0.8px; text-transform: uppercase;">
              SCAN TO SELF-REGISTER
            </div>
          </div>

          <div style="background: #f8fafc; border: 1px solid var(--border-color); padding: 12px 14px; border-radius: 6px; margin-bottom: 20px; text-align: left;">
            <div style="font-size: 10.5px; font-weight: 700; color: var(--text-muted); text-transform: uppercase; margin-bottom: 4px;">
              Direct Enrollment Link
            </div>
            <div style="font-family: var(--font-data); font-size: 12px; color: #0f172a; word-break: break-all;" id="registrationLinkDisplay"></div>
          </div>

          <div style="display: flex; gap: 10px; justify-content: center; flex-wrap: wrap;">
            <a id="downloadRegQRBtn" href="#" download="GCI_Registration_QR.png" class="btn btn-primary" style="text-decoration: none; display: inline-flex; align-items: center; gap: 6px;">
              <i data-lucide="download" style="width: 14px; height: 14px;"></i> Download 800px PNG
            </a>
            <button type="button" class="btn btn-secondary" onclick="copyEnrollmentLink()" style="display: inline-flex; align-items: center; gap: 6px;">
              <i data-lucide="copy" style="width: 14px; height: 14px;"></i> Copy Link
            </button>
            <a id="openRegFormBtn" href="#" target="_blank" class="btn btn-secondary" style="text-decoration: none; display: inline-flex; align-items: center; gap: 6px;">
              <i data-lucide="external-link" style="width: 14px; height: 14px;"></i> Open Form
            </a>
          </div>
        </div>
      </div>

      <!-- Architectural Decoupling Guide Card -->
      <div style="display: flex; flex-direction: column; gap: 16px;">
        <div class="card" style="padding: 24px;">
          <h3 style="font-size: 15px; font-weight: 700; color: #0f172a; margin-bottom: 12px; display: flex; align-items: center; gap: 8px;">
            <span style="color: #2563eb;">🛡️</span> Architectural Separation Guarantee
          </h3>
          <p style="font-size: 12.5px; color: #475569; line-height: 1.6; margin-bottom: 14px;">
            To ensure zero interference with ID verification scanners, the system strictly separates <strong>Member Self-Enrollment</strong> from <strong>Credential Inspection</strong>:
          </p>
          <div style="display: flex; flex-direction: column; gap: 12px;">
            <div style="background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 14px 16px;">
              <div style="font-size: 12px; font-weight: 700; color: #166534; margin-bottom: 3px; display: flex; align-items: center; gap: 6px;">
                <span>📢</span> Public Registration QR (Posters, Projectors & Flyers)
              </div>
              <div style="font-size: 11.5px; color: #15803d; line-height: 1.45;">
                Points strictly to <code style="background: rgba(22,101,52,0.12); padding: 1px 5px; border-radius: 3px; font-weight: 600;">/#register</code>. Invokes the instant auto-approval registration form, creates the permanent ID, and immediately generates their digital credential. Does not query the ID card table.
              </div>
            </div>

            <div style="background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 8px; padding: 14px 16px;">
              <div style="font-size: 12px; font-weight: 700; color: #1e40af; margin-bottom: 3px; display: flex; align-items: center; gap: 6px;">
                <span>💳</span> Verification QR (Printed on Card Back)
              </div>
              <div style="font-size: 11.5px; color: #1d4ed8; line-height: 1.45;">
                Points to cryptographic token route <code style="background: rgba(30,64,175,0.12); padding: 1px 5px; border-radius: 3px; font-weight: 600;">/verify/&lt;48-hex-token&gt;</code>. Performs read-only authentication against the database to confirm genuine or revoked credentials.
              </div>
            </div>
          </div>
        </div>

        <div class="card" style="padding: 20px;">
          <h4 style="font-size: 13px; font-weight: 700; color: #0f172a; margin-bottom: 8px;">
            Deployment Recommendations
          </h4>
          <ul style="font-size: 12px; color: #64748b; line-height: 1.6; padding-left: 18px;">
            <li><strong>Sanctuary Projector:</strong> Project this registration QR on auditorium screens before and after service.</li>
            <li><strong>Printed Posters:</strong> Place at registration tables, ushers' desks, and sanctuary entrance gates.</li>
            <li><strong>Marshal Briefing:</strong> Share the direct enrollment link in the departmental WhatsApp broadcast group.</li>
          </ul>
        </div>
      </div>
    </div>
  `;
  lucide.createIcons();

  try {
    const res = await api('/api/public/registration-qr');
    if (!res || !res.success) throw new Error(res?.error || 'Failed to generate QR.');

    document.getElementById('enrollmentQrLoading').style.display = 'none';
    document.getElementById('enrollmentQrContainer').style.display = 'block';

    const qrImg = document.getElementById('registrationQRImg');
    const dlBtn = document.getElementById('downloadRegQRBtn');
    const linkDisplay = document.getElementById('registrationLinkDisplay');
    const testBtn = document.getElementById('openRegFormBtn');

    qrImg.src = res.qrImage;
    dlBtn.href = res.qrImage;
    linkDisplay.textContent = res.url;
    testBtn.href = res.url;
    window._currentEnrollmentUrl = res.url;
    window._currentEnrollmentQr = res.qrImage;
    lucide.createIcons();
  } catch (err) {
    const loadEl = document.getElementById('enrollmentQrLoading');
    if (loadEl) {
      loadEl.style.color = 'var(--status-revoked-text)';
      loadEl.textContent = 'Error: ' + err.message;
    }
  }
}

function copyEnrollmentLink() {
  if (window._currentEnrollmentUrl) {
    navigator.clipboard.writeText(window._currentEnrollmentUrl);
    alert('Public Registration link copied to clipboard!\n' + window._currentEnrollmentUrl);
  }
}

function printEnrollmentFlyer() {
  const printArea = document.getElementById('printCardArea');
  if (!printArea) return;

  const orgName = (state.org && state.org.name) || 'Grace Chapel International';
  const url = window._currentEnrollmentUrl || `${window.location.origin}/#register`;
  const qrImage = window._currentEnrollmentQr || '/api/public/registration-qr/image';

  printArea.innerHTML = `
    <div style="width: 100%; max-width: 680px; margin: 40px auto; padding: 44px; border: 3px solid #090d16; border-radius: 16px; text-align: center; font-family: var(--font-ui); background: #ffffff;">
      <div style="font-size: 13px; font-weight: 800; letter-spacing: 2px; text-transform: uppercase; color: #d4af37; margin-bottom: 8px;">
        OFFICIAL REGISTRATION PORTAL
      </div>
      <h1 style="font-size: 28px; font-weight: 800; color: #090d16; margin-bottom: 8px; font-family: var(--font-display);">
        ${orgName}
      </h1>
      <p style="font-size: 15px; color: #475569; margin-bottom: 28px;">
        Traffic Marshals &bull; Directorate of Personnel &bull; Official Digital ID Enrollment
      </p>

      <div style="background: #ffffff; padding: 20px; border: 2px dashed #090d16; border-radius: 12px; display: inline-block; margin-bottom: 24px;">
        <img src="${qrImage}" alt="Registration QR" style="width: 280px; height: 280px; display: block;" />
      </div>

      <div style="font-size: 20px; font-weight: 800; color: #1e3a8a; margin-bottom: 8px;">
        SCAN WITH ANY SMARTPHONE CAMERA
      </div>
      <p style="font-size: 13px; color: #64748b; max-width: 480px; margin: 0 auto 20px; line-height: 1.5;">
        1. Open your phone camera &bull; 2. Point at QR code &bull; 3. Complete quick form &bull; 4. Receive instant permanent ID and printable badge.
      </p>

      <div style="font-family: var(--font-data); font-size: 13px; color: #090d16; font-weight: 700; background: #f1f5f9; padding: 10px 18px; border-radius: 6px; display: inline-block;">
        Direct URL: ${url}
      </div>
    </div>
  `;

  window.print();
}

// --- 10. PUBLIC SCAN VERIFICATION VIEW WITH TERMINAL OVERLAY ---
async function renderPublicVerifyView(container, explicitToken) {
  const token = explicitToken || state.verifyToken || window.__VERIFICATION_TOKEN__ || window.location.pathname.split('/').filter(Boolean).pop();
  state.verifyToken = token;

  // 1. Initial State: Stark Terminal Overlay + Profile Screen underneath
  container.innerHTML = `
    <!-- Verification Transition Overlay -->
    <div id="verification-overlay">
      <div class="overlay-content">
        <div class="overlay-radar"></div>
        <div class="overlay-status" id="overlayStatus">QUERYING IDENTITY DATABASE...</div>
        <div class="overlay-id" id="overlayIdText">GCI-••••-••••</div>
        <div class="overlay-outcome" id="overlayOutcome" style="display: none;"></div>
      </div>
    </div>

    <!-- Dark Command Centre Profile (Revealed smoothly underneath) -->
    <div class="public-profile-screen" id="publicProfileContainer" style="opacity: 0;"></div>
  `;

  const overlay = document.getElementById('verification-overlay');
  const overlayId = document.getElementById('overlayIdText');
  const overlayStatus = document.getElementById('overlayStatus');
  const overlayOutcome = document.getElementById('overlayOutcome');
  const profileContainer = document.getElementById('publicProfileContainer');

  if (!token) {
    if (overlayStatus) overlayStatus.textContent = 'ACCESS REJECTED';
    if (overlayId) overlayId.textContent = 'NO TOKEN PROVIDED';
    if (overlayOutcome) {
      overlayOutcome.style.display = 'inline-flex';
      overlayOutcome.className = 'overlay-outcome revoked';
      overlayOutcome.innerHTML = `<span style="font-size: 18px; margin-right: 4px;">&#10007;</span> INVALID VERIFICATION LINK`;
    }
    return;
  }

  try {
    // 2. Fetch live cryptographic verification from relative Vercel Serverless Function route
    const authHeader = localStorage.getItem('auth_token') ? { 'Authorization': `Bearer ${localStorage.getItem('auth_token')}` } : {};
    const res = await fetch(`/api/verify/${encodeURIComponent(token)}`, {
      headers: {
        'Accept': 'application/json',
        ...authHeader
      }
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      throw new Error(data.message || data.error || `Verification failed (HTTP ${res.status})`);
    }
    
    // Normalize outcome & payload across schema versions (data-mapping point 1 & 2)
    const outcome = (data.outcome || data.status || 'invalid').toLowerCase();
    const isVerified = outcome === 'verified';
    const p = data.identity || {};
    const permanentId = p.idNumber || p.id_number || p.identity_id || 'AUTHENTICATED';

    // 3. Inject Permanent ID into stark terminal screen
    overlayId.textContent = permanentId;
    overlayStatus.style.display = 'none';

    // 4. Show Outcome Badge (Verified, Revoked, or Suspended)
    overlayOutcome.style.display = 'inline-flex';
    if (isVerified) {
      overlayOutcome.className = 'overlay-outcome verified';
      overlayOutcome.innerHTML = `<span style="font-size: 18px; margin-right: 4px;">&#10003;</span> VERIFIED ACTIVE`;
    } else if (outcome === 'revoked') {
      overlayOutcome.className = 'overlay-outcome revoked';
      overlayOutcome.innerHTML = `<span style="font-size: 18px; margin-right: 4px;">&#10007;</span> CREDENTIAL REVOKED`;
      overlayId.style.color = '#ef4444';
    } else {
      overlayOutcome.className = 'overlay-outcome suspended';
      overlayOutcome.innerHTML = `<span style="font-size: 18px; margin-right: 4px;">&#9888;</span> ${outcome.toUpperCase()}`;
      overlayId.style.color = '#f59e0b';
    }

    // 5. Render the dark Command Centre profile underneath
    await renderProfilePage(profileContainer, data);

    // 6. Hold for 1.5 seconds so security officers can inspect the ID
    setTimeout(() => {
      overlay.classList.add('fade-out');
      profileContainer.style.opacity = '1';
      profileContainer.style.transition = 'opacity 0.6s cubic-bezier(0.16, 1, 0.3, 1)';
      setTimeout(() => { 
        if (overlay) overlay.style.display = 'none'; 
      }, 600);
    }, 1500);

  } catch (err) {
    // Error / Invalid Token Terminal Fallback (Maintains terminal UI without redirecting to login)
    if (overlayStatus) {
      overlayStatus.textContent = 'ACCESS REJECTED';
      overlayStatus.style.color = '#ef4444';
    }
    if (overlayId) {
      overlayId.textContent = 'ACCESS DENIED';
      overlayId.style.color = '#ef4444';
    }
    if (overlayOutcome) {
      overlayOutcome.style.display = 'inline-flex';
      overlayOutcome.className = 'overlay-outcome revoked';
      overlayOutcome.innerHTML = `<span style="font-size: 18px; margin-right: 4px;">&#10007;</span> ${err.message || 'INVALID CREDENTIAL'}`;
    }
  }
}

async function renderProfilePage(container, data) {
  const p = data.identity || {};
  const c = data.card || {};
  const outcome = (data.outcome || data.status || 'invalid').toLowerCase();
  const isVerified = outcome === 'verified';
  const badgeClass = isVerified ? 'verified' : (outcome === 'revoked' ? 'revoked' : 'suspended');

  const idNumber = p.idNumber || p.id_number || '—';
  const fullName = p.fullName || p.full_name || 'Registered Personnel';
  const photoUrl = p.photoUrl || p.photo_url || '';
  const position = p.position || 'Staff Marshal';
  const department = p.department || 'Operations Directorate';
  const branch = p.branch || 'Main Sanctuary';
  const cardNumber = c.cardNumber || c.card_number || '—';
  const cardStatus = (c.status || outcome).toUpperCase();
  const issueDate = c.issueDate || c.issue_date;
  const expiryDate = c.expiryDate || c.expiry_date;
  const phone = p.phone || '';
  const emergencyPhone = p.emergencyContactPhone || p.emergency_contact_phone || '';
  const emergencyName = p.emergencyContactName || p.emergency_contact_name || 'Command';

  const currentUser = state.user || data.viewer?.isAuthenticated || (localStorage.getItem('auth_token') ? true : false);
  const identityDbId = p.identityId || p.id || (data.identity ? (data.identity.identityId || data.identity.id) : '');

  // Check if an active attendance session is running
  let activeSession = null;
  try {
    const sRes = await fetch('/api/attendance/sessions/active', { headers: getAuthHeaders() });
    if (sRes.ok) {
      activeSession = await sRes.json();
    }
  } catch (e) {
    // No active session
  }

  container.innerHTML = `
    <div class="command-profile-card">
      <!-- Institutional Top Header -->
      <div class="command-profile-header">
        <div style="display: flex; align-items: center; gap: 11px;">
          <div class="command-crest">GCI</div>
          <div>
            <div class="command-org-title">${data.organisation?.name || 'Grace Chapel International'}</div>
            <div class="command-org-sub">Institutional Identity Directorate</div>
          </div>
        </div>
        <div class="command-status-badge ${badgeClass}">
          ${outcome.toUpperCase()}
        </div>
      </div>

      <!-- Identity Dossier Body -->
      <div class="command-profile-body">
        <div class="command-avatar-strip">
          <img class="command-profile-photo" 
               src="${photoUrl || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=200&q=80'}" 
               alt="${fullName}" 
               onerror="this.src='https://ui-avatars.com/api/?name=${encodeURIComponent(fullName)}&background=090d16&color=d4af37&bold=true'" />
          <div style="min-width: 0; flex: 1;">
            <div class="command-profile-name">${p.title ? p.title + ' ' : ''}${fullName}</div>
            <div class="command-profile-rank">${position}</div>
            <div class="command-profile-dept">${department} &bull; ${branch}</div>
            <div class="command-id-tag">${idNumber}</div>
          </div>
        </div>

        <!-- Telemetry Matrix -->
        <div class="command-grid-matrix">
          <div class="matrix-cell">
            <span class="matrix-label">CARD NUMBER</span>
            <span class="matrix-value font-mono">${cardNumber}</span>
          </div>
          <div class="matrix-cell">
            <span class="matrix-label">RECORD STATUS</span>
            <span class="matrix-value ${badgeClass}">${cardStatus}</span>
          </div>
          <div class="matrix-cell">
            <span class="matrix-label">ISSUED DATE</span>
            <span class="matrix-value font-mono">${issueDate ? issueDate.split('T')[0] : '2026-01-01'}</span>
          </div>
          <div class="matrix-cell">
            <span class="matrix-label">EXPIRY DATE</span>
            <span class="matrix-value font-mono">${expiryDate ? expiryDate.split('T')[0] : 'INDEFINITE'}</span>
          </div>
        </div>

        ${phone || emergencyPhone ? `
          <div class="command-dispatch-box">
            <div class="dispatch-title">OPERATIONAL CONTACT &amp; DISPATCH</div>
            ${phone ? `<div class="dispatch-row"><span>Official Line:</span> <strong>${phone}</strong></div>` : ''}
            ${emergencyPhone ? `<div class="dispatch-row"><span>Emergency Line:</span> <strong>${emergencyName} (${emergencyPhone})</strong></div>` : ''}
          </div>
        ` : ''}
      </div>

      <!-- Security Audit Footer -->
      <div class="command-profile-footer">
        <span>SECURITY TOKEN VERIFIED LIVE</span>
        <span class="font-mono">${new Date(data.timestamp || Date.now()).toLocaleTimeString()} UTC</span>
      </div>
    </div>

    <!-- Attendance Quick Check-In (Visible to Authenticated Admins / Officers) -->
    ${currentUser ? `
      ${activeSession ? `
        <div style="margin-top: 16px; background: #0f172a; border: 1px solid #1e293b; padding: 18px 20px; border-radius: 10px; box-shadow: 0 10px 25px rgba(0,0,0,0.4); text-align: left;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
            <div style="font-size: 11px; font-weight: 800; color: #10b981; letter-spacing: 1px; display: flex; align-items: center; gap: 6px;">
              <span style="display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: #10b981; box-shadow: 0 0 8px #10b981;"></span>
              ACTIVE ROLL-CALL LIST
            </div>
            <span style="font-size: 10.5px; color: #94a3b8; font-family: monospace;">INSTANT SCAN RECORD</span>
          </div>
          <div style="font-size: 17px; font-weight: 800; color: #ffffff; margin-bottom: 14px; letter-spacing: -0.01em;">
            ${escapeHtml(activeSession.event_name)}
          </div>
          <button id="btnCheckIn_${identityDbId}" onclick="logAttendance('${identityDbId}', '${escapeHtml(activeSession.event_name)}')" class="btn btn-primary" style="width: 100%; background: #10b981; border-color: #10b981; color: #ffffff; padding: 12px; font-size: 14px; font-weight: 800; border-radius: 6px; cursor: pointer; box-shadow: 0 4px 14px rgba(16, 185, 129, 0.4);">
            ✓ Mark as Present (${escapeHtml(activeSession.event_name)})
          </button>
          <div id="attendanceMsg" style="font-size: 12px; margin-top: 10px; display: none; font-weight: 600; text-align: center;"></div>
        </div>
      ` : `
        <div style="margin-top: 16px; background: #f8fafc; border: 1px dashed #cbd5e1; padding: 14px 16px; border-radius: 8px;">
          <div style="font-size: 11.5px; font-weight: 700; color: #475569; margin-bottom: 8px;">
            No Active Roll-Call List &bull; Enter Event Name
          </div>
          <div style="display: flex; gap: 8px; flex-wrap: wrap;">
            <input type="text" id="manualEventName" placeholder="e.g. Sunday Service" style="flex: 1; min-width: 170px; padding: 9px 12px; border: 1px solid #cbd5e1; border-radius: 6px; font-size: 13px; color: #0f172a; outline: none; background: #ffffff;">
            <button onclick="logAttendance('${identityDbId}', document.getElementById('manualEventName').value)" class="btn btn-primary" style="background: #1e293b; color: #ffffff; padding: 9px 16px; font-size: 13px; font-weight: 700; border-radius: 6px; cursor: pointer;">
              Mark Present
            </button>
          </div>
          <div id="attendanceMsg" style="font-size: 12px; margin-top: 8px; display: none; font-weight: 600;"></div>
        </div>
      `}
    ` : ''}
  `;
}

// --- Attendance Actions ---
async function logAttendance(identityId, explicitEventName) {
  const msgEl = document.getElementById('attendanceMsg');
  const btn = document.getElementById(`btnCheckIn_${identityId}`) || 
              document.querySelector(`button[onclick*="logAttendance('${identityId}'"]`);
  
  if (btn) {
    btn.disabled = true;
    btn.innerText = 'Recording attendance...';
  }

  if (msgEl) {
    msgEl.style.display = 'block';
    msgEl.style.color = '#64748b';
    msgEl.textContent = 'Recording attendance...';
  }

  try {
    let eventName = (explicitEventName || '').trim();
    if (!eventName) {
      // Auto-fetch active session
      const sRes = await fetch('/api/attendance/sessions/active', { headers: getAuthHeaders() });
      if (sRes.ok) {
        const sData = await sRes.json();
        eventName = sData.event_name;
      }
    }

    if (!eventName) {
      const manualInput = document.getElementById('manualEventName');
      if (manualInput && manualInput.value.trim()) {
        eventName = manualInput.value.trim();
      }
    }

    const response = await fetch('/api/attendance/check-in', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
      body: JSON.stringify({ identity_id: identityId, event_name: eventName })
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Failed to log attendance');

    if (btn) {
      btn.style.background = '#059669';
      btn.style.borderColor = '#059669';
      btn.innerText = `✓ Marked Present (${data.event_name || eventName || 'Recorded'})`;
    }

    if (msgEl) {
      msgEl.style.display = 'block';
      msgEl.style.color = '#10b981';
      msgEl.textContent = `✓ SUCCESS: Added to ${data.event_name || eventName || 'list'}.`;
    }
  } catch (err) {
    if (btn) {
      btn.disabled = false;
      btn.innerText = '✓ Retry Mark as Present';
    }
    if (msgEl) {
      msgEl.style.display = 'block';
      msgEl.style.color = '#f43f5e';
      msgEl.textContent = `ERROR: ${err.message}`;
    }
  }
}

// --- Attendance Register Dashboard View ---
async function renderAttendanceRegisterView(container) {
  // 1. Fetch currently active session
  let activeSession = null;
  try {
    const res = await fetch('/api/attendance/sessions/active', { headers: getAuthHeaders() });
    if (res.ok) {
      activeSession = await res.json();
    }
  } catch (e) {
    // No active session
  }

  container.innerHTML = `
    <div class="page-header" style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px; margin-bottom: 24px;">
      <div>
        <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 6px;">
          <h1 class="page-title">Attendance Register</h1>
          <span class="live-pulse-badge">
            <span class="pulse-dot"></span> Live Log
          </span>
        </div>
        <div class="page-description">
          Create an active event list, then scan badges to automatically record personnel.
        </div>
      </div>
      <div style="display: flex; gap: 8px;">
        <button class="btn btn-secondary btn-sm" onclick="renderAttendanceRegisterView(document.getElementById('pageContent'))" title="Refresh records">
          <i data-lucide="refresh-cw" style="width: 14px; height: 14px;"></i> Refresh
        </button>
        <button class="btn btn-primary btn-sm" onclick="navigate('scan')">
          <i data-lucide="camera" style="width: 14px; height: 14px;"></i> 📷 Scan ID to Check-In
        </button>
      </div>
    </div>

    <!-- SESSION CONTROLLER PANEL -->
    <div class="card" style="margin-bottom: 24px; padding: 22px 24px; border-radius: var(--radius-lg); ${activeSession ? 'background: linear-gradient(135deg, #090e1a 0%, #0f172a 100%); border: 1px solid #1e293b; color: #ffffff; box-shadow: var(--shadow-md);' : 'background: #ffffff; border: 1px solid var(--border-color); box-shadow: var(--shadow-sm);'}">
      ${activeSession ? `
        <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 16px;">
          <div>
            <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 6px;">
              <span style="display: inline-block; width: 9px; height: 9px; border-radius: 50%; background: #10b981; box-shadow: 0 0 10px #10b981;"></span>
              <span style="font-size: 11px; font-weight: 800; color: #10b981; letter-spacing: 1.5px; text-transform: uppercase;">ACTIVE ROLL-CALL LIST</span>
            </div>
            <div style="font-size: 22px; font-weight: 800; color: #ffffff; letter-spacing: -0.02em; font-family: var(--font-display);">
              ${escapeHtml(activeSession.event_name)}
            </div>
            <div style="font-size: 12px; color: #94a3b8; margin-top: 4px;">
              Started ${new Date(activeSession.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} &bull; Any badge scanned now attaches to this event automatically.
            </div>
          </div>
          <div style="display: flex; gap: 10px; align-items: center; flex-wrap: wrap;">
            <button onclick="navigate('scan')" class="btn btn-primary" style="background: #d4af37; border-color: #d4af37; color: #090e1a; font-weight: 800; padding: 10px 18px; box-shadow: 0 4px 14px rgba(212, 175, 55, 0.35);">
              <i data-lucide="camera" style="width: 15px; height: 15px;"></i> 📷 Scan ID to Check-In
            </button>
            <button onclick="closeAttendanceSession()" class="btn btn-secondary btn-sm" style="background: rgba(255,255,255,0.08); border-color: rgba(255,255,255,0.18); color: #f1f5f9; padding: 8px 14px;">
              End / Close List
            </button>
          </div>
        </div>
      ` : `
        <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 16px;">
          <div>
            <div style="font-size: 15px; font-weight: 700; color: var(--text-main); font-family: var(--font-display);">
              Create New Attendance Session
            </div>
            <div style="font-size: 12.5px; color: var(--text-muted); margin-top: 3px;">
              Label the occasion once (e.g. Sunday Service) so all scans check in without repeated typing.
            </div>
          </div>
          <div style="display: flex; gap: 8px; flex-wrap: wrap; align-items: center;">
            <input type="text" id="newSessionName" placeholder="e.g. Sunday Main Service" style="padding: 10px 14px; border: 1px solid var(--border-strong); border-radius: var(--radius-md); font-size: 13px; min-width: 240px; outline: none; background: #f8fafc;" onkeydown="if(event.key === 'Enter') startAttendanceSession()" />
            <button onclick="startAttendanceSession()" class="btn btn-primary" style="background: #10b981; border-color: #10b981; color: #ffffff; font-weight: 700; padding: 10px 18px;">
              Start List
            </button>
          </div>
        </div>
      `}
    </div>

    <!-- LIVE LOGS TABLE -->
    <div class="data-card" style="padding: 0; overflow: hidden; border: 1px solid var(--border-color); border-radius: var(--radius-md); background: #ffffff; box-shadow: var(--shadow-sm);">
      <div style="padding: 14px 18px; border-bottom: 1px solid var(--border-color); background: var(--bg-subtle); display: flex; justify-content: space-between; align-items: center;">
        <span style="font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: var(--text-muted);">
          Recorded Check-Ins Feed
        </span>
        <span id="attendanceCountBadge" class="status-chip active" style="font-size: 11px;">
          Loading...
        </span>
      </div>
      <div style="overflow-x: auto;">
        <table class="data-table" style="width: 100%; border-collapse: collapse; text-align: left;">
          <thead>
            <tr style="background: #f8fafc; border-bottom: 1px solid var(--border-color); font-size: 11.5px; text-transform: uppercase; letter-spacing: 0.5px; color: var(--text-muted);">
              <th style="padding: 12px 16px;">Date &amp; Time</th>
              <th style="padding: 12px 16px;">Event Name</th>
              <th style="padding: 12px 16px;">Personnel Name</th>
              <th style="padding: 12px 16px;">Permanent ID</th>
              <th style="padding: 12px 16px;">Recorded By</th>
            </tr>
          </thead>
          <tbody id="attendanceTableBody">
            <tr><td colspan="5" style="text-align: center; padding: 32px; color: var(--text-muted);">Loading attendance records...</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  `;

  if (window.lucide) lucide.createIcons();

  await loadAttendanceLogs();
}

async function startAttendanceSession() {
  const input = document.getElementById('newSessionName');
  const eventName = input ? input.value.trim() : '';
  if (!eventName) {
    alert('Please enter an event or occasion name.');
    return;
  }

  try {
    const res = await fetch('/api/attendance/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
      body: JSON.stringify({ event_name: eventName })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to start session');

    renderAttendanceRegisterView(document.getElementById('pageContent'));
  } catch (err) {
    alert('Failed to start session: ' + err.message);
  }
}

async function closeAttendanceSession() {
  if (!confirm('Are you sure you want to close the current active attendance list?')) return;

  try {
    const res = await fetch('/api/attendance/sessions/close', {
      method: 'POST',
      headers: getAuthHeaders()
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || 'Failed to close session');
    }
    renderAttendanceRegisterView(document.getElementById('pageContent'));
  } catch (err) {
    alert('Failed to close session: ' + err.message);
  }
}

async function loadAttendanceLogs() {
  try {
    const response = await fetch('/api/attendance/logs', { headers: getAuthHeaders() });
    const logs = await response.json();

    const tbody = document.getElementById('attendanceTableBody');
    const badge = document.getElementById('attendanceCountBadge');
    if (!tbody) return;

    if (!Array.isArray(logs) || logs.length === 0) {
      if (badge) badge.textContent = '0 Records';
      tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; padding: 32px; color: var(--text-muted);">No attendance records found yet. Scan an ID card to record attendance.</td></tr>';
      return;
    }

    if (badge) badge.textContent = `${logs.length} Recorded`;

    tbody.innerHTML = logs.map(log => `
      <tr style="border-bottom: 1px solid var(--border-color); font-size: 13px;">
        <td style="padding: 12px 16px; font-family: var(--font-data); font-size: 12px; color: var(--text-muted);">${new Date(log.check_in_time).toLocaleString()}</td>
        <td style="padding: 12px 16px;">
          <span style="background: #e0f2fe; color: #0369a1; padding: 3px 8px; border-radius: 4px; font-size: 11.5px; font-weight: 600;">
            ${escapeHtml(log.event_name)}
          </span>
        </td>
        <td style="padding: 12px 16px; font-weight: 600; color: var(--text-main);">${escapeHtml(log.full_name)}</td>
        <td style="padding: 12px 16px; font-family: var(--font-data); font-size: 12px; font-weight: 600; color: var(--brand-primary);">${escapeHtml(log.id_number || '—')}</td>
        <td style="padding: 12px 16px; font-size: 12px; color: var(--text-muted);">${escapeHtml(log.scanned_by_name || 'Admin')}</td>
      </tr>
    `).join('');
  } catch (err) {
    const tbody = document.getElementById('attendanceTableBody');
    if (tbody) {
      tbody.innerHTML = `<tr><td colspan="5" style="color: #dc2626; text-align: center; padding: 24px;">Failed to load attendance data: ${escapeHtml(err.message)}</td></tr>`;
    }
  }
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// --- Initialize Event Listeners on Load ---
window.addEventListener('DOMContentLoaded', initSession);
window.addEventListener('load', handleRouting);
window.addEventListener('popstate', handleRouting);
window.addEventListener('hashchange', () => {
  const hash = window.location.hash.replace('#', '') || 'dashboard';
  if (state.user && state.currentRoute !== hash) {
    state.currentRoute = hash;
    render();
  } else {
    handleRouting();
  }
});

