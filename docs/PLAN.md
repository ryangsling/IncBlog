# Project Plan - IncBlog MVP

## Goal and approach

Build a production-ready white-label SaaS blogging platform with:
1. PostgreSQL-backed data store (migrated from SQLite scaffold)
2. Cloudflare R2 for media storage (replacing local filesystem)
3. Resend for transactional email
4. Railway.app deployment with environment-driven config

The scaffold covers all routes, models, controllers, and views. Every remaining part is about hardening, wiring external services, and shipping to production.

Execution will proceed in gated phases. Part 1 is a hard gate: no implementation beyond planning until plan approval.

## Quality bar and testing policy

- Unit coverage target: **minimum 80%**, with emphasis on critical behavior, not metric gaming.
- Integration testing: robust API + frontend/backend flow coverage for core user journeys.
- E2E testing: at least one happy path plus selected failure-path checks for key flows.

## Current implementation status

- **Completed:** All Sequelize models, all Express routes and controllers, all EJS views, auth (email + Google OAuth), Markdown editor, media upload with Sharp, analytics, subscribers, settings, AI features (Claude), custom domain routing middleware
- **Pending:** Parts 1 through 9

## Confirmed design decisions

- No Ghost CMS — custom Express.js app (already fully scaffolded)
- SQLite for local development, PostgreSQL for production via `DATABASE_URL` env var
- Cloudflare R2 used only in production; local `public/uploads` used in development
- Resend used only in production; Nodemailer with local SMTP used in development
- All environment-specific behavior gated on env vars (`NODE_ENV`, `DATABASE_URL`, `R2_*`, `RESEND_API_KEY`)

---

## Part 1 - Planning and project baseline (hard gate)

**Status:** In progress

### Tasks

- [x] Confirm requirements, technical constraints, and coding standards in root `AGENTS.md`
- [x] Expand this plan with implementation checklists, tests, and success criteria for each phase
- [ ] Pause and wait for explicit user approval before starting implementation

### Tests

- [x] Documentation quality check: all phases include actionable tasks, tests, and completion criteria

### Success criteria

- [x] Plan is clear enough to execute phase-by-phase without ambiguity
- [ ] User explicitly approves plan before Part 2 starts

---

## Part 2 - PostgreSQL migration

**Status:** Done

Switch the Sequelize dialect from SQLite to PostgreSQL for production. Development stays on SQLite. The switch must be transparent — one `DATABASE_URL` env var selects the dialect at startup.

### Tasks

- [x] Install `pg` and `pg-hstore` npm packages
- [x] Update `src/models/index.js`: if `DATABASE_URL` is set, use `dialect: 'postgres'` with the URL; otherwise keep SQLite
- [x] Ensure `sequelize.sync()` still works for both dialects (no raw SQL dialect-specific queries in models)
- [x] Add `.env.example` documenting `DATABASE_URL`, `SESSION_SECRET`, `BASE_URL`, `PORT`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`
- [x] Verify seed data runs cleanly against a local PostgreSQL instance

### Tests

- [x] Start app with `DATABASE_URL` pointing to a local PostgreSQL DB — all tables created, seed runs without error
- [x] Start app without `DATABASE_URL` — SQLite path still works as before
- [x] Create a post, upload an image, register a user — all persist correctly in PostgreSQL

### Success criteria

- [x] Single codebase supports both dialects via env var with no code changes
- [x] No SQLite-specific syntax or dialect options remain in model definitions

---

> **PAUSE 1 - Before Part 3 (External accounts setup)**
>
> The developer must:
> 1. Create a Cloudflare account at https://dash.cloudflare.com and enable R2 (requires billing info but free tier is sufficient for MVP)
> 2. Create an R2 bucket named `incblog-media` (or similar), note the bucket name and account ID
> 3. Create an R2 API token with "Object Read & Write" permission; note `R2_ACCESS_KEY_ID` and `R2_SECRET_ACCESS_KEY`
> 4. Note the R2 public URL or configure a custom domain for the bucket (e.g. `https://media.incblog.incodet.com`)
> 5. Create a Railway account at https://railway.app and start a new project
> 6. Add a PostgreSQL add-on to the Railway project; note the `DATABASE_URL` connection string
> 7. Create a Resend account at https://resend.com, verify your sending domain, and generate an API key; note `RESEND_API_KEY` and `RESEND_FROM` address
> 8. Create a Google Cloud project at https://console.cloud.google.com, enable Google+ API, create OAuth 2.0 credentials (Web application), set the redirect URI to `https://your-domain/auth/google/callback`; note `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`
> 9. Add all noted values to a local `.env` file using `.env.example` as the template
>
> Confirm to the agent: "External accounts ready"

---

## Part 3 - Cloudflare R2 media storage

**Status:** Done

Replace local filesystem writes in `src/middleware/upload.js` with Cloudflare R2 uploads in production. Development continues using local `public/uploads`.

### Tasks

- [x] Install `@aws-sdk/client-s3` (S3-compatible SDK for R2)
- [x] Add env vars to `.env.example`: `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `R2_PUBLIC_URL`
- [x] Rewrite `src/middleware/upload.js`:
  - In production (`R2_BUCKET` is set): after Sharp converts to WebP in memory, upload the buffer to R2 using `PutObjectCommand`; return the public R2 URL
  - In development: keep existing local filesystem path unchanged
  - `deleteUploadByUrl` must also branch: delete from R2 in production, delete local file in development
- [x] Update `src/controllers/mediaController.js` delete handler to call `deleteUploadByUrl` correctly with the new logic
- [x] Update `src/controllers/settingsController.js` deleteAccount to await async delete calls
- [x] Ensure `postController.js` image fields use the returned URL without hardcoding `/uploads/` prefix assumptions

### Tests

- [ ] Upload an image in production mode (with R2 env vars set) — file appears in R2 bucket, URL is a public R2/CDN URL, record saved to DB
- [ ] Delete a media item — file is removed from R2 bucket, DB record deleted
- [ ] Upload an image in dev mode (no R2 env vars) — file saved locally as before
- [ ] Image URLs in blog post render correctly in both modes

### Success criteria

- [x] No local files written when `R2_BUCKET` is set
- [x] Media deletion is consistent: both DB record and object storage entry are removed

---

## Part 4 - Resend email integration

**Status:** Done

Wire transactional emails through Resend in production. Development uses Nodemailer's SMTP (or Ethereal for testing). The only email sent in V1 is the subscriber confirmation / unsubscribe flow.

### Tasks

- [x] Install `resend` npm package
- [x] Update `src/middleware/mailer.js`:
  - If `RESEND_API_KEY` is set, send via Resend SDK (`new Resend(key).emails.send(...)`)
  - Otherwise, fall back to the existing Nodemailer transporter (development)
- [x] Expose a single `sendMail({ to, subject, html })` function from the module — callers do not change
- [x] Add `RESEND_FROM` env var (e.g. `IncBlog <hello@incblog.incodet.com>`) to `.env.example`
- [x] Verify `subscriberController.js` calls `sendMail` correctly for confirmation emails

### Tests

- [ ] With `RESEND_API_KEY` set: call `sendMail` — Resend API is hit, email delivered (check Resend dashboard)
- [ ] Without `RESEND_API_KEY`: Nodemailer fallback fires, no crash
- [ ] Subscriber signup flow triggers confirmation email end-to-end

### Success criteria

- [x] Email delivery works in production without code changes
- [x] No hardcoded sender addresses — all read from env vars

---

## Part 5 - XML sitemap and scheduled post cron

**Status:** Done

Two independent features that make the product complete for SEO and publishing workflow.

### Tasks

**XML sitemap**
- [x] Add route `GET /sitemap.xml` in `src/routes/blog.js` (already existed)
- [x] Controller queries all published posts for the blog, formats a valid XML sitemap with `<loc>`, `<lastmod>`, and `<changefreq>`
- [x] Return `Content-Type: application/xml`

**Scheduled post cron**
- [x] Install `node-cron` npm package
- [x] Create `src/cron.js`: exports `startCron()` that runs every minute; queries posts where `status = 'scheduled'` and `publishAt <= NOW()`, updates each to `status = 'published'`
- [x] Call `startCron()` in `app.js` after `initDb()` resolves

### Tests

- [ ] Request `/sitemap.xml` for a user with published posts — valid XML, all published post URLs present, scheduled/draft posts absent
- [ ] Create a post with `status = scheduled` and `publishAt` set 1 minute in the future; wait for cron tick — post is now `published`
- [ ] Cron does not crash when no scheduled posts exist

### Success criteria

- [x] Sitemap validates against the sitemap.org schema
- [x] Scheduled posts auto-publish within 60 seconds of their `publishAt` time

---

## Part 6 - Custom domain DNS setup flow

**Status:** Pending

Give users clear, actionable instructions for pointing their domain to their IncBlog instance. V1 is informational only — no automated DNS verification API call is needed.

### Tasks

- [ ] Add a "Custom Domain" section to `src/views/dashboard/settings.ejs` (or a dedicated sub-page):
  - Input field to save `customDomain` on the User record (already in the model)
  - After saving, display a step-by-step DNS instruction block:
    - Add a `CNAME` record pointing their domain to the IncBlog host (read from `BASE_URL` env var)
    - Note TTL of 300s or lower for fast propagation
    - Note that HTTPS is handled by Railway's TLS termination / Cloudflare proxy
  - Display current status: "Not configured", "Configured — pending DNS propagation", or "Active" (determined by whether a request arrived via that domain, not a live DNS check)
- [ ] Update `settingsController.js` to save/clear `customDomain` and re-render with instructions

### Tests

- [ ] Save a custom domain in settings — `User.customDomain` is updated in the DB
- [ ] DNS instruction block renders with the correct CNAME target from `BASE_URL`
- [ ] Clear the custom domain — `User.customDomain` is set to null, instructions disappear
- [ ] Existing custom domain routing middleware still resolves correctly after domain is saved

### Success criteria

- [ ] User can self-serve their custom domain setup without contacting support
- [ ] No automated DNS check or external API call is required in V1

---

## Part 7 - JSON data export

**Status:** Pending

Users can download a full export of their data (posts, settings, subscribers) as a single JSON file.

### Tasks

- [ ] Add route `GET /dashboard/settings/export` in `src/routes/settings.js`
- [ ] Controller queries all posts (with tags + category), all subscribers, and the user's settings; serialises to JSON; responds with `Content-Disposition: attachment; filename="incblog-export.json"` and `Content-Type: application/json`
- [ ] Add an "Export data" button to `src/views/dashboard/settings.ejs` linking to the export route
- [ ] Exported JSON shape: `{ exportedAt, user: { name, email, username, bio }, settings: {...}, posts: [...], subscribers: [...] }`

### Tests

- [ ] Authenticated user hits the export route — receives a valid JSON file download
- [ ] Unauthenticated request is redirected to login (auth middleware already covers this)
- [ ] Export includes all post fields, all tags, category name, and subscriber emails

### Success criteria

- [ ] Export file is valid JSON parseable without errors
- [ ] No sensitive fields (passwordHash, token) are included in the export

---

## Part 8 - Automated tests

**Status:** Pending

Establish a test suite covering critical paths.

### Tasks

- [ ] Install `jest`, `supertest` as dev dependencies
- [ ] Add `"test": "jest"` script to `package.json`
- [ ] Create `tests/` directory with:
  - `auth.test.js` — register, login, logout flows; Google OAuth stubbed
  - `posts.test.js` — create, read, update, delete a post; status transitions
  - `media.test.js` — upload an image (mock Sharp and R2 calls); delete
  - `analytics.test.js` — page view recording; 30-day chart data shape
  - `sitemap.test.js` — sitemap renders valid XML for a user with published posts
  - `cron.test.js` — scheduled post status flip logic (unit test the query + update logic, not the timer)
  - `export.test.js` — export route returns correct JSON shape, excludes sensitive fields
  - `database.test.js` — verify SQLite dialect works without DATABASE_URL; verify PostgreSQL dialect selected when DATABASE_URL is set; seed runs on both
  - `upload-r2.test.js` — processImage returns local path when R2_BUCKET is unset; returns R2 URL when R2_BUCKET is set; deleteUploadByUrl removes from R2 in prod mode, local in dev mode (mock S3Client)
  - `mailer.test.js` — sendMail uses Resend SDK when RESEND_API_KEY is set; falls back to Nodemailer when unset; sendMail returns true on success, false on failure (mock both)
- [ ] Use an in-memory SQLite database (`:memory:`) for all tests; no network calls; mock R2 and Resend modules
- [ ] Achieve minimum 80% line coverage across `src/controllers/` and `src/middleware/`

### Tests

*(This part is itself a testing phase; the tests listed above are the deliverables.)*

### Success criteria

- [ ] `npm test` passes with zero failures
- [ ] Coverage report shows >= 80% line coverage for `controllers/` and `middleware/`
- [ ] No test depends on real external services (R2, Resend, Claude, Google OAuth)

---

## Part 9 - Landing page design

**Status:** Pending

The landing page at `/` is the primary marketing surface and first impression of the product. It must look production-ready, conversion-focused, and consistent with the dark-mode design system. The EJS template already exists (`src/views/landing.ejs`) but needs a full design pass.

### Tasks

- [ ] Define the page sections and copy:
  - **Hero** — headline, sub-headline, single primary CTA ("Start for free — no credit card"), optional short demo GIF or static screenshot
  - **Features** — 6 key features in a 2- or 3-column grid: Markdown editor, Custom domain, AI writing, Media library, Analytics, SEO tools
  - **How it works** — 3-step visual flow: Sign up → Write → Publish at your domain
  - **Pricing** — two tiers clearly laid out: Free (1 blog, subdomain) and Pro ($X/mo, custom domain + AI + analytics); Team tier can be "Coming soon"
  - **CTA strip** — repeated call to action above the footer
  - **Footer** — logo, tagline, links (GitHub, docs placeholder, contact), copyright
- [ ] Implement in `src/views/landing.ejs` using the existing CSS design tokens; no new dependencies
- [ ] Add any new landing-page-specific CSS to `src/public/css/style.css` under a clearly marked section
- [ ] The page must be fully static (no auth required) and render correctly when logged out; logged-in users are redirected to `/dashboard` (already in `app.js`)
- [ ] Ensure the hero CTA links to `/register` and the "Sign in" link in the nav links to `/login`
- [ ] Test that the page looks sharp at 375px (mobile), 768px (tablet), and 1280px (desktop)
- [ ] Verify page loads with no JavaScript (server-rendered only); the theme toggle is the only JS dependency and degrades gracefully

### Tests

- [ ] Load `/` when logged out — landing page renders, all sections visible, no broken links
- [ ] Load `/` when logged in — redirected to `/dashboard`
- [ ] Resize to 375px — hero text readable, CTA button full-width, feature grid stacks to single column
- [ ] No `console.error` or missing asset warnings in the browser

### Success criteria

- [ ] Page looks polished and production-ready — someone landing on it for the first time understands the product and has a clear action to take
- [ ] Consistent with the dark-mode design system (colors, typography, spacing) defined in `style.css`
- [ ] Loads fast: no external blocking resources beyond the two Google Fonts already used

---

## Part 10 - UI audit and polish

**Status:** Pending

Ensure the UI is complete, consistent, and production-ready across all views.

### Tasks

- [ ] Review all dashboard views for visual consistency (spacing, typography, button styles) against the CSS design tokens in `style.css`
- [ ] Ensure all form error states are visible and accessible (missing field highlights, error messages)
- [ ] Verify mobile responsiveness on key views: landing, post editor, public blog post, dashboard index
- [ ] Add a `<link rel="alternate" type="application/rss+xml">` tag pointing to `/blog/:username/sitemap.xml` in the blog `<head>` partial
- [ ] Confirm light-mode (`[data-theme="light"]`) overrides are complete for all components added after the initial scaffold
- [ ] Check 404 and error pages render correctly and match the design system
- [ ] Add meta `og:` tags and `twitter:` card tags to the public blog post view if not already present
- [ ] Test with JavaScript disabled — all read-only pages (public blog, landing) must be fully functional; dashboard degrades gracefully

### Tests

- [ ] Load landing page, public blog index, and a blog post — no broken images, no console errors
- [ ] Toggle light/dark theme — all backgrounds, text, and borders switch correctly
- [ ] Submit an empty post form — error messages appear without full-page crash
- [ ] Resize browser to 375px width — dashboard sidebar collapses, editor is usable

### Success criteria

- [ ] No layout breaks at 375px, 768px, or 1280px viewport widths
- [ ] No `console.error` or uncaught exceptions on any primary page load
- [ ] All interactive elements have visible focus states

---

> **PAUSE 2 - Before Part 11 (Production deployment)**
>
> The developer must:
> 1. Confirm all env vars are set in the Railway service dashboard: `NODE_ENV=production`, `DATABASE_URL`, `SESSION_SECRET`, `BASE_URL`, `PORT`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `R2_PUBLIC_URL`, `RESEND_API_KEY`, `RESEND_FROM`
> 2. Update the Google OAuth callback URL in Google Cloud Console to the production URL (e.g. `https://incblog.incodet.com/auth/google/callback`)
> 3. Confirm the Railway PostgreSQL add-on is provisioned and `DATABASE_URL` is available to the service
> 4. Confirm the R2 bucket CORS policy allows reads from the production domain
> 5. Run `npm test` one final time locally and confirm all tests pass
>
> Confirm to the agent: "Production env ready"

---

## Part 11 - Railway production deployment

**Status:** Pending

Ship the app to Railway with a clean production config.

### Tasks

- [ ] Add a `Procfile` (or confirm Railway auto-detects `npm start`) with: `web: node app.js`
- [ ] Add `engines` field to `package.json` specifying the Node.js version (e.g. `"node": ">=20"`)
- [ ] Set `cookie: { secure: true, httpOnly: true, sameSite: 'lax' }` on the session when `NODE_ENV === 'production'`
- [ ] Confirm `sequelize.sync()` runs on first boot in production and creates all tables against PostgreSQL
- [ ] Add a `/health` route returning `200 OK` with `{ status: 'ok' }` for Railway health checks
- [ ] Test the full production flow: register, create post, upload image, publish, view public blog
- [ ] Update `README.md` with concise deploy instructions: Railway setup, required env vars, first-run notes

### Tests

- [ ] Deploy to Railway — service starts, health check passes, no crash on boot
- [ ] Register a new user, create and publish a post — visible at `/blog/:username`
- [ ] Upload an image — stored in R2, rendered from R2 URL in the blog post
- [ ] Request `/sitemap.xml` — valid XML with the published post URL
- [ ] Trigger a scheduled post — auto-publishes within 60 seconds

### Success criteria

- [ ] App is live and reachable at the Railway-assigned URL
- [ ] All MVP features work end-to-end in production
- [ ] No sensitive values hardcoded anywhere in the codebase
- [ ] `npm test` still passes locally after all deployment changes
