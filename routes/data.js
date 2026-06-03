// ════════════════════════════════════════════════════════
//  Données financières (B3)
//  Toutes protégées par le JWT (middleware requireAuth).
//    GET  /api/data/perso   → lit le blob perso de l'utilisateur
//    PUT  /api/data/perso   → enregistre le blob perso
//    GET  /api/data/commun  → lit le blob commun du groupe
//    PUT  /api/data/commun  → enregistre le blob commun
//  Modèle : "un blob JSONB par espace" (cf. schema.sql).
// ════════════════════════════════════════════════════════
const express = require('express');
const { pool } = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth); // aucune route data sans token valide

// Groupe "actif" de l'utilisateur : celui qui a le plus de membres
// (le groupe couplé en B4 s'il existe), sinon son groupe perso.
async function getUserGroupId(uid) {
  const r = await pool.query(
    `SELECT gm.group_id
       FROM group_members gm
      WHERE gm.user_id = $1
   ORDER BY (SELECT count(*) FROM group_members x WHERE x.group_id = gm.group_id) DESC,
            gm.joined_at ASC
      LIMIT 1`,
    [uid]
  );
  return r.rows.length ? r.rows[0].group_id : null;
}

// ── PERSO ─────────────────────────────────────────────────
router.get('/perso', async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT data, updated_at FROM financial_data WHERE scope='perso' AND user_id=$1`,
      [req.user.uid]
    );
    if (!r.rows.length) return res.json({ data: {}, updated_at: null });
    res.json({ data: r.rows[0].data, updated_at: r.rows[0].updated_at });
  } catch (e) {
    console.error('GET /perso:', e.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.put('/perso', async (req, res) => {
  const data = req.body && req.body.data;
  if (typeof data === 'undefined') {
    return res.status(400).json({ error: 'Champ "data" requis' });
  }
  try {
    const r = await pool.query(
      `INSERT INTO financial_data (scope, user_id, data)
       VALUES ('perso', $1, $2)
       ON CONFLICT (user_id) WHERE scope='perso'
       DO UPDATE SET data = EXCLUDED.data, updated_at = now()
       RETURNING updated_at`,
      [req.user.uid, JSON.stringify(data)]
    );
    res.json({ ok: true, updated_at: r.rows[0].updated_at });
  } catch (e) {
    console.error('PUT /perso:', e.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ── COMMUN ────────────────────────────────────────────────
router.get('/commun', async (req, res) => {
  try {
    const gid = await getUserGroupId(req.user.uid);
    if (!gid) return res.status(404).json({ error: 'Aucun groupe associé' });
    const r = await pool.query(
      `SELECT data, updated_at FROM financial_data WHERE scope='commun' AND group_id=$1`,
      [gid]
    );
    if (!r.rows.length) return res.json({ data: {}, updated_at: null });
    res.json({ data: r.rows[0].data, updated_at: r.rows[0].updated_at });
  } catch (e) {
    console.error('GET /commun:', e.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.put('/commun', async (req, res) => {
  const data = req.body && req.body.data;
  if (typeof data === 'undefined') {
    return res.status(400).json({ error: 'Champ "data" requis' });
  }
  try {
    const gid = await getUserGroupId(req.user.uid);
    if (!gid) return res.status(404).json({ error: 'Aucun groupe associé' });
    const r = await pool.query(
      `INSERT INTO financial_data (scope, group_id, data)
       VALUES ('commun', $1, $2)
       ON CONFLICT (group_id) WHERE scope='commun'
       DO UPDATE SET data = EXCLUDED.data, updated_at = now()
       RETURNING updated_at`,
      [gid, JSON.stringify(data)]
    );
    res.json({ ok: true, updated_at: r.rows[0].updated_at });
  } catch (e) {
    console.error('PUT /commun:', e.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;
