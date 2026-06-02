// ── Applique schema.sql sur la base pointée par DATABASE_URL ──
// Usage : npm run init-db
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { pool } = require('../db');

(async () => {
  try {
    const sql = fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8');
    await pool.query(sql);
    console.log('✅ Schéma appliqué avec succès.');
  } catch (e) {
    console.error('❌ Échec de l\'initialisation :', e.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
