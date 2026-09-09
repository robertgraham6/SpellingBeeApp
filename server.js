const express     = require('express');
const path        = require('path');
const fs          = require('fs');
const compression = require('compression');
const rateLimit   = require('express-rate-limit');
const cors        = require('cors');
const helmet      = require('helmet');

const PORT      = process.env.PORT      || 3000;
const AUDIO_DIR = process.env.AUDIO_DIR || 'C:\\Users\\Robert\\Downloads\\AudioFiles\\2026';
const DIST      = path.join(__dirname, 'app', 'dist');


// Resolve CORS origins once at startup so the value is logged and auditable.
// false  → CORS headers are never sent; same-origin requests still work fine,
//          but cross-origin preflight will fail with no useful browser error.
// Set ALLOWED_ORIGINS to a comma-separated list of origins (e.g.
// "https://app.example.com,https://staging.example.com") whenever the React
// front-end is served from a different origin than this server.
const CORS_ORIGINS = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
  : false;

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
      // Explicitly allow audio served from this origin — without mediaSrc
      // the browser blocks new Audio('/audio/...') even though defaultSrc
      // is 'self'. Required for practice mode audio playback.
      mediaSrc:    ["'self'"],
      // Allow the browser to connect to Supabase (auth, database, realtime),
      // Cloudflare's analytics beacon, and itself (audio files, API calls).
      connectSrc:  [
        "'self'",
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

app.get('/audio/:filename', audioLimiter, (req, res) => {
  const filename = req.params.filename.toLowerCase().replace(/[^a-z0-9_\-.]/g, '');
  if (!filename || !filename.endsWith('.mp3')) return res.status(400).end();

  // Resolve both paths so the comparison works correctly on Windows.
  const resolvedDir = path.resolve(AUDIO_DIR);
  const filePath    = path.resolve(AUDIO_DIR, filename);
  if (!filePath.startsWith(resolvedDir + path.sep) &&
      filePath !== resolvedDir) return res.status(403).end();

  // Use fs.stat + createReadStream instead of sendFile — more reliable
  // on Windows where sendFile can fail with ENOENT despite the file existing.
  fs.stat(filePath, (statErr, stat) => {
    if (statErr) {
      return res.status(statErr.code === 'ENOENT' ? 404 : 500).end();
    }
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Content-Length', stat.size);
    const stream = fs.createReadStream(filePath);
    stream.on('error', () => { if (!res.headersSent) res.status(500).end(); });
    stream.pipe(res);
  });
});

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
