-- Replacement Schema for church-traffic identity card system

CREATE TABLE IF NOT EXISTS companies (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    code VARCHAR(50) UNIQUE NOT NULL,
    logo_url TEXT
);

CREATE TABLE IF NOT EXISTS people (
    id SERIAL PRIMARY KEY,

    -- Identity
    full_name VARCHAR(255) NOT NULL,
    preferred_name VARCHAR(100),
    title VARCHAR(50),                 -- Mr, Mrs, Pastor, Elder, Deacon, etc.
    photo_url TEXT,
    cover_photo_url TEXT,              -- optional banner

    -- Contact (revealed on tap)
    email VARCHAR(255),
    phone VARCHAR(50),
    whatsapp VARCHAR(50),
    alt_contact_name VARCHAR(255),     -- emergency contact
    alt_contact_phone VARCHAR(50),

    -- Community / church standing
    membership_status VARCHAR(30) DEFAULT 'member', -- member / leader / staff / clergy / guest
    member_since INT,
    bio TEXT,                          -- 1-3 sentence intro shown publicly
    public_roles TEXT,                 -- e.g. "Traffic Marshal, Ushering Dept"

    -- Card & privacy
    profile_token VARCHAR(64) UNIQUE NOT NULL,
    profile_public BOOLEAN DEFAULT TRUE,
    show_phone BOOLEAN DEFAULT TRUE,
    show_email BOOLEAN DEFAULT TRUE,
    show_whatsapp BOOLEAN DEFAULT TRUE,
    show_holdings BOOLEAN DEFAULT TRUE,

    -- Recovery
    lost_card_active BOOLEAN DEFAULT FALSE,
    lost_card_message TEXT,

    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS memberships (
    id SERIAL PRIMARY KEY,
    person_id INT REFERENCES people(id) ON DELETE CASCADE,
    company_id INT REFERENCES companies(id) ON DELETE CASCADE,
    role VARCHAR(100),
    department VARCHAR(100),
    joined_at DATE,
    UNIQUE(person_id, company_id)
);

CREATE TABLE IF NOT EXISTS holdings (
    id SERIAL PRIMARY KEY,
    membership_id INT REFERENCES memberships(id) ON DELETE CASCADE,
    item_name VARCHAR(255) NOT NULL,
    item_type VARCHAR(50),
    serial_number VARCHAR(100),
    status VARCHAR(30) DEFAULT 'held'
);

CREATE TABLE IF NOT EXISTS scan_events (
    id SERIAL PRIMARY KEY,
    person_id INT REFERENCES people(id) ON DELETE CASCADE,
    scanned_at TIMESTAMP DEFAULT NOW(),
    user_agent TEXT,
    ip VARCHAR(64),
    mode VARCHAR(20) DEFAULT 'public'   -- public | recovery | reveal
);

-- Seed initial church assembly / company
INSERT INTO companies (name, code)
VALUES ('Grace Chapel International', 'GCI')
ON CONFLICT (code) DO NOTHING;
