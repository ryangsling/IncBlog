# IncBlog

IncBlog is a SaaS blogging platform by [incodet.com](https://incodet.com). Full-stack Node.js app with a writing dashboard, AI assistance (OpenRouter), media library, analytics, newsletter subscribers, and a public blog per user.

## Stack

- Node.js + Express, EJS server-side rendering
- SQLite via Sequelize ORM
- JWT auth in HTTP-only cookies, optional Google OAuth (Passport)
- OpenRouter API via fetch (model configurable via `OPENROUTER_MODEL`)
- `sharp` for WebP conversion + thumbnails
- Nodemailer / Resend for subscriber + verification emails
- Custom CSS, warm parchment design (light mode)

## Setup

1. Install dependencies with Node.js 22.13+ on the 22.x line or Node.js 24+:

   ```bash
   npm ci
   ```

2. Create your environment file:

   ```bash
   cp .env.example .env
   ```

   Set both `JWT_SECRET` and `SESSION_SECRET`. Run this command separately for each value and store the results in `.env` or the deployment's secret store.

   ```bash
   node -p "require('node:crypto').randomBytes(32).toString('hex')"
   ```

   Set `OPENROUTER_API_KEY` for AI, `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` for Google login, or `SMTP_*` or `RESEND_API_KEY` for email as needed.

3. Run in development (nodemon):

   ```bash
   npm run dev
   ```

   Or production:

   ```bash
   npm start
   ```

Local SQLite starts at `http://localhost:3000`, creates missing tables, and preserves existing records across restarts. Set `SEED_DEMO=true` to add the demo account and sample posts to an empty local database.

### Hosted database preparation

PostgreSQL and production SQLite startup expect a prepared database. For hosted SQLite, explicitly set `DATABASE_FILE` to a file on the persistent volume. Before deployment, verify the database target, take a backup, and use a copy to test `npm run db:prepare`. That command creates missing tables and indexes. When upgrading an existing database, preflight duplicate non-null `users."googleId"` values before adding the unique index. Resolve conflicts by verifying ownership. Production startup will refuse to enable Google sign-in without the index.

### Google account linking

Existing users sign in to IncBlog, open **Dashboard → Profile**, and confirm their IncBlog password before choosing a Google account. Google sign-in uses the linked provider subject. If a subject is already linked elsewhere, resolve ownership and any duplicate accounts before making manual changes. Google provider state is stored with the initiating browser session and consumed atomically on callback. For every production replica, use the same PostgreSQL database and schema and identical signing secrets. The database stores sessions, rate-limit counters, OAuth state, and deletion proofs across app restarts. PostgreSQL keeps these tables in `incblog_private`. Keep that schema out of Supabase’s Data API and grant access only to the app's database role. SQLite remains suitable for a single instance with a persistent file.

To review legacy Google links, inspect users with a non-null `googleId` in a read-only copy of the database. Compare the user ID, username, timestamps, whether a password exists, and the linked subject against trusted historical records. A password and a Google subject on the same row can flag candidates for review. The old code kept no linking provenance, and timestamps alone cannot identify email-based links. Verify the original IncBlog account and the Google subject independently before approving any change. Keep raw subjects, emails, and hashes private and preserve user IDs and post URLs.

### Browser writes and email confirmation

Run `npm run db:prepare` on an approved copy before rollout. It prepares the shared browser-state tables and indexes and clears legacy plaintext verification tokens. Check for duplicate Google subjects and duplicate non-null subscriber addresses within a blog before adding the unique indexes. Deploy all replicas together after approval. Existing verification links need to be replaced using **Resend verification** while signed in. Keep token query strings out of access logs.

Browser writes require an exact same-origin `Origin` or, when absent, a same-origin `Referer`. This applies to standard forms, uploads, and JSON clients. Use a stable HTTPS `BASE_URL` for Google callbacks and email links and configure SMTP or Resend for mail. Google-only users confirm account deletion with a one-time code sent to their verified email. Password users confirm with their IncBlog password. The deletion authorization is single-use and expires after 10 minutes.

Email subscribers must confirm a new subscription or reactivation. Only explicitly confirmed addresses receive mail. Legacy email subscriptions require a fresh opt-in. Account-based follows continue to work independently.

## Key URLs

| URL | Description |
| --- | --- |
| `/` | Landing page |
| `/login`, `/register` | Auth |
| `/verify-email?token=...` | Email verification (sent at signup) |
| `/dashboard` | Writer dashboard |
| `/blog/:username` | Public blog |
| `/blog/:username/:slug` | Post page |
| `/blog/:username/rss.xml` | RSS feed |
| `/blog/:username/sitemap.xml` | Sitemap |
| `/unsubscribe?token=...` | Newsletter unsubscribe |

## HTTPS and signing secret rotation

Set `BASE_URL` to your public HTTPS URL in production. For TLS terminated by a reverse proxy, set `TRUSTED_PROXIES` to the immediate proxies' IP addresses or CIDRs. Restrict direct access to the app and have the proxy overwrite untrusted forwarding headers with the actual client protocol and address. Preserve the browser-facing Host header. Leave proxy trust empty for a direct connection. The production session cookie requires Express to recognize the request as HTTPS.

To invalidate existing logins and sessions, generate two new independent values, replace both secrets, and restart every instance with the new pair. Retire instances using the old pair during the rollout. The old JWTs and session cookies will fail verification and users will sign in again. Normal restarts preserve stored sessions.

## Media and database rollout

See [private media, versioned migrations, TLS, and demo-account review](docs/MEDIA-AND-DATABASE-ROLLOUT.md).

## Public blog caching and analytics

The blog index, archives, and Explore use 20 posts per page. RSS includes at most 50 posts. Run the versioned migrations before rolling out the new reading-time, publication-revision, and view-deduplication fields and indexes. Each application replica reads the same primary database. The database increments the author revision on post changes, and the current author and settings are checked on each request. Each process caches only RSS, sitemap XML, and sanitized article bodies for up to 60 seconds. Feed cache entries also expire when the next scheduled post is due. Keep external caches out of the blog and Explore response paths, which send `Cache-Control: private, no-store`.

Article views are recorded after the response. A database uniqueness constraint deduplicates concurrent requests that share a session, and the event and counter commit together. Initial requests without a shared cookie establish independent sessions. Failed writes are logged and can be retried on a later view. The in-process queue is bounded, so a crash or overload can lose queued views.

## Custom domains and audit rollout

Set the hostname in **Dashboard → Settings**. Publish the offered TXT record and verify DNS ownership. After the hosting provider has routed the domain to IncBlog and provisioned HTTPS, designate it canonical in Settings. A verified alias can serve the blog while the platform URL remains canonical. The app never uses an arbitrary request Host to generate canonical URLs.

See the [audit rollout checklist](docs/AUDIT-ROLLOUT.md) for secret rotation, migration 5, the R2 cutover, OAuth configuration, and production-only checks.
