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

## Et après ?

- **B2** — Auth : `POST /api/auth/register` (identifiant + PIN hashé) et `/api/auth/login` (→ JWT).
- **B3** — Données : `GET/PUT /api/data/perso` et `/api/data/commun`, protégés par le JWT.
- **B4** — Couplage via `couple_code`.
- **B5** — WebSocket pour l'espace commun.
- **B6** — Bouton « migrer mes données » : envoie ton export JSON localStorage au serveur.

Quand le `/api/health` répond `ok`, B1 est validé — on passe à B2.
