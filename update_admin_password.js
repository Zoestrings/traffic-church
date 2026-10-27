const bcrypt = require('bcryptjs');
const db = require('./server/db');

async function updatePassword() {
  const hash = await bcrypt.hash('admin123', 10);
  await db.query('UPDATE users SET password_hash = $1 WHERE email = $2', [hash, 'admin@gracechapel.org']);
  console.log('✓ Admin password hash updated successfully for admin@gracechapel.org');
  process.exit(0);
}

updatePassword().catch(err => {
  console.error(err);
  process.exit(1);
});
