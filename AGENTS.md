# IncBlog

## Business Requirements

This project is building a white-label SaaS blogging platform for developers, indie makers, and solopreneurs, where each user gets their own blog served from a custom domain. Key features:

- Authentication — email + password and Google OAuth, with per-user profile (name, bio, avatar)
- Post editor — Markdown with live preview, draft / published / scheduled states, categories and tags
- Media library — image upload, automatic WebP conversion, thumbnail generation
- SEO — custom meta title, description, OG image per post, auto-generated XML sitemap
- Custom domain — each user maps their own domain to their blog; routing handled server-side
- Analytics — total view count and per-post view count; 30-day daily chart in the dashboard
- AI writing features — one-click excerpt, summary, and title suggestions powered by the Claude API
- Public blog — clean reader view per user served at `/blog/:username` or via custom domain
- Landing page — polished, conversion-focused marketing page at `/` for visitors who are not logged in; this is the primary first impression of the product and must look production-ready

## Limitations

V1 (MVP) ships without: social auto-posting, newsletter sending, revision history, multi-author / role-based permissions, WordPress import, REST API for headless usage, monetization, theme marketplace, mobile app, or any payment gateway integration. Newsletter subscriber collection UI exists but email delivery is not wired in V1.

## Technical Decisions

- **Frontend**: EJS templates (server-rendered), vanilla CSS with CSS custom properties, vanilla JS for editor interactivity; JetBrains Mono for code and logo elements
- **Backend**: Node.js + Express.js (custom app, not Ghost CMS); session-based auth via express-session + Passport.js
- **ORM / Database**: Sequelize with SQLite in development, PostgreSQL in production (Railway-managed)
- **Media storage**: Sharp for WebP conversion; local filesystem in development, Cloudflare R2 via S3-compatible API in production
- **Email**: Nodemailer in development, Resend.com (via SMTP or API) in production
- **AI**: Anthropic Claude API (`@anthropic-ai/sdk`), model configurable via `ANTHROPIC_MODEL` env var
- **Deployment**: Railway.app — single service, PostgreSQL add-on, environment variables in Railway dashboard
- **Package manager**: npm
- **Dev tooling**: nodemon for local development; no build step (no bundler, no transpile)

## Starting Point

Substantial scaffold already exists. The following are complete and functional on SQLite:

- All Sequelize models: `User`, `Post`, `Category`, `Tag`, `PostTag`, `Media`, `PageView`, `Subscriber`, `Setting`
- All Express routes and controllers: auth, dashboard, posts, media, analytics, subscribers, settings, blog (public), AI
- All EJS views: landing page, auth (login/register), full dashboard (posts, editor, media, analytics, subscribers, settings, profile), public blog (index, archive, post), 404, unsubscribe
- Auth middleware (JWT + session), custom domain routing middleware, upload middleware (Sharp/WebP), Passport Google OAuth
- AI controller: excerpt, summary, and title suggestions via Claude

What still needs to be done before production:
1. Migrate database dialect from SQLite to PostgreSQL
2. Replace local file storage with Cloudflare R2
3. Wire email sending via Resend
4. Add XML sitemap endpoint
5. Add scheduled-post cron job to auto-publish on time
6. Build custom domain DNS setup UX (instructions + verification)
7. JSON data export endpoint
8. Write automated tests
9. Deploy to Railway with production environment variables

## Color Scheme

- Accent: `#3b82f6` — buttons, links, highlights, active nav states
- Accent hover: `#2563eb` — hover state for accent elements
- Primary text: `#e5e5e5` — body text (dark mode)
- Surface: `#1a1a1a` — cards, panels, sidebar background
- Background: `#0f0f0f` — page background (dark mode)
- Border / muted: `#2a2a2a` / `#9ca3af` — dividers, placeholder text, secondary labels
- Danger: `#ef4444` — destructive actions
- Success: `#22c55e` — confirmations

Light mode overrides live in `[data-theme="light"]` CSS block.

## Coding Standards

1. Use latest versions of libraries and idiomatic approaches as of today
2. Keep it simple - NEVER over-engineer, ALWAYS simplify, NO unnecessary defensive programming. No extra features - focus on simplicity.
3. Be concise. Keep README minimal. IMPORTANT: no emojis ever
4. When hitting issues, always identify root cause before trying a fix. Do not guess. Prove with evidence, then fix the root cause.

## Working Documentation

All documents for planning and executing this project will be in the docs/ directory.
Please review the docs/PLAN.md document before proceeding.
