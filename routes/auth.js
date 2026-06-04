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

function normAnswer(a) {
  return String(a || '').trim().toLowerCase();
}

// ── Inscription ───────────────────────────────────────────
router.post('/register', async (req, res) => {
  const { identifiant, pin, display_name, secret_question, secret_answer } = req.body || {};

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
    let sq = null, sah = null;
    if (secret_question && secret_answer && String(secret_answer).trim()) {
      sq = String(secret_question).trim();
      sah = await bcrypt.hash(normAnswer(secret_answer), 10);
    }
    const u = await client.query(
      `INSERT INTO users (identifiant, pin_hash, display_name, secret_question, secret_answer_hash)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, identifiant, display_name`,
      [identifiant.trim(), pinHash, (display_name || '').trim() || null, sq, sah]
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

// ── Définir / modifier la question secrète (protégé par JWT) ──
//  PUT /api/auth/secret  { question, answer }
router.put('/secret', requireAuth, async (req, res) => {
  const { question, answer } = req.body || {};
  if (!question || !String(question).trim()) {
    return res.status(400).json({ error: 'Question requise' });
  }
  if (!answer || !String(answer).trim()) {
    return res.status(400).json({ error: 'Réponse requise' });
  }
  try {
    const hash = await bcrypt.hash(normAnswer(answer), 10);
    await pool.query(
      'UPDATE users SET secret_question=$1, secret_answer_hash=$2 WHERE id=$3',
      [String(question).trim(), hash, req.user.uid]
    );
    res.json({ ok: true });
  } catch (e) {
    console.error('set secret:', e.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ── Récupérer la question secrète d'un identifiant (public) ──
//  POST /api/auth/forgot  { identifiant }  → { question }
router.post('/forgot', async (req, res) => {
  const { identifiant } = req.body || {};
  if (!identifiant || !String(identifiant).trim()) {
    return res.status(400).json({ error: 'Identifiant requis' });
  }
  try {
    const r = await pool.query(
      'SELECT secret_question FROM users WHERE identifiant=$1',
      [String(identifiant).trim()]
    );
    if (!r.rows.length || !r.rows[0].secret_question) {
      return res.status(404).json({ error: 'Aucune question de secours pour ce compte' });
    }
    res.json({ question: r.rows[0].secret_question });
  } catch (e) {
    console.error('forgot:', e.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ── Réinitialiser le PIN via la réponse secrète (public) ──
//  POST /api/auth/reset  { identifiant, answer, new_pin }  → { token, user }
router.post('/reset', async (req, res) => {
  const { identifiant, answer, new_pin } = req.body || {};
  if (!identifiant || !answer) {
    return res.status(400).json({ error: 'Identifiant et réponse requis' });
  }
  if (!new_pin || !/^\d{4,8}$/.test(String(new_pin))) {
    return res.status(400).json({ error: 'Nouveau PIN invalide (4 à 8 chiffres)' });
  }
  try {
    const r = await pool.query(
      'SELECT id, identifiant, display_name, secret_answer_hash FROM users WHERE identifiant=$1',
      [String(identifiant).trim()]
    );
    if (!r.rows.length || !r.rows[0].secret_answer_hash) {
      return res.status(401).json({ error: 'Réponse incorrecte' });
    }
    const user = r.rows[0];
    const ok = await bcrypt.compare(normAnswer(answer), user.secret_answer_hash);
    if (!ok) {
      return res.status(401).json({ error: 'Réponse incorrecte' });
    }
    const pinHash = await bcrypt.hash(String(new_pin), 10);
    await pool.query('UPDATE users SET pin_hash=$1 WHERE id=$2', [pinHash, user.id]);
    delete user.secret_answer_hash;
    return res.json({ token: signToken(user), user });
  } catch (e) {
    console.error('reset:', e.message);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;
