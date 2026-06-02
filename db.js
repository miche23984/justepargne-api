// ── Connexion PostgreSQL (pool partagé) ──
const { Pool } = require('pg');

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.warn('⚠  DATABASE_URL non défini — voir .env.example');
}

// Render impose le SSL en production. En local (PGSSL=disable) on le coupe.
const ssl = process.env.PGSSL === 'disable' ? false : { rejectUnauthorized: false };

const pool = new Pool({ connectionString, ssl });

pool.on('error', (err) => {
  console.error('Erreur inattendue sur le pool PostgreSQL:', err.message);
});

module.exports = { pool };
