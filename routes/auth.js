// ════════════════════════════════════════════════════════
//  Authentification (B2)
//  POST /api/auth/register  → crée un compte + son groupe, renvoie un JWT
//  POST /api/auth/login     → vérifie identifiant + PIN, renvoie un JWT
//  Le PIN est hashé avec bcrypt CÔTÉ SERVEUR (jamais stocké en clair).
// ════════════════════════════════════════════════════════
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { pool } = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

function signToken(user) {
  return jwt.sign(
    { uid: user.id, identifiant: user.identifiant },
    process.env.JWT_SECRET,
    { expiresIn: '30d' }
  );
}

// ── Inscription ───────────────────────────────────────────
router.post('/register', async (req, res) => {
  const { identifiant, pin, display_name } = req.body || {};

  if (!identifiant || typeof identifiant !== 'string' || !identifiant.trim()) {
    return res.status(400).json({ error: 'Identifiant requis' });
  }
  if (!pin || !/^\d{4,8}$/.test(String(pin))) {
    return res.status(400).json({ error: 'PIN invalide (4 à 8 chiffres)' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const pinHash = await bcrypt.hash(String(pin), 10);
    const u = await client.query(
      `INSERT INTO users (identifiant, pin_hash, display_name)
       VALUES ($1, $2, $3)
       RETURNING id, identifiant, display_name`,
      [identifiant.trim(), pinHash, (display_name || '').trim() || null]
    );
    const user = u.rows[0];

    // Chaque utilisateur reçoit son propre groupe (base du couplage en B4)
    const g = await client.query('INSERT INTO groups DEFAULT VALUES RETURNING id');
    await client.query(
      `INSERT INTO group_members (group_id, user_id, role) VALUES ($1, $2, 'owner')`,
      [g.rows[0].id, user.id]
    );

    await client.query('COMMIT');
    return res.status(201).json({ token: signToken(user), user });
  } catch (e) {
    await client.query('ROLLBACK');
    if (e.code === '23505') { // violation de contrainte UNIQUE
      return res.status(409).json({ error: 'Cet identifiant est déjà pris' });
    }
    console.error('register error:', e.message);
    return res.status(500).json({ error: 'Erreur serveur' });
  } finally {
    client.release();
  }
});

// ── Connexion ─────────────────────────────────────────────
router.post('/login', async (req, res) => {
  const { identifiant, pin } = req.body || {};
  if (!identifiant || !pin) {
    return res.status(400).json({ error: 'Identifiant et PIN requis' });
  }
  try {
    const r = await pool.query(
      'SELECT id, identifiant, pin_hash, display_name FROM users WHERE identifiant = $1',
      [String(identifiant).trim()]
    );
    // Message volontairement identique pour ne pas révéler si l'identifiant existe
    if (!r.rows.length) {
      return res.status(401).json({ error: 'Identifiant ou PIN incorrect' });
    }
    const user = r.rows[0];
    const ok = await bcrypt.compare(String(pin), user.pin_hash);
    if (!ok) {
      return res.status(401).json({ error: 'Identifiant ou PIN incorrect' });
    }
    delete user.pin_hash;
    return res.json({ token: signToken(user), user });
  } catch (e) {
    console.error('login error:', e.message);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ── Suppression de compte (Bloc B) ───────────────────────
//  DELETE /api/auth/account  (protégé par JWT)
//  Supprime l'utilisateur, son espace perso, ses groupes possédés
//  (et le commun associé) + ses adhésions, le tout via ON DELETE CASCADE.
router.delete('/account', requireAuth, async (req, res) => {
  const uid = req.user.uid;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Groupes que l'utilisateur possède
    const owned = await client.query(
      `SELECT group_id FROM group_members WHERE user_id=$1 AND role='owner'`,
      [uid]
    );
    const ownedIds = owned.rows.map(r => r.group_id);
    // Supprime les groupes possédés → CASCADE sur leurs membres + leur commun
    if (ownedIds.length) {
      await client.query(`DELETE FROM groups WHERE id = ANY($1::uuid[])`, [ownedIds]);
    }
    // Supprime l'utilisateur → CASCADE sur son perso + ses adhésions restantes
    await client.query(`DELETE FROM users WHERE id=$1`, [uid]);
    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('account delete:', e.message);
    res.status(500).json({ error: 'Erreur serveur' });
  } finally {
    client.release();
  }
});

module.exports = router;
