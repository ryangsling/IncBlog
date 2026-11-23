# IncBlog disposable Vercel preview

This is an **isolated, read-only smoke test** with two invented posts. It never reads Fly.io, SQLite, PostgreSQL, R2, environment credentials, uploads or real accounts. It cannot recover production data.

## Local smoke test
```sh
cd vercel-preview
npm install
npm start
# open http://localhost:3000 ; /health should say database=none
```

## Vercel preview
Connect the repo or deploy with the Vercel CLI. Use this folder (`vercel-preview`) as the **Root Directory**; do not deploy the full repository root for this disposable test.
```sh
git checkout vercel-recovery-preview
cd vercel-preview
npx vercel
```
Do **not** use `--prod`; create a separate staging project, keep the real site/domain untouched, and use Preview only. No environment variables are required. The `app.js` entry point exports an Express app, which Vercel supports; `public/style.css` is served from Vercel's static public directory. Pages have `X-Robots-Tag: noindex`.

## Important limitations
- Synthetic data; no actual users/posts/media
- Login, dashboard, API mutations and uploads intentionally disabled
- Useful only to test basic Vercel Express routing/static assets and preview deployment
- Vercel Functions have ephemeral writable space, so do not deploy the production SQLite file to Vercel as a durable database
- The real migration requires an approved database and durable object-storage design (e.g. PostgreSQL + R2), careful account ID/slug preservation, and a snapshot-verified Fly export
- Fly source volume `vol_v3gz6onk5k1nd2o4` must remain untouched until validated and backed up

Original repository main and fly-deploy branches were **not changed** to prepare this folder.
