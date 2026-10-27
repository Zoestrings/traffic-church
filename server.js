require('dotenv').config();
const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(cors({
  origin: true,
  credentials: true
}));

// Serve uploaded photos statically
app.use('/uploads', express.static(path.join(__dirname, 'public', 'uploads')));

// Serve client assets statically
app.use(express.static(path.join(__dirname, 'public')));

// Enterprise REST API routes
app.use('/api/auth', require('./server/routes/auth'));
app.use('/api/dashboard', require('./server/routes/dashboard'));
app.use('/api/identities', require('./server/routes/identities'));
app.use('/api/cards', require('./server/routes/cards'));
app.use('/api/verify', require('./server/routes/verify'));
app.use('/api/organisation', require('./server/routes/organisation'));
app.use('/api/audit', require('./server/routes/audit'));

// Public Verification Page Route -> Serves client app
app.get('/verify/:token', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Backward compatibility profile route
app.get('/p/:token', (req, res) => {
  res.redirect(`/verify/${req.params.token}`);
});

// Single Page Application Fallback for admin, dashboard, scan, directory, etc.
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start Server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Enterprise Identity Platform server running on http://localhost:${PORT}`);
  console.log(`Public Network Base URL: ${process.env.PUBLIC_BASE_URL || `http://localhost:${PORT}`}`);
});
