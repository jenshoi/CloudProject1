// src/auth/auth.js - bruker jason web tokens
const jwt = require('jsonwebtoken');

// Hardcoded users
const users = [
  { role: 'admin', username: 'Jens', password: 'JensErDum' },
  { role: 'user', username: 'Anne', password: 'AnneErPen' },
  { role: 'user', username: 'Orjan', password: 'OrjanStemmerFRP'}
];

if (!process.env.JWT_SECRET) throw new Error("JWT_SECRET mangler i .env");
const SECRET = process.env.JWT_SECRET; // JWT token


// Login-funksjon
function login(req, res) {
  const { username, password } = req.body;
  const user = users.find(u => u.username === username && u.password === password);
  if (!user) {
    return res.status(401).json({ error: "Invalid credentials" });
  }
  // Token som varer i 30 dager
  const token = jwt.sign({ username: user.username, role: user.role }, SECRET, { expiresIn: '30d' });
  res.json({ token });
}

// Sjekker at token er gyldig.
function authMiddleware(req, res, next) {
  const authHeader = req.headers['authorization'];
  if (!authHeader) return res.status(401).json({ error: "Missing token" });

  const token = authHeader.split(' ')[1];
  jwt.verify(token, SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: "Invalid token" });
    req.user = user;
    next();
  });
}

function requireAdmin(req, res, next) {
  if (req.user?.role === 'admin') return next();
    return res.status(403).json({ error: 'admin only' });
}
module.exports = { login, authMiddleware, requireAdmin };

