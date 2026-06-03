// ════════════════════════════════════════════════════════
//  Couplage (B4) — lier deux comptes via un code partageable
//    GET  /api/couple/status → état du couplage (membres, code)
//    POST /api/couple/code   → génère/récupère un code pour SON groupe
//    POST /api/couple/join   → rejoint un groupe via un code
//    POST /api/couple/leave  → quitte le groupe rejoint (découplage)
//  Modèle : chaque user possède son groupe (role 'owner'). Rejoindre =
//  devenir 'member' du groupe de l'autre. Le groupe à 2 membres devient
//  l'espace commun partagé (cf. getUserGroupId dans data.js).
// ════════════════════════════════════════════════════════
const express = require('express');
const { pool } = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

// Alphabet sans caractères ambigus (pas de O/0, I/1, L)
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
function randChars(n) {
  let s = '';
  for (let i = 0; i < n; i++) s += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  return s;
}
function makeCode(identifiant) {
  const prefix = (identifiant || 'USER').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6) || 'USER';
  return prefix + '-' + randChars(4);
}

async function ownerGroup(uid) {
  const r = await pool.query(
    `SELECT group_id FROM group_members WHERE user_id=$1 AND role='owner' ORDER BY joined_at ASC LIMIT 1`,
    [uid]
  );
  return r.rows.length ? r.rows[0].group_id : null;
}
async function activeGroup(uid) {
  const r = await pool.query(
    `SELECT gm.group_id
       FROM group_members gm WHERE gm.user_id=$1
   ORDER BY (SELECT count(*) FROM group_members x WHERE x.group_id=gm.group_id) DESC,
            gm.joined_at ASC LIMIT 1`,
    [uid]
  );
  return r.rows.length ? r.rows[0].group_id : null;
}
async function memberCount(gid) {
  const r = await pool.query(`SELECT count(*)::int AS n FROM group_members WHERE group_id=$1`, [gid]);
  return r.rows[0].n;
}

// ── État du couplage ──────────────────────────────────────
router.get('/status', async (req, res) => {
  try {
    const gid = await activeGroup(req.user.uid);
    if (!gid) return res.json({ coupled: false, members: [] });
    const mem = await pool.query(
      `SELECT u.identifiant, u.display_name, gm.role
         FROM group_members gm JOIN users u ON u.id=gm.user_id
        WHERE gm.group_id=$1 ORDER BY gm.joined_at ASC`,
      [gid]
    );
    const code = await pool.query(`SELECT couple_code FROM groups WHERE id=$1`, [gid]);
    res.json({
      coupled: mem.rows.length > 1,
      group_id: gid,
      members: mem.rows,
      couple_code: code.rows[0] ? code.rows[0].couple_code : null
    });
  } catch (e) {
    console.error('couple/status:', e.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ── Générer (ou récupérer) un code pour SON groupe ────────
router.post('/code', async (req, res) => {
  try {
    // Déjà couplé ? (groupe actif à 2 membres) → on refuse une nouvelle invitation
    const active = await activeGroup(req.user.uid);
    if (active && (await memberCount(active)) >= 2) {
      return res.status(409).json({ error: 'Tu es déjà couplé(e)' });
    }
    const gid = await ownerGroup(req.user.uid);
    if (!gid) return res.status(404).json({ error: 'Aucun groupe' });
    const ex = await pool.query(`SELECT couple_code FROM groups WHERE id=$1`, [gid]);
    if (ex.rows[0] && ex.rows[0].couple_code) {
      return res.json({ code: ex.rows[0].couple_code }); // déjà généré
    }
    for (let attempt = 0; attempt < 8; attempt++) {
      const code = makeCode(req.user.identifiant);
      try {
        await pool.query(`UPDATE groups SET couple_code=$1 WHERE id=$2`, [code, gid]);
        return res.json({ code });
      } catch (e) {
        if (e.code !== '23505') throw e; // collision → on réessaie
      }
    }
    res.status(500).json({ error: 'Impossible de générer un code, réessaie' });
  } catch (e) {
    console.error('couple/code:', e.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ── Rejoindre un groupe via un code ───────────────────────
router.post('/join', async (req, res) => {
  const code = ((req.body && req.body.code) || '').trim().toUpperCase();
  if (!code) return res.status(400).json({ error: 'Code requis' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const g = await client.query(`SELECT id FROM groups WHERE couple_code=$1`, [code]);
    if (!g.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Code invalide ou expiré' });
    }
    const gid = g.rows[0].id;

    const already = await client.query(
      `SELECT 1 FROM group_members WHERE group_id=$1 AND user_id=$2`, [gid, req.user.uid]
    );
    if (already.rows.length) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Tu fais déjà partie de ce groupe' });
    }
    const cnt = await client.query(`SELECT count(*)::int AS n FROM group_members WHERE group_id=$1`, [gid]);
    if (cnt.rows[0].n >= 2) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Ce groupe est déjà complet' });
    }

    await client.query(
      `INSERT INTO group_members (group_id, user_id, role) VALUES ($1, $2, 'member')`,
      [gid, req.user.uid]
    );
    // Code à usage unique : on l'invalide une fois utilisé
    await client.query(`UPDATE groups SET couple_code=NULL WHERE id=$1`, [gid]);
    await client.query('COMMIT');
    res.json({ ok: true, group_id: gid });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('couple/join:', e.message);
    res.status(500).json({ error: 'Erreur serveur' });
  } finally {
    client.release();
  }
});

// ── Quitter le groupe rejoint (découplage) ────────────────
router.post('/leave', async (req, res) => {
  try {
    const r = await pool.query(
      `DELETE FROM group_members WHERE user_id=$1 AND role='member' RETURNING group_id`,
      [req.user.uid]
    );
    res.json({ ok: true, left: r.rows.length });
  } catch (e) {
    console.error('couple/leave:', e.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;
