# Spelling Bee Trainer

A web application for practicing spelling bee words. An admin manages a shared word library. Parents create child profiles and assign lists. Children practice via two modes: Spelling Bee (type the word from audio) and Flashcards (see the definition, then reveal the word). Progress and difficulty ratings are tracked per child.

## Table of Contents

1. [Architecture overview](#1-architecture-overview)

2. [Prerequisites](#2-prerequisites)

3. [Project structure](#3-project-structure)

4. [Supabase setup](#4-supabase-setup)

5. [Front-end setup](#5-front-end-setup)

6. [Server setup](#6-server-setup)

7. [First-time configuration](#7-first-time-configuration)

8. [Running the app](#8-running-the-app)

9. [Roles explained](#9-roles-explained)

10. [Word list format](#10-word-list-format)

11. [Production deployment checklist](#11-production-deployment-checklist)

12. [Troubleshooting](#12-troubleshooting)

## 1. Architecture overview

```
Browser  ──► Express server (server.js)
                │
                ├── Serves built React app (app/dist/)
                └── Serves audio files (/audio/:filename.mp3)

React app  ──► Supabase (database + auth)
```

- **Front-end:** React + Vite, client-side routing via React Router

- **Back-end:** Node.js / Express — serves static files and audio only

- **Database:** Supabase (PostgreSQL + Row Level Security + Google OAuth)

- **Audio:** `.mp3` files served directly from the Express server

## 2. Prerequisites

| Tool | Version | Notes |
| - | - | - |
| Node.js | 18 or later | Download from [nodejs.org](https://nodejs.org/) — LTS version recommended. Run `node --version` in Command Prompt to verify. |
| npm | bundled with Node |  |
| A [Supabase](https://supabase.com/) project | any | Free tier is sufficient |
| A [Google Cloud](https://console.cloud.google.com/) project | any | For OAuth login |

## 3. Project structure

Place files as shown below. Files marked `(patched)` are the versions in this release.

```
project-root/
├── server.js                   ← (patched) Express server
├── app/
│   ├── index.html
│   └── src/
│       ├── App.jsx             ← (patched)
│       ├── index.css           ← (patched)
│       ├── pages/
│       │   ├── Landing.jsx     ← unchanged (not included)
│       │   ├── Login.jsx       ← unchanged (not included)
│       │   ├── Home.jsx        ← (patched, was Dashboard.jsx)
│       │   ├── WordLists.jsx   ← (patched)
│       │   ├── Review.jsx      ← (patched)
│       │   └── Practice.jsx    ← (patched)
│       ├── components/
│       │   ├── AddChildModal.jsx
│       │   ├── AddWordsModal.jsx     ← new
│       │   ├── AdminOverview.jsx     ← new
│       │   ├── AssignListModal.jsx   ← new
│       │   ├── AuthGuard.jsx
│       │   ├── EditChildModal.jsx
│       │   ├── ImportDiffModal.jsx   ← new
│       │   ├── Layout.jsx      ← unchanged (not included)
│       │   ├── Toast.jsx       ← (patched)
│       │   ├── WordDetailModal.jsx
│       │   └── WordEditModal.jsx     ← new
│       ├── context/
│       │   └── AppContext.jsx  ← (patched)
│       └── lib/
│           ├── constants.js
│           ├── db.js           ← (patched)
│           ├── normalize.js    ← unchanged (not included)
│           └── supabase.js     ← unchanged (not included)
└── audio/                      ← your .mp3 files go here
```

> **Note:** `Landing.jsx`, `Login.jsx`, `Layout.jsx`, `normalize.js`, and `supabase.js` are not included in this release as they were not modified. Keep your existing versions of those files.

## 4. Supabase setup

### 4a. Create the database schema

**For a fresh database** (no existing data):

1. Go to your Supabase project → **SQL Editor** → **New query**

2. Paste the entire contents of `schema.sql` and click **Run**

**For an existing database:**

Run the migration files in this order:

```
1. add\_admin\_support.sql   — adds admin role, app\_config table, is\_admin() function
2. add\_features.sql        — adds word overrides, descriptions, overview RPCs
3. add\_flush\_history\_batch.sql  — adds the batch history flush RPC
```

Each file is safe to re-run (`CREATE OR REPLACE`, `IF NOT EXISTS`, `DROP IF EXISTS`).

### 4b. Seed the admin email

After running the schema, designate an admin by running this in the SQL Editor (replace the email with your own):

```
INSERT INTO app\_config (admin\_email) VALUES ('robertgraham6@gmail.com');
```

> The admin account is identified by email address. The first time this email signs in, the app automatically promotes the account to `role = 'admin'`. No manual `UPDATE` is needed.

### 4c. Enable Google OAuth

1. Supabase dashboard → **Authentication** → **Providers** → **Google** → toggle **Enable**

2. Add your **Google Client ID** and **Client Secret** (from [Google Cloud Console](https://console.cloud.google.com/) → APIs & Services → Credentials → OAuth 2.0 Client)

3. Copy the **Callback URL** shown in Supabase and add it as an Authorized redirect URI in your Google OAuth client

### 4d. Configure allowed redirect URLs

Supabase dashboard → **Authentication** → **URL Configuration**:

- **Site URL:** `https://yourdomain.com`

- **Redirect URLs:** add `https://yourdomain.com/login`

For local development also add `http://localhost:3000/login`.

### 4e. Get your API credentials

Supabase dashboard → **Settings** → **API**:

- Copy the **Project URL** (looks like `https://xxxx.supabase.co`)

- Copy the **anon / public key**

## 5. Front-end setup

### 5a. Create the environment file

Create `app/.env` (never commit this file):

```
VITE\_SUPABASE\_URL=https://your-project-ref.supabase.co
VITE\_SUPABASE\_ANON\_KEY=your-anon-key-here
```

These are read by `app/src/lib/supabase.js` at build time via `import.meta.env`.

### 5b. Install dependencies

```
cd app
npm install
```

### 5c. Build the front-end

```
cd app
npm run build
```

This produces `app/dist/`. The Express server serves files from this directory. **You must rebuild after any code change.**

## 6. Server setup

### 6a. Install server dependencies

From the project root (not inside `app/`):

```
npm install express compression express-rate-limit cors helmet
```

### 6b. Environment variables

Set these before starting the server. Three common approaches on Windows:

- **Command Prompt (quick test):**

- ```
set AUDIO\_DIR=C:\\Users\\Robert\\Downloads\\SpellingBeeApp\\AudioFiles && set PORT=3000 && node server.js
```

- **PowerShell (quick test):**

- ```
$env:AUDIO\_DIR = 'C:\\Users\\YourName\\audio'; $env:PORT = 3000; node server.js
```

- **Permanent environment variables** (recommended — values survive reboots): Search Windows for **"Edit the system environment variables"** → **Environment Variables** → under *User variables* click **New**. Add `AUDIO\_DIR` and `PORT` as separate entries. Restart Command Prompt after saving.

- **Task Scheduler service** (recommended for always-on hosting — see Section 11)

| Variable | Required | Description |
| - | - | - |
| `AUDIO\_DIR` | **Yes** | Absolute path to the directory containing your `.mp3` audio files, e.g. `C:\\Users\\YourName\\audio` |
| `PORT` | No | Port to listen on. Defaults to `3000` |
| `ALLOWED\_ORIGINS` | No | Comma-separated list of allowed CORS origins. Only needed if the front-end is served from a different origin than the Express server. Omit for same-origin deployments |

> **Important:** The server will refuse to start if `AUDIO\_DIR` is not set or `app/dist/` does not exist.

### 6c. Audio file naming

The server maps each word to an audio file using **both** the normalized word and the normalized pronunciation, joined by an underscore:

```
\{normalized\_word\}\_\{normalized\_pronunciation\}.mp3
```

When a word has no pronunciation entry the pronunciation part is omitted:

```
\{normalized\_word\}.mp3
```

Normalization strips accents, lowercases, and removes everything except letters, digits, and hyphens. For example:

| Word | Pronunciation | Audio filename |
| - | - | - |
| `ephemeral` | `ih-fem-er-uhl` | `ephemeral\_ihfemeruhl.mp3` |
| `ephemeral` | *(none)* | `ephemeral.mp3` |
| `naïve` | `nah-eev` | `naive\_naheev.mp3` |
| `résumé` | `rez-oo-may` | `resume\_rezoomay.mp3` |

The pronunciation key used in the filename is the `normalized\_pronunciation` column from the `words` table — it is computed at import time by stripping accents and lowercasing the pronunciation field.

Place all `.mp3` files in the directory pointed to by `AUDIO\_DIR`.

## 7. First-time configuration

### 7a. Start the server and sign in

**Command Prompt:**

set AUDIO\_DIR=C:\\Users\\Robert\\Downloads\\SpellingBeeApp\\AudioFiles && set PORT=3000 && set SUPABASE\_URL=https://zlvnpxvfbvvikgycfuqa.supabase.co && node server.js

**PowerShell:**

```
$env:AUDIO\_DIR = 'C:\\Users\\YourName\\audio'; node server.js
```

Open `http://localhost:3000` and sign in with the Google account whose email matches the `admin\_email` you inserted into `app\_config`. On first sign-in the app creates a user row and automatically promotes it to `role = 'admin'`.

### 7b. Import the shared word library (admin)

1. Sign in with the admin account

2. Navigate to **Word Lists**

3. Click **Choose File** under "Import to Shared Library"

4. Upload a `.csv` or `.xlsx` file (see [Word list format](#10-word-list-format))

5. Review the preview and click **Confirm Import**

The imported list appears in the shared library and is visible to all parent accounts.

### 7c. Create a parent account

Sign out, then sign in with a different Google account. This account is automatically created as `role = 'parent'`.

### 7d. Add children and assign a word list

1. On the **Home** page, click **+ Add Child**

2. Enter the child's name and choose an avatar

3. Click **Change List** on the child's card

4. Select a list from the shared library or the child's personal lists

## 8. Running the app

### Development

Open two separate Command Prompt (or PowerShell) windows:

**Window 1 — front-end dev server with hot reload:**

```
cd app
npm run dev
```

**Window 2 — Express server for audio:**

```
set AUDIO\_DIR=C:\\Users\\YourName\\audio && node server.js
```

> In development the front-end dev server (usually port 5173) and the Express server (port 3000) run separately. Set `ALLOWED\_ORIGINS=http://localhost:5173` so audio requests from the dev server are allowed.

### Production

```
rem Build first
cd app
npm run build
cd ..

rem Start
set AUDIO\_DIR=C:\\Users\\YourName\\audio && set PORT=3000 && node server.js
```

The startup log confirms everything is working:

```
✅  Spelling Bee Trainer is running!
    Open:    http://localhost:3000
    Audio:   C:\\Users\\YourName\\audio
    CORS:    disabled (same-origin only)
    Health:  http://localhost:3000/health
```

## 9. Roles explained

| Role | Created by | Can do |
| - | - | - |
| `admin` | Automatic on first sign-in if email matches `app\_config.admin\_email` | Manage the shared word library, view the family overview, edit words in shared lists |
| `parent` | Automatic on first sign-in (any other Google account) | Add/manage child profiles, import word lists for children, assign lists, view progress |
| `kid` | Parent creates them on the Home page | Practice words, view their own lists, add personal word lists (if they have an email login) |

### Admin shared library vs child personal lists

- **Shared library** (`scope = 'admin'`): imported by the admin, visible to all families, assigned to children by parents or by the children themselves

- **Child personal lists** (`scope = 'child'`): created by a parent (import or manual entry) or by the child themselves; visible only to that child and their parent

## 10. Word list format

Accepted file types: `.csv`, `.txt` (pipe or comma delimited), `.xlsx`, `.xls`

The file must have a header row. Column names are matched case-insensitively and partially (e.g. `word`, `words`, `Word` all match the word column).

| Column name | Required | Notes |
| - | - | - |
| `word` | **Yes** | The spelling word |
| `id` / `number` / `rank` | No | Source row number — used for ordering |
| `bundle` | No | Group/category label |
| `definition` / `def` / `meaning` | No | Word definition |
| `pronunciation` / `ipa` | No | Pronunciation guide |
| `allowable\_spellings` | No | Comma-separated alternative accepted spellings |
| `origin` / `etymology` | No | Word origin |
| `part\_of\_speech` / `pos` | No | Noun, verb, etc. |
| `sentence` / `example` | No | Example sentence |
| `audio\_link` | No | Custom audio filename (without path or extension) |

### Manual word entry (parent/child)

Words can also be added one per line in the **Add Words Manually** modal:

```
ephemeral
ambiguous | open to more than one interpretation
persevere | continue despite difficulty
```

Use `|` to separate the word from an optional definition.

## 11. Production deployment checklist

- [ ]

- Run `npm run build` inside `app/` and confirm `app/dist/` exists

- [ ]

- Set `AUDIO\_DIR` to the production audio path (server will refuse to start without it)

- [ ]

- Run all SQL migrations in order (see [Section 4a](#4a-create-the-database-schema))

- [ ]

- Insert the admin email into `app\_config`

- [ ]

- Set the production domain in Supabase **Site URL** and **Redirect URLs**

- [ ]

- Add the production domain to your Google OAuth client's **Authorized redirect URIs**

- [ ]

- Use a process manager to keep the server running: Create `ecosystem.config.js` in the project root:

- ```
module.exports = \{
  apps: \[\{
    name: 'spelling-bee',
    script: 'server.js',
    env: \{
      PORT: 3000,
      AUDIO\_DIR: 'C:\\\\Users\\\\YourName\\\\audio',
    \},
  \}\],
\};
```

- Then in Command Prompt (run as Administrator):

- ```
npm install -g pm2
npm install -g pm2-windows-startup
pm2 start ecosystem.config.js
pm2 save
pm2-windows-startup install
```

- [ ]

- Open port 443 in Windows Firewall: Search for **Windows Defender Firewall with Advanced Security** → Inbound Rules → New Rule → Port → TCP 443 → Allow the connection

- [ ]

- Put a reverse proxy in front of Node for HTTPS — Caddy is recommended on Windows (see below). The server has `trust proxy: 1` already set

- [ ]

- If the front-end and server are on different origins, set `ALLOWED\_ORIGINS`

- [ ]

- Keep `VITE\_SUPABASE\_ANON\_KEY` out of version control — it is embedded in the built JS but should not be in your repository

### Alternative: Windows Task Scheduler

If you prefer Task Scheduler over pm2, create a batch file `start-spelling-bee.bat` in the project root:

```
@echo off
set AUDIO\_DIR=C:\\Users\\YourName\\audio
set PORT=3000
node C:\\path\\to\\project-root\\server.js
```

Then in Task Scheduler:

1. Open **Task Scheduler** → **Create Task**

2. **General** tab: give it a name, check **Run whether user is logged on or not**, check **Run with highest privileges**

3. **Triggers** tab: New → **At startup**

4. **Actions** tab: New → **Start a program** → browse to `start-spelling-bee.bat`

5. **Settings** tab: check **Restart the task if it fails**, set a 1-minute delay

6. Click **OK** and enter your Windows password when prompted

### Reverse proxy with Caddy (recommended on Windows)

Caddy automatically obtains and renews a free Let's Encrypt SSL certificate. Download it from [caddyserver.com](https://caddyserver.com/download) and place `caddy.exe` in the project root.

Create a `Caddyfile` (no extension) in the project root:

```
yourdomain.com \{
    reverse\_proxy localhost:3000
\}
```

Run Caddy (from an Administrator Command Prompt):

```
caddy run
```

To run Caddy as a Windows service so it starts automatically:

```
caddy service-install
net start caddy
```

### Alternative: nginx on Windows

If you prefer nginx, download the Windows build from [nginx.org](https://nginx.org/en/download.html) and use this config in `nginx/conf/nginx.conf`:

```
\# Redirect HTTP → HTTPS
server \{
    listen 80;
    server\_name yourdomain.com;
    return 301 https://$host$request\_uri;
\}

server \{
    listen 443 ssl;
    server\_name yourdomain.com;

    \# SSL certificate paths — use Win-ACME (https://www.win-acme.com)
    \# to obtain a free Let's Encrypt cert on Windows.
    ssl\_certificate     C:/certs/yourdomain.com/fullchain.pem;
    ssl\_certificate\_key C:/certs/yourdomain.com/privkey.pem;

    location / \{
        proxy\_pass         http://localhost:3000;
        proxy\_http\_version 1.1;
        proxy\_set\_header   Host              $host;
        proxy\_set\_header   X-Real-IP         $remote\_addr;
        proxy\_set\_header   X-Forwarded-For   $proxy\_add\_x\_forwarded\_for;
        proxy\_set\_header   X-Forwarded-Proto $scheme;
    \}
\}
```

> **Note:** Caddy is much simpler on Windows — it handles SSL certificates automatically with no extra tools.

## 12. Troubleshooting

### Server won't start — "Build directory not found"

The Vite build hasn't run. Run `cd app && npm run build` first.

### Server won't start — "AUDIO\_DIR env var is required"

Set the `AUDIO\_DIR` environment variable to the absolute path of your audio files directory (e.g. `C:\\Users\\YourName\\audio`). See Section 6b for how to set environment variables on Windows.

### Audio returns 404

- Check the file exists in `AUDIO\_DIR`

- Check the filename matches the pattern `\{normalized\_word\}\_\{normalized\_pronunciation\}.mp3` (or `\{normalized\_word\}.mp3` if no pronunciation is stored)

- Check the file is named `.mp3` (not `.MP3` or `.wav`)

### "This email address is already linked to a different account"

The email was previously used with a different Google account. Either sign in with the original account, or contact a database administrator to clear the `auth\_id` on the user row.

### Admin account shows parent UI instead of admin UI

The `app\_config` table is either empty or contains a different email. Run:

```
SELECT \* FROM app\_config;
SELECT role, email FROM users WHERE email = 'your@email.com';
```

If `app\_config` is empty, insert the correct email. If the user's role is not `'admin'`, the next sign-in will auto-promote it once `app\_config` is seeded correctly.

### Words show stale data after an edit

Clear the browser's localStorage for the site (`Application → Local Storage → Clear All` in DevTools) and reload. This forces a fresh fetch from the database.

### Supabase RLS errors ("permission denied for table...")

Run all migration files in order. If `add\_features.sql` was run before `add\_admin\_support.sql`, re-run `add\_admin\_support.sql` then re-run `add\_features.sql`.

### "function is\_admin() does not exist"

`add\_admin\_support.sql` has not been run. Run it, then re-run `add\_features.sql`.

### Progress not saving / "Progress may not have saved"

Check the browser console for Supabase errors. Common causes:

- Supabase anon key is wrong or expired

- RLS policies are blocking the write (check the migrations ran fully)

- Network connectivity issue

