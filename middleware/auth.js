// ── Vérifie le JWT envoyé dans l'en-tête Authorization: Bearer <token> ──
// Servira en B3 pour protéger les routes de données.
const jwt = require('jsonwebtoken');

function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Token manquant' });
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET); // { uid, identifiant, ... }
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Token invalide ou expiré' });
  }
}

module.exports = { requireAuth };
