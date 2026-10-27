# Church Identity & Traffic Marshal Card System

A full identity, verification, and lost-card recovery system for church congregations, traffic marshals, and ministry workers. Built with Node.js, Express, PostgreSQL (`pg`), EJS, and QR code generation (`qrcode`).

---

## Key Capabilities

1. **Identity & Dignity**:
   - Gold-and-navy executive aesthetic with Cormorant Garamond serif typography.
   - Verified church seal badge (`✦ Verified by Grace Chapel International`).
   - Community standing, ordination/leadership title, member-since date, and bio.

2. **Context & Ministry Role**:
   - Community role chips (e.g. *Traffic Marshal, Elder, Ushering Dept*).
   - Assembly affiliations with ministry departments.
   - Equipment and gear issue tracking (e.g. *Hi-Vis Vests, Radios, Flashlights*).

3. **Privacy & Tiered Visibility**:
   - Phone, WhatsApp, and email are hidden by default to prevent web scraping.
   - Protected behind a "🔒 Reveal contact details" button that queries `POST /p/:token/reveal`.
   - Granular privacy toggles per member (`show_phone`, `show_email`, `show_whatsapp`, `show_holdings`).

4. **Lost Card Recovery Flow**:
   - Admin one-click "Lost Card" toggle displays an urgent red banner upon QR scan.
   - Finder "📞 I found this card — return it" CTA automatically reveals contact options and scrolls to call/WhatsApp the owner or church office.
   - Full audit trail (`scan_events`) logs every public scan and contact reveal.

---

## Setup & Running

### 1. Configure `.env`
Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```
Ensure your configuration points to your PostgreSQL database (local or Neon / Supabase):
```env
DATABASE_URL=postgres://user:password@localhost:5432/idsystem
PUBLIC_BASE_URL=http://localhost:3000
PORT=3000
ADMIN_PASSWORD=changeme123
CHURCH_NAME=Grace Chapel International
```

### 2. Initialize PostgreSQL Schema
Run the built-in database migration (no `psql` installation required!):
```bash
npm run migrate
```
*(Alternatively, if you use Neon or Supabase, you can also paste the contents of `schema.sql` into their web SQL Editor).*

### 3. Install Dependencies & Start
```bash
npm install
npm start
```
Console output:
```text
Server running on http://localhost:3000
```

---

## Acceptance Criteria Self-Test

1. **Access Admin**: Open `http://localhost:3000/admin`. Log in with username `admin` and password from `ADMIN_PASSWORD` (`changeme123`).
2. **Add Member**:
   - Title: `Elder`, Full Name: `Pastor John Adeyemi`, Member Since: `2014`, Status: `leader`.
   - Roles: `Traffic Marshal, Ushering Dept`.
   - Bio: `Serving as Traffic Marshal since 2019. Ordained elder, 2021.`
   - Phone & WhatsApp: `+234 800 000 0000`.
   - Click **Create Member ID & QR**.
3. **Assign Affiliation & Gear**:
   - Click **Manage** on the member's row.
   - Add Affiliation: Company `Grace Chapel International`, Role `Traffic Marshal`, Department `Ushering`.
   - Assign Gear: Item `Hi-Vis Vest`, Type `Gear`, Serial `VST-0042`.
4. **Scan / View Profile**:
   - Open `/p/<profile_token>` or scan the QR code.
   - Verify gold & navy card aesthetic, verified badge, roles, and issued items.
5. **Test Contact Reveal**:
   - Click **🔒 Reveal contact details** &rarr; Phone, WhatsApp, and Email appear.
6. **Test Lost Card Recovery**:
   - In Admin Modal, check **Flag card as LOST**, enter return instructions, and save.
   - Refresh `/p/<profile_token>` &rarr; Red `⚠ This card was reported lost` banner appears.
   - Click **📞 I found this card — return it** &rarr; reveals contacts and smoothly scrolls to them.
