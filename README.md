# JustEpargne — Backend (B1 : setup)

API Node.js + Express + PostgreSQL pour synchroniser l'app entre appareils.
**Cette phase B1 ne fait que poser les fondations** : un serveur qui démarre, se
connecte à la base, et expose un point de santé. L'authentification (B2) et la
lecture/écriture des données (B3) viendront se brancher dessus.

---

## Ce qu'il y a dans le dossier

| Fichier | Rôle |
|---|---|
| `server.js` | Le serveur Express (racine `/` + `/api/health`) |
| `db.js` | Connexion PostgreSQL (pool partagé) |
| `schema.sql` | Les 4 tables : `users`, `groups`, `group_members`, `financial_data` |
| `scripts/init-db.js` | Applique `schema.sql` sur la base (`npm run init-db`) |
| `render.yaml` | Déploiement Render en un clic (service web + base) |
| `.env.example` | Modèle de variables d'environnement |
| `package.json` | Dépendances et scripts |

### Le choix de stockage
Les données financières sont stockées **en JSONB, un blob par espace** — exactement
le même objet que ton `localStorage` aujourd'hui. Migration triviale, quasi zéro
réécriture du front. Une ligne `financial_data` par espace : `perso` (clé `user_id`)
ou `commun` (clé `group_id`).

---

## Prérequis (côté toi)

- **Node.js 18+** → https://nodejs.org
- **Compte GitHub** → https://github.com
- **Compte Render** → https://render.com (gratuit, sans carte)

> ⚠ Le plan **gratuit** de Render (service web + Postgres) a des limites
> (mise en veille après inactivité, durée de vie / taille de la base). Vérifie les
> conditions à jour sur render.com avant de t'appuyer dessus pour un usage durable.

---

## Option A — Déployer direct sur Render (recommandé, pas besoin de Postgres en local)

1. **Mets le dossier sur GitHub**
   ```bash
   cd justepargne-api
   git init
   git add .
   git commit -m "B1 — setup backend"
   git branch -M main
   git remote add origin https://github.com/TON_PSEUDO/justepargne-api.git
   git push -u origin main
   ```

2. **Crée le Blueprint sur Render**
   - Render → **New** → **Blueprint** → connecte ton repo `justepargne-api`.
   - Render lit `render.yaml` et propose de créer **le service web + la base Postgres**. Valide.
   - Il injecte tout seul `DATABASE_URL` dans le service web.

3. **Initialise la base** (une seule fois)
   - Dans le dashboard Render, ouvre la base `justepargne-db` → copie l'**External Database URL**.
   - En local, lance le schéma contre cette URL :
     ```bash
     npm install
     DATABASE_URL="colle_l_external_url_ici" PGSSL=require npm run init-db
     ```
   - Tu dois voir : `✅ Schéma appliqué avec succès.`

4. **Vérifie**
   - Ouvre `https://justepargne-api.onrender.com/api/health`
   - Réponse attendue : `{"ok":true,"db":"up","time":"..."}`

---

## Option B — Tout en local (si tu as déjà PostgreSQL installé)

```bash
cd justepargne-api
npm install
cp .env.example .env          # puis édite .env :
                              #   DATABASE_URL=postgresql://USER:PASS@localhost:5432/justepargne
                              #   PGSSL=disable
npm run init-db               # crée les tables
npm run dev                   # démarre le serveur (rechargement auto)
```

Puis ouvre http://localhost:3000/api/health → `{"ok":true,"db":"up",...}`.

---

## B2 — Authentification (déployer la mise à jour)

Nouvelles routes :
- `POST /api/auth/register` — corps `{ "identifiant": "...", "pin": "1234", "display_name": "..." }` → crée le compte + son groupe, renvoie un `token` (JWT) valable 30 jours.
- `POST /api/auth/login` — corps `{ "identifiant": "...", "pin": "1234" }` → renvoie un `token`.

Le PIN est hashé avec **bcrypt côté serveur** ; il n'est jamais stocké en clair.

### Étapes pour mettre en ligne B2

1. **Remplace tes fichiers locaux** par ceux de cette nouvelle version (ou décompresse le zip par-dessus), puis :
   ```bash
   npm install            # récupère bcryptjs + jsonwebtoken
   git add .
   git commit -m "B2 - auth register/login + JWT"
   git push
   ```
   Render redéploie automatiquement à chaque `git push`.

2. **Ajoute le secret JWT sur Render** (le service existe déjà, donc on l'ajoute à la main une fois) :
   - Dashboard Render → service **justepargne-api** → onglet **Environment**.
   - **Add Environment Variable** → Key : `JWT_SECRET` → Value : clique **Generate** (ou colle une longue chaîne aléatoire).
   - Sauvegarde → Render redéploie.

3. **Teste** (depuis ton terminal, remplace l'URL par la tienne) :
   ```bash
   API="https://justepargne-api.onrender.com"
   # Inscription
   curl -X POST $API/api/auth/register -H "Content-Type: application/json" \
     -d '{"identifiant":"miche","pin":"1234","display_name":"Miché"}'
   # Connexion
   curl -X POST $API/api/auth/login -H "Content-Type: application/json" \
     -d '{"identifiant":"miche","pin":"1234"}'
   ```
   Chaque appel doit renvoyer un `token` (longue chaîne `eyJ...`).

---

## La suite

- **B3** — Données : `GET/PUT /api/data/perso` et `/api/data/commun`, protégés par le JWT (en-tête `Authorization: Bearer <token>`).
- **B4** — Couplage via `couple_code`.
- **B5** — WebSocket pour l'espace commun.
- **B6** — Bouton « migrer mes données » : envoie ton export JSON localStorage au serveur.

