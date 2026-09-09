const express     = require('express');
const path        = require('path');
const fs          = require('fs');
const compression = require('compression');
const rateLimit   = require('express-rate-limit');
const cors        = require('cors');
const helmet      = require('helmet');

const PORT      = process.env.PORT      || 3000;

const candidateAudioDirs = [
  process.env.AUDIO_DIR,
  path.join(__dirname, 'audio'),
  path.join(__dirname, 'SpellingBeeApp', 'audio'),
  path.join(process.cwd(), 'audio'),
  path.join(process.cwd(), 'SpellingBeeApp', 'audio'),
  'C:\\Users\\Robert\\Downloads\\AudioFiles\\2026',
].filter(Boolean);

const AUDIO_DIR = candidateAudioDirs.find(d => {
  try { return fs.existsSync(d); } catch { return false; }
}) || candidateAudioDirs[0];

const DIST      = path.join(__dirname, 'app', 'dist');


// Resolve CORS origins once at startup so the value is logged and auditable.
// Set ALLOWED_ORIGINS to a comma-separated list of origins if specific origins are needed.
// Defaults to '*' so client apps on dev/staging can access audio and endpoints.
const CORS_ORIGINS = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
  : '*';

// Fail fast if the Vite build hasn't run — better than a silent 500 on
// every page request after a botched deploy.
if (!fs.existsSync(DIST)) {
  console.error(`❌  Build directory not found: ${DIST}`);
  console.error('   Run the Vite build step before starting the server.');
  process.exit(1);
}

const app = express();
app.set('trust proxy', 1);

// Security headers — sets X-Content-Type-Options, X-Frame-Options,
// Referrer-Policy, and more with safe defaults.
// Read Supabase URL from env so the CSP connect-src directive is set
// to the correct project URL without hardcoding it in server code.
const SUPABASE_URL = process.env.SUPABASE_URL || '';
if (!SUPABASE_URL) {
  console.warn('⚠️  SUPABASE_URL env var not set — Content Security Policy will not allow Supabase connections.');
}

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc:  ["'self'"],
      // Cloudflare injects its beacon script into proxied pages —
      // allow it so the CSP doesn't generate noise in the console.
      scriptSrc:   ["'self'", 'https://static.cloudflareinsights.com'],
      styleSrc:    ["'self'", 'https://fonts.googleapis.com'],
      fontSrc:     ["'self'", 'https://fonts.gstatic.com'],
      imgSrc:      ["'self'", 'data:'],
      // Explicitly allow audio served from this origin and spellingbeetest.online
      // Required for practice mode and word detail audio playback.
      mediaSrc:    ["'self'", 'https://spellingbeetest.online'],
      // Allow the browser to connect to Supabase (auth, database, realtime),
      // Cloudflare's analytics beacon, and itself (audio files, API calls).
      connectSrc:  [
        "'self'",
        'https://spellingbeetest.online',
        ...(SUPABASE_URL ? [SUPABASE_URL] : []),
        'https://static.cloudflareinsights.com',
        'https://cloudflareinsights.com',
      ],
    },
  },
}));

app.use(cors({
  origin:         CORS_ORIGINS,
  methods:        ['GET'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

// ── Compression — skip already-compressed audio ───────────────────────────────
app.use(compression({
  filter(req, res) {
    if (req.path.startsWith('/audio/')) return false;
    return compression.filter(req, res);
  }
}));

// ── Static assets ─────────────────────────────────────────────────────────────
app.use(express.static(DIST, {
  maxAge: '1y',
  setHeaders(res, filePath) {
    if (path.basename(filePath) === 'index.html') {
      res.setHeader('Cache-Control', 'no-cache');
    }
  }
}));

// ── Audio — rate limited, safe filename, long cache on success ────────────────
const audioLimiter = rateLimit({
  windowMs: 60_000, max: 120,
  standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many audio requests \u2014 please slow down.' }
});

function serveAudioFile(req, res) {
  const rawParam = req.params.filename || '';
  const filename = rawParam.toLowerCase().replace(/[^a-z0-9_\-.]/g, '');
  if (!filename || !filename.endsWith('.mp3')) return res.status(400).end();

  // Try configured AUDIO_DIR first, then any other candidate audio directories
  const searchDirs = [
    AUDIO_DIR,
    path.join(__dirname, 'audio'),
    path.join(__dirname, 'SpellingBeeApp', 'audio'),
    path.join(process.cwd(), 'audio'),
    path.join(process.cwd(), 'SpellingBeeApp', 'audio'),
  ].filter((d, i, arr) => d && arr.indexOf(d) === i);

  let targetPath = null;
  for (const dir of searchDirs) {
    try {
      const resolvedDir = path.resolve(dir);
      const candidatePath = path.resolve(dir, filename);
      if ((candidatePath.startsWith(resolvedDir + path.sep) || candidatePath === resolvedDir) && fs.existsSync(candidatePath)) {
        targetPath = candidatePath;
        break;
      }
    } catch {
      // Continue to next directory
    }
  }

  if (!targetPath) {
    return res.status(404).end();
  }

  fs.stat(targetPath, (statErr, stat) => {
    if (statErr) {
      return res.status(statErr.code === 'ENOENT' ? 404 : 500).end();
    }
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Content-Length', stat.size);
    const stream = fs.createReadStream(targetPath);
    stream.on('error', () => { if (!res.headersSent) res.status(500).end(); });
    stream.pipe(res);
  });
}

app.get('/audio/:filename', audioLimiter, serveAudioFile);
app.get('/:filename([a-z0-9_\\-]+\\.mp3)', audioLimiter, serveAudioFile);

// ── React Router fallback ─────────────────────────────────────────────────────
app.get('/{*splat}', (_req, res) => {
  res.sendFile(path.join(DIST, 'index.html'));
});

// ── Start ─────────────────────────────────────────────────────────────────────
// The server runs plain HTTP on localhost. HTTPS is provided externally by
// Cloudflare Tunnel, which proxies spellingbeetest.online → localhost:PORT.
// localhost:PORT remains accessible directly for local development and testing.
const corsMode = CORS_ORIGINS
  ? CORS_ORIGINS.join(', ')
  : 'disabled (same-origin only) — set ALLOWED_ORIGINS to enable';

const server = app.listen(PORT, '0.0.0.0', () => {
  if (!CORS_ORIGINS) console.warn('\u26a0\ufe0f  CORS is disabled. Cross-origin requests will fail without a useful browser error. Set ALLOWED_ORIGINS if your front-end is on a different origin.');
  console.log('');
  console.log('\u2705  Spelling Bee Trainer is running!');
  console.log(`    Local:   http://localhost:${PORT}`);
  console.log(`    Public:  https://spellingbeetest.online (via Cloudflare Tunnel)`);
  console.log(`    Audio:   ${AUDIO_DIR}`);
  console.log(`    CORS:    ${corsMode}`);
  console.log(`    Health:  http://localhost:${PORT}/health`);
  console.log('');
});

function shutdown(signal) {
  console.log(`\n${signal} received \u2014 shutting down gracefully\u2026`);
  server.close(() => { console.log('Server closed.'); process.exit(0); });
  setTimeout(() => process.exit(1), 10_000);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));
