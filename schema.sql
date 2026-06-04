-- ════════════════════════════════════════════════════════
--  JustEpargne — Schéma de base (B1)
--  PostgreSQL 13+  (gen_random_uuid() est intégré, aucune extension requise)
--  Idempotent : peut être ré-exécuté sans erreur (IF NOT EXISTS partout).
-- ════════════════════════════════════════════════════════

-- ── Utilisateurs ──────────────────────────────────────────
-- Un compte = un identifiant unique + un PIN hashé.
-- (Le hash sera produit en B2 ; ici la colonne est agnostique.)
CREATE TABLE IF NOT EXISTS users (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  identifiant  TEXT        NOT NULL UNIQUE,
  pin_hash     TEXT        NOT NULL,
  display_name TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Question secrète (Lot 2 : récupération de PIN) ────────
-- Permet de réinitialiser son PIN sans email. La réponse est
-- hachée en bcrypt côté serveur (jamais stockée en clair).
ALTER TABLE users ADD COLUMN IF NOT EXISTS secret_question    TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS secret_answer_hash TEXT;

-- ── Groupes ───────────────────────────────────────────────
-- Unité qui possède l'espace commun. couple_code = le code
-- partageable type "MICHE-4X2K" (généré en B4), nul tant qu'absent.
CREATE TABLE IF NOT EXISTS groups (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  couple_code TEXT UNIQUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Appartenance aux groupes ──────────────────────────────
-- Relie un utilisateur à un groupe. Un solo = 1 groupe, 1 membre.
-- Un couplage = 2 membres dans le même groupe.
CREATE TABLE IF NOT EXISTS group_members (
  group_id  UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id   UUID NOT NULL REFERENCES users(id)  ON DELETE CASCADE,
  role      TEXT NOT NULL DEFAULT 'member',
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, user_id)
);

-- ── Données financières ───────────────────────────────────
-- "Un blob par espace" : on stocke directement l'objet d'état
-- du front (le même JSON qu'en localStorage) en JSONB.
--   • scope = 'perso'  → appartient à un utilisateur  (user_id)
--   • scope = 'commun' → appartient à un groupe        (group_id)
CREATE TABLE IF NOT EXISTS financial_data (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scope      TEXT NOT NULL CHECK (scope IN ('perso','commun')),
  user_id    UUID REFERENCES users(id)  ON DELETE CASCADE,
  group_id   UUID REFERENCES groups(id) ON DELETE CASCADE,
  data       JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Cohérence des clés selon le scope
  CHECK (
    (scope = 'perso'  AND user_id  IS NOT NULL) OR
    (scope = 'commun' AND group_id IS NOT NULL)
  )
);

-- Un seul blob perso par utilisateur (jamais de collision entre persos)
CREATE UNIQUE INDEX IF NOT EXISTS uniq_perso_per_user
  ON financial_data (user_id) WHERE scope = 'perso';

-- Un seul blob commun par groupe
CREATE UNIQUE INDEX IF NOT EXISTS uniq_commun_per_group
  ON financial_data (group_id) WHERE scope = 'commun';
