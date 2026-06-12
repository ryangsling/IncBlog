# IncBlog

IncBlog is a SaaS blogging platform by [incodet.com](https://incodet.com). Full-stack Node.js app with a writing dashboard, AI assistance (Claude), media library, analytics, newsletter subscribers, and a public blog per user.

## Stack

- Node.js + Express, EJS server-side rendering
- SQLite via Sequelize ORM
- JWT auth in HTTP-only cookies, optional Google OAuth (Passport)
- Claude API via `@anthropic-ai/sdk`
- `sharp` for WebP conversion + thumbnails
- Nodemailer for subscriber emails
- Custom CSS, dark mode first

## Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Create your environment file:

   ```bash
   cp .env.example .env
   ```

   Set at least `JWT_SECRET`. Set `ANTHROPIC_API_KEY` to enable the AI buttons, `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` for Google login, and the `SMTP_*` vars for subscriber emails. All are optional except `JWT_SECRET`.

3. Run in development (nodemon):

   ```bash
   npm run dev
   ```

   Or production:

   ```bash
   npm start
   ```

The app starts at `http://localhost:3000`. On first run the database is created and seeded with:

- Demo user: `demo@incblog.com` / `demo1234`
- 3 sample published posts (public blog at `/blog/demo`)
- Categories: Tech, Design, Business, Personal, Other

## Key URLs

| URL | Description |
| --- | --- |
| `/` | Landing page |
| `/login`, `/register` | Auth |
| `/dashboard` | Writer dashboard |
| `/blog/:username` | Public blog |
| `/blog/:username/:slug` | Post page |
| `/blog/:username/rss.xml` | RSS feed |
| `/blog/:username/sitemap.xml` | Sitemap |
| `/unsubscribe?token=...` | Newsletter unsubscribe |

## Custom domains (simulated)

Set a custom domain in **Dashboard → Settings**. Point a CNAME for that domain to `incblog.incodet.com`. When a request arrives with a matching `Host` header, middleware routes it to your public blog.
