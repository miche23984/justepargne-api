// ════════════════════════════════════════════════════════
//  JustEpargne API — serveur (B1)
//  Pour l'instant : santé + connexion DB. Auth (B2) et données
//  (B3) viendront se greffer ici via app.use('/api/...').
// ════════════════════════════════════════════════════════
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const { pool } = require('./db');
const authRouter = require('./routes/auth');
const dataRouter = require('./routes/data');
const coupleRouter = require('./routes/couple');

if (!process.env.JWT_SECRET) {
  console.warn('⚠  JWT_SECRET non défini — l\'authentification ne fonctionnera pas. Voir .env.example');
}

const app = express();

app.use(cors());                       // ouvert pour l'instant ; on restreindra plus tard
app.use(express.json({ limit: '5mb' })); // les blobs d'espace peuvent être volumineux

// Authentification (B2)
app.use('/api/auth', authRouter);

// Données financières (B3)
app.use('/api/data', dataRouter);

// Couplage (B4)
app.use('/api/couple', coupleRouter);

// Racine — petit ping
app.get('/', (req, res) => {
  res.json({ name: 'JustEpargne API', phase: 'B1', status: 'ok' });
});

// Health check — vérifie aussi que la base répond
app.get('/api/health', async (req, res) => {
  try {
    const r = await pool.query('SELECT now() AS time');
    res.json({ ok: true, db: 'up', time: r.rows[0].time });
  } catch (e) {
    res.status(500).json({ ok: false, db: 'down', error: e.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('🚀 JustEpargne API démarrée sur le port ' + PORT);
});
