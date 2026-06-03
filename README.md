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

## B3 — Données (déployer la mise à jour)

Nouvelles routes, **toutes protégées par le JWT** (en-tête `Authorization: Bearer <token>`) :
- `GET  /api/data/perso`  → lit ton blob perso (`{}` si vide)
- `PUT  /api/data/perso`  → enregistre ton blob perso — corps `{ "data": { ... } }`
- `GET  /api/data/commun` → lit le blob commun de ton groupe
- `PUT  /api/data/commun` → enregistre le blob commun — corps `{ "data": { ... } }`

Chaque `PUT` fait un **upsert** : une seule ligne par espace, jamais de doublon.

### Note infra
La base est sur **Neon** (PostgreSQL gratuit permanent), pas sur Render. `DATABASE_URL`
est défini manuellement dans Render → Environment (avec l'URL Neon). Le `render.yaml`
a été nettoyé en conséquence (`sync: false`) pour que Render ne l'écrase jamais.

### Étapes pour mettre en ligne B3

1. Mets à jour tes fichiers locaux, puis :
   ```bash
   npm install
   git add .
   git commit -m "B3 - data routes perso/commun"
   git push
   ```
   Render redéploie automatiquement. `DATABASE_URL` (Neon) reste intact.

2. **Teste** (récupère d'abord un token via login, puis utilise-le) :
   ```bash
   API="https://justepargne-api.onrender.com"
   TOKEN=$(curl -s -X POST $API/api/auth/login -H "Content-Type: application/json" \
     -d '{"identifiant":"miche","pin":"1234"}' | python3 -c "import sys,json;print(json.load(sys.stdin)['token'])")

   # Écrire
   curl -X PUT $API/api/data/perso -H "Authorization: Bearer $TOKEN" \
     -H "Content-Type: application/json" -d '{"data":{"test":123}}'
   # Relire
   curl $API/api/data/perso -H "Authorization: Bearer $TOKEN"
   ```
   La relecture doit renvoyer `{"data":{"test":123}, ...}`.

---

## B4 — Couplage (déployer la mise à jour)

Lier deux comptes via un code partageable. Toutes protégées par le JWT.
- `GET  /api/couple/status` → `{ coupled, group_id, members[], couple_code }`
- `POST /api/couple/code`   → génère/récupère un code (ex : `MICHE-EGJB`). Refusé si déjà couplé.
- `POST /api/couple/join`   → corps `{ "code": "MICHE-EGJB" }` → rejoint le groupe. Code à usage unique.
- `POST /api/couple/leave`  → quitte le groupe rejoint (découplage).

Une fois couplés, les deux comptes partagent l'**espace commun** ; les espaces **perso restent privés**.

### Déploiement
```bash
npm install
git add .
git commit -m "B4 - couplage (code partageable)"
git push
```

### Test (deux comptes)
```bash
API="https://justepargne-api.onrender.com"
TA=$(curl -s -X POST $API/api/auth/login -H "Content-Type: application/json" -d '{"identifiant":"miche","pin":"1234"}' | python3 -c "import sys,json;print(json.load(sys.stdin)['token'])")
# Miché génère un code
curl -s -X POST $API/api/couple/code -H "Authorization: Bearer $TA"
# → {"code":"MICHE-XXXX"} : transmets ce code à l'autre compte, qui fait /api/couple/join
```

---

## La suite

- **B5** — WebSocket pour l'espace commun (sync temps réel quand les deux modifient).
- **B6** — Bouton « migrer mes données » dans l'app : envoie ton export JSON localStorage au serveur.
- **Frontend** — brancher `epargne4.html` sur toutes ces routes (connexion, données, couplage).

