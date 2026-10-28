-- ==============================================================================
-- ENTERPRISE MULTI-TENANT IDENTITY & QR VERIFICATION PLATFORM SCHEMA (V2)
-- ==============================================================================

-- 1. Organizations (Tenants)
CREATE TABLE IF NOT EXISTS organisations (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(100) UNIQUE NOT NULL,
    logo_url TEXT,
    brand_color VARCHAR(30) DEFAULT '#0b132b',
    accent_color VARCHAR(30) DEFAULT '#2563eb',
    id_prefix VARCHAR(20) DEFAULT 'ID',
    default_validity_days INT DEFAULT 365,
    contact_email VARCHAR(255),
    contact_phone VARCHAR(50),
    verification_instructions TEXT DEFAULT 'Scan the QR code or visit our verification portal to verify credentials.',
    card_template_settings JSONB DEFAULT '{
      "show_department": true,
      "show_position": true,
      "show_issue_date": true,
      "show_expiry_date": true,
      "show_emergency_contact": false
    }'::jsonb,
    verification_visibility_settings JSONB DEFAULT '{
      "public_show_email": false,
      "public_show_phone": false,
      "public_show_department": true,
      "public_show_position": true,
      "public_show_photo": true,
      "operator_show_contact": true
    }'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. Staff / Users
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    full_name VARCHAR(255) NOT NULL,
    avatar_url TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 3. Tenant Memberships & Roles (RBAC)
-- Roles: super_admin, identity_manager, verification_officer, verification_operator
CREATE TABLE IF NOT EXISTS organisation_memberships (
    id SERIAL PRIMARY KEY,
    organisation_id INT NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
    user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role VARCHAR(50) NOT NULL DEFAULT 'verification_operator',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE (organisation_id, user_id)
);

-- 4. Core Identities (Stable Person Record)
CREATE TABLE IF NOT EXISTS identities (
    id SERIAL PRIMARY KEY,
    organisation_id INT NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
    id_number VARCHAR(100) NOT NULL,
    full_name VARCHAR(255) NOT NULL,
    first_name VARCHAR(100),
    last_name VARCHAR(100),
    title VARCHAR(50),
    email VARCHAR(255),
    phone VARCHAR(50),
    date_of_birth DATE,
    department VARCHAR(150),
    position VARCHAR(150),
    photo_url TEXT,
    status VARCHAR(30) DEFAULT 'active', -- active, suspended, expired, archived
    emergency_contact_name VARCHAR(255),
    emergency_contact_phone VARCHAR(50),
    bio TEXT,
    custom_fields JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE (organisation_id, id_number)
);

-- 5. Physical ID Cards (Decoupled from Person; Supports Reissuance & Revocation)
CREATE TABLE IF NOT EXISTS id_cards (
    id SERIAL PRIMARY KEY,
    identity_id INT NOT NULL REFERENCES identities(id) ON DELETE CASCADE,
    organisation_id INT NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
    card_number VARCHAR(100) NOT NULL,
    verification_token VARCHAR(64) UNIQUE NOT NULL, -- Cryptographically secure token
    status VARCHAR(30) DEFAULT 'active', -- active, revoked, expired, suspended
    issue_date DATE NOT NULL DEFAULT CURRENT_DATE,
    expiry_date DATE,
    is_current BOOLEAN DEFAULT TRUE,
    revoked_at TIMESTAMP WITH TIME ZONE,
    revocation_reason TEXT,
    reissued_from_card_id INT REFERENCES id_cards(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 6. Verification History (Scan Events)
CREATE TABLE IF NOT EXISTS verification_events (
    id SERIAL PRIMARY KEY,
    organisation_id INT NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
    card_id INT REFERENCES id_cards(id) ON DELETE SET NULL,
    identity_id INT REFERENCES identities(id) ON DELETE SET NULL,
    outcome VARCHAR(30) NOT NULL, -- verified, expired, suspended, revoked, invalid
    scanned_by_user_id INT REFERENCES users(id) ON DELETE SET NULL,
    token_used VARCHAR(64),
    ip_address VARCHAR(50),
    user_agent TEXT,
    failure_category VARCHAR(100),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 7. Administrative Audit Logs
CREATE TABLE IF NOT EXISTS audit_logs (
    id SERIAL PRIMARY KEY,
    organisation_id INT NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
    user_id INT REFERENCES users(id) ON DELETE SET NULL,
    action VARCHAR(100) NOT NULL, -- IDENTITY_CREATED, CARD_ISSUED, CARD_REVOKED, ROLE_UPDATED, etc.
    record_type VARCHAR(50) NOT NULL, -- identity, card, user, organisation
    record_id INT,
    change_summary TEXT,
    ip_address VARCHAR(50),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 8. Attendance Logs
CREATE TABLE IF NOT EXISTS attendance_logs (
    id SERIAL PRIMARY KEY,
    organisation_id INT REFERENCES organisations(id) ON DELETE CASCADE,
    identity_id INT NOT NULL REFERENCES identities(id) ON DELETE CASCADE,
    event_name VARCHAR(150) NOT NULL,
    check_in_time TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    scanned_by INT REFERENCES users(id) ON DELETE SET NULL
);

-- Indexes for lightning-fast queries and tenant isolation
CREATE INDEX IF NOT EXISTS idx_identities_org_status ON identities(organisation_id, status);
CREATE INDEX IF NOT EXISTS idx_identities_org_search ON identities(organisation_id, full_name, id_number);
CREATE INDEX IF NOT EXISTS idx_id_cards_token ON id_cards(verification_token);
CREATE INDEX IF NOT EXISTS idx_id_cards_identity ON id_cards(identity_id, is_current);
CREATE INDEX IF NOT EXISTS idx_verification_events_org ON verification_events(organisation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_org ON audit_logs(organisation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_attendance_identity ON attendance_logs(identity_id);
CREATE INDEX IF NOT EXISTS idx_attendance_checkin ON attendance_logs(check_in_time DESC);
