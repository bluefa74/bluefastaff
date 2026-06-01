// ─────────────────────────────────────────────────────────────────────────────
//  server.js — HorizonPvP Staff Dashboard — Backend
// ─────────────────────────────────────────────────────────────────────────────

require('dotenv').config();
const express    = require('express');
const session    = require('express-session');
const multer     = require('multer');
const path       = require('path');
const fs         = require('fs');
const fetch      = (...a) => import('node-fetch').then(({default: f}) => f(...a));

const app  = express();
const PORT = process.env.PORT || 3000;

// ─── CONFIG ──────────────────────────────────────────────────────────────────
const CONFIG = {
  DISCORD_CLIENT_ID:     process.env.DISCORD_CLIENT_ID,
  DISCORD_CLIENT_SECRET: process.env.DISCORD_CLIENT_SECRET,
  DISCORD_REDIRECT_URI:  process.env.DISCORD_REDIRECT_URI || `http://localhost:${PORT}/auth/callback`,
  GUILD_ID:              process.env.GUILD_ID,
  STAFF_ROLE_ID:         process.env.STAFF_ROLE_ID         || '1505217107112104056',
  GERANT_ROLE_ID:        process.env.GERANT_ROLE_ID,       // rôle gérant staff (accès à tous les zips)
  SESSION_SECRET:        process.env.SESSION_SECRET        || 'horizonpvp-secret-key-change-me',
  BOT_TOKEN:             process.env.DISCORD_BOT_TOKEN,
};

// ─── DOSSIERS DATA ────────────────────────────────────────────────────────────
const DATA_DIR  = path.join(__dirname, 'data');
const ZIPS_DIR  = path.join(DATA_DIR, 'zips');
const STATS_FILE = path.join(DATA_DIR, 'stats.json');

[DATA_DIR, ZIPS_DIR].forEach(d => { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); });

function loadStats() {
  if (!fs.existsSync(STATS_FILE)) fs.writeFileSync(STATS_FILE, '{}');
  return JSON.parse(fs.readFileSync(STATS_FILE, 'utf8'));
}
function saveStats(d) { fs.writeFileSync(STATS_FILE, JSON.stringify(d, null, 2)); }

// ─── MULTER (upload zip) ──────────────────────────────────────────────────────
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, ZIPS_DIR),
  filename: (req, file, cb) => {
    const userId = req.session?.user?.id || 'unknown';
    const date   = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    cb(null, `${userId}_${date}.zip`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB max
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/zip' || file.originalname.endsWith('.zip'))
      cb(null, true);
    else cb(new Error('Seuls les fichiers .zip sont acceptés'));
  },
});

// ─── MIDDLEWARES ──────────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: CONFIG.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, maxAge: 7 * 24 * 60 * 60 * 1000 },
}));
app.use(express.static(path.join(__dirname, 'public')));

// ─── HELPERS AUTH ──────────────────────────────────────────────────────────────
async function getDiscordUser(accessToken) {
  const res = await fetch('https://discord.com/api/users/@me', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return res.json();
}

async function getUserGuildMember(userId) {
  if (!CONFIG.BOT_TOKEN || !CONFIG.GUILD_ID) return null;
  const res = await fetch(`https://discord.com/api/guilds/${CONFIG.GUILD_ID}/members/${userId}`, {
    headers: { Authorization: `Bot ${CONFIG.BOT_TOKEN}` },
  });
  if (!res.ok) return null;
  return res.json();
}

function isStaff(member) {
  if (!member?.roles) return false;
  return member.roles.includes(CONFIG.STAFF_ROLE_ID) ||
         member.roles.includes(CONFIG.GERANT_ROLE_ID) ||
         member.permissions === '8'; // Administrator
}

function isGerant(member) {
  if (!member?.roles) return false;
  return member.roles.includes(CONFIG.GERANT_ROLE_ID);
}

function requireAuth(req, res, next) {
  if (!req.session?.user) return res.status(401).json({ error: 'Non connecté' });
  next();
}
function requireStaff(req, res, next) {
  if (!req.session?.user) return res.status(401).json({ error: 'Non connecté' });
  if (!req.session.isStaff) return res.status(403).json({ error: 'Accès refusé — Staff requis' });
  next();
}
function requireGerant(req, res, next) {
  if (!req.session?.user) return res.status(401).json({ error: 'Non connecté' });
  if (!req.session.isGerant) return res.status(403).json({ error: 'Accès refusé — Gérant requis' });
  next();
}

// ─── OAUTH DISCORD ────────────────────────────────────────────────────────────
app.get('/auth/login', (req, res) => {
  const params = new URLSearchParams({
    client_id:     CONFIG.DISCORD_CLIENT_ID,
    redirect_uri:  CONFIG.DISCORD_REDIRECT_URI,
    response_type: 'code',
    scope:         'identify guilds.members.read',
  });
  res.redirect(`https://discord.com/api/oauth2/authorize?${params}`);
});

app.get('/auth/callback', async (req, res) => {
  const { code } = req.query;
  if (!code) return res.redirect('/?error=no_code');

  try {
    // Échange du code contre un token
    const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id:     CONFIG.DISCORD_CLIENT_ID,
        client_secret: CONFIG.DISCORD_CLIENT_SECRET,
        grant_type:    'authorization_code',
        code,
        redirect_uri:  CONFIG.DISCORD_REDIRECT_URI,
      }),
    });
    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) return res.redirect('/?error=token_failed');

    // Récupère l'utilisateur Discord
    const user   = await getDiscordUser(tokenData.access_token);
    const member = await getUserGuildMember(user.id);

    if (!isStaff(member)) {
      req.session.destroy();
      return res.redirect('/?error=not_staff');
    }

    // Sauvegarde en session
    req.session.user = {
      id:            user.id,
      username:      user.username,
      discriminator: user.discriminator,
      avatar:        user.avatar,
      globalName:    user.global_name,
    };
    req.session.isStaff  = true;
    req.session.isGerant = isGerant(member);
    req.session.member   = { roles: member?.roles || [], nick: member?.nick };

    // Init stats si premier login
    const stats = loadStats();
    if (!stats[user.id]) {
      stats[user.id] = { userId: user.id, username: user.username, claims: 0, claimedTickets: [], zips: [] };
      saveStats(stats);
    } else {
      // Mise à jour du username
      stats[user.id].username = user.username;
      saveStats(stats);
    }

    res.redirect('/dashboard');
  } catch (err) {
    console.error('OAuth error:', err);
    res.redirect('/?error=oauth_error');
  }
});

app.get('/auth/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/');
});

// ─── API — MOI ────────────────────────────────────────────────────────────────
app.get('/api/me', requireAuth, (req, res) => {
  const stats    = loadStats();
  const myStats  = stats[req.session.user.id] || {};
  res.json({
    user:      req.session.user,
    isGerant:  req.session.isGerant,
    isStaff:   req.session.isStaff,
    claims:    myStats.claims || 0,
    claimedTickets: myStats.claimedTickets || [],
    zips:      myStats.zips || [],
  });
});

// ─── API — LEADERBOARD ────────────────────────────────────────────────────────
app.get('/api/leaderboard', requireStaff, (req, res) => {
  const stats = loadStats();
  const list  = Object.values(stats)
    .sort((a, b) => (b.claims || 0) - (a.claims || 0))
    .map(s => ({
      userId:   s.userId,
      username: s.username,
      claims:   s.claims || 0,
      zipCount: (s.zips || []).length,
      lastClaim: s.lastClaim || null,
    }));
  res.json(list);
});

// ─── API — UPLOAD ZIP ─────────────────────────────────────────────────────────
app.post('/api/upload-zip', requireStaff, upload.single('zipFile'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Aucun fichier reçu' });

  const stats    = loadStats();
  const userId   = req.session.user.id;
  if (!stats[userId]) stats[userId] = { userId, username: req.session.user.username, claims: 0, claimedTickets: [], zips: [] };

  const zipEntry = {
    filename:    req.file.filename,
    originalName: req.file.originalname,
    size:        req.file.size,
    uploadedAt:  new Date().toISOString(),
    period:      req.body.period || 'Non précisé',
    note:        req.body.note || '',
  };

  stats[userId].zips.push(zipEntry);
  saveStats(stats);

  res.json({ success: true, file: zipEntry });
});

// ─── API — LISTE TOUS LES ZIPS (gérant) ──────────────────────────────────────
app.get('/api/all-zips', requireGerant, (req, res) => {
  const stats = loadStats();
  const allZips = [];
  for (const [userId, data] of Object.entries(stats)) {
    for (const zip of (data.zips || [])) {
      allZips.push({ ...zip, userId, username: data.username });
    }
  }
  allZips.sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt));
  res.json(allZips);
});

// ─── API — TÉLÉCHARGER UN ZIP (gérant ou propriétaire) ────────────────────────
app.get('/api/download-zip/:filename', requireStaff, (req, res) => {
  const { filename } = req.params;
  const userId = req.session.user.id;
  const stats  = loadStats();

  // Vérif : gérant peut tout télécharger, staff seulement les siens
  const isOwner = filename.startsWith(userId + '_');
  if (!req.session.isGerant && !isOwner)
    return res.status(403).json({ error: 'Accès refusé' });

  const filePath = path.join(ZIPS_DIR, filename);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Fichier introuvable' });

  res.download(filePath);
});

// ─── API — SUPPRIMER UN ZIP (gérant) ──────────────────────────────────────────
app.delete('/api/delete-zip/:filename', requireGerant, (req, res) => {
  const { filename } = req.params;
  const filePath = path.join(ZIPS_DIR, filename);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

  // Retirer de stats.json
  const stats = loadStats();
  for (const data of Object.values(stats)) {
    data.zips = (data.zips || []).filter(z => z.filename !== filename);
  }
  saveStats(stats);
  res.json({ success: true });
});

// ─── API INTERNE — Webhook depuis le bot Discord (claim) ─────────────────────
// Le bot appelle cette route quand un staff claim un ticket
app.post('/api/bot/claim', (req, res) => {
  const apiKey = req.headers['x-api-key'];
  if (apiKey !== process.env.INTERNAL_API_KEY) return res.status(401).json({ error: 'Unauthorized' });

  const { userId, username, ticketId, ticketName, category } = req.body;
  if (!userId) return res.status(400).json({ error: 'userId requis' });

  const stats = loadStats();
  if (!stats[userId]) {
    stats[userId] = { userId, username: username || 'Inconnu', claims: 0, claimedTickets: [], zips: [] };
  }

  stats[userId].claims = (stats[userId].claims || 0) + 1;
  stats[userId].username = username || stats[userId].username;
  stats[userId].lastClaim = new Date().toISOString();
  stats[userId].claimedTickets.push({
    ticketId,
    ticketName,
    category: category || 'N/A',
    claimedAt: new Date().toISOString(),
  });

  // Garder seulement les 50 derniers tickets
  if (stats[userId].claimedTickets.length > 50)
    stats[userId].claimedTickets = stats[userId].claimedTickets.slice(-50);

  saveStats(stats);
  res.json({ success: true, claims: stats[userId].claims });
});

// ─── PAGES ────────────────────────────────────────────────────────────────────
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/dashboard', requireAuth, (req, res) => res.sendFile(path.join(__dirname, 'public', 'dashboard.html')));
app.get('/gerant', requireGerant, (req, res) => res.sendFile(path.join(__dirname, 'public', 'gerant.html')));

// ─── START ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => console.log(`🚀 HorizonPvP Staff Dashboard — http://localhost:${PORT}`));
