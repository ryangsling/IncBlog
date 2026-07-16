# Deploying IncBlog to Fly.io (SQLite + persistent volume, free tier)

Complete runbook for deploying IncBlog to Fly.io using the SQLite + persistent-disk
architecture. The platform-agnostic code fixes (BASE_URL guard, prod-safe `initDb()`,
demo-seed gate, `trust proxy`) all apply here unchanged — only the deploy mechanics
are Fly-specific.

## Why this fits your choice

You picked SQLite + persistent disk over Postgres, and Fly.io's free tier over
paying Railway. Fly is the one free host whose free tier supports persistent
volumes natively — so the SQLite file and uploaded media persist across redeploys
without needing Postgres. The app stays single-instance (SQLite's requirement) and
autoscales to zero when idle (free-tier friendly).

---

## Prerequisites

```bash
# macOS:           brew install flyctl
# Linux (this box): curl -L https://fly.io/install.sh | sh   (installs ~/.fly/bin/flyctl)
# Then:            flyctl auth login   (opens a browser; follow the prompt)
flyctl version
```

You need a Fly.io account. The free allowance covers a single 256 MB shared-CPU
machine + a 3 GB volume — plenty for one blog.

---

## Deploy order

### 1. Launch (creates the app, reuses the existing fly.toml + Dockerfile)

From the repo root:

```bash
flyctl launch --no-deploy --copy-config
```

- It'll ask for an app name and region. If you already have `fly.toml` with
  `app = "incblog"`, it reuses it (use `--copy-config` to keep ours rather than
  overwrite). Region: pick one close to you (e.g. `iad`, `lhr`, `sin`).
- **Do NOT let it create a Dockerfile** — we have one. If it tries, decline.
- `--no-deploy` so we can set secrets + create the volume first.

If you don't already have a `fly.toml` (e.g. you ran launch fresh), the one in
this repo is ready to use — just confirm the app name + region match what you want.

### 2. Create the persistent volume

```bash
flyctl volumes create incblog_data --region iad --size 1
```

(Use the same region you chose in step 1.) This is non-negotiable: without it, the
SQLite file at `/data/incblog.db` and uploads at `/data/uploads/` are **ephemeral —
wiped on every redeploy**. The `[[mounts]]` block in `fly.toml` attaches this volume
at `/data`.

### 3. Set secrets (runtime env vars)

```bash
flyctl secrets set \
  NODE_ENV=production \
  BASE_URL="https://incblog.fly.dev" \
  DATABASE_FILE="/data/incblog.db" \
  UPLOAD_DIR="/data/uploads" \
  SESSION_SECRET="$(node -e "console.log(require('crypto').randomBytes(48).toString('hex'))")" \
  JWT_SECRET="$(node -e "console.log(require('crypto').randomBytes(48).toString('hex'))")" \
  RESEND_API_KEY="re_xxx" \
  RESEND_FROM="IncBlog <no-reply@your-verified-domain.com>"
```

The four `BLOCKER`s below will crash the boot on purpose (via `src/config/site.js`
+ `src/models/index.js`) rather than start a half-broken site — set them before first deploy.

| Secret | Required | Notes |
|---|---|---|
| `NODE_ENV` | **BLOCKER** = `production` | Gates prod-safe DB sync + disables demo seed |
| `BASE_URL` | **BLOCKER** = your `https://<app>.fly.dev` URL | Hard-checked by `src/config/site.js`: refuses localhost/missing in prod |
| `SESSION_SECRET` | **BLOCKER** = random ≥32 chars | express-session cookie secret |
| `JWT_SECRET` | **BLOCKER** = random ≥32 chars | auth token signing |
| `DATABASE_FILE` | `/data/incblog.db` | Puts the SQLite file on the volume |
| `UPLOAD_DIR` | `/data/uploads` | Puts user uploads on the volume; `app.js` serves them at `/uploads/...` |
| `RESEND_API_KEY` | (email) | Without it, verify + unsubscribe emails silently no-op |
| `RESEND_FROM` | (email) | Must be a Resend-verified sender domain |
| `GOOGLE_CLIENT_ID` | (optional) | Enable Google OAuth |
| `GOOGLE_CLIENT_SECRET` | (optional) | Enable Google OAuth |
| `OPENROUTER_API_KEY` | (optional) | AI excerpt/summary/title features |
| `R2_*` | (optional) | See `.env.example` — leave empty to use the volume for media |
| `SEED_DEMO_IN_PROD` | (optional) = `1` | Re-enables `demo@incblog.com / demo1234`. Off by default — **don't** set on a real site. |

Note: `BASE_URL` in the example above uses `incblog.fly.dev` as a placeholder.
Set it to your *actual* hostname (step 4 generates it), then re-run `flyctl secrets set BASE_URL=…`
with the real value. The prod guard refuses to boot with a wrong/localhost value, so a mismatch
fails loudly rather than quietly — no silent dead email links.

### 4. Generate a public domain

```bash
flyctl apps list                  # confirm your app name
flyctl certs create incblog.fly.dev   # or: flyctl ips allocate-v4 && flyctl Certs add <your-custom-domain>
```

Fly auto-provisions `https://<app-name>.fly.dev` on first deploy. After it's live,
copy the real hostname and update `BASE_URL`:

```bash
flyctl secrets set BASE_URL="https://<your-app>.fly.dev"
flyctl deploy
```

For a custom domain: `flyctl certs add yourdomain.com`, point DNS at Fly, then set
`BASE_URL` to that domain.

### 5. Deploy

```bash
flyctl deploy
```

First deploy runs `initDb()` in prod: `sequelize.sync()` with **no force, no ALTER** —
tables created if missing, existing data untouched (see `src/models/index.js`).
Categories seed; the demo user does not.

### 6. Create your real admin

Visit `https://<your-app>.fly.dev/register`, sign up, verify via the email link
(that link pointing at your `BASE_URL` — not localhost — is the `src/config/site.js`
guard proving itself). You're the sole admin until you invite others.

---

## Verify after deploy

```bash
APP="https://<your-app>.fly.dev"
curl -sS -o /dev/null -w "landing   %{http_code}\n" $APP/
curl -sS -o /dev/null -w "register  %{http_code}\n" $APP/register
curl -sS -o /dev/null -w "login     %{http_code}\n" $APP/login
flyctl ssh console -C "ls -la /data"   # confirm incblog.db + uploads/ exist on the volume
```

All three HTTP codes `200`; `/data` shows `incblog.db` and `uploads/`. Register a
test account and confirm the verify-email link's domain is your `BASE_URL`.

---

## SQLite-on-Fly constraints (read these)

- **Single instance only.** SQLite + a volume is fine for one machine.
  `fly.toml` keeps `min_machines_running = 0` and autoscales-to-zero — that's one
  machine max, which is correct for SQLite. **Never `flyctl scale count 2`** — two
  processes writing one SQLite file on a volume corrupts it.
- **Cold starts.** `auto_stop_machines = "stop"` parks the machine when idle
  (~free-tier). The next request spins it up — expect a few seconds' delay on the
  first hit after quiet time. Acceptable for a low-traffic blog; remove
  `auto_stop_machines` to keep it hot (uses more free allowance).
- **No schema auto-migration.** `initDb()` prod branch creates tables if missing but
  won't ALTER columns on existing ones (ALTER is destructive on SQLite). Any model
  change after launch needs a real migration script.
- **Backups.** The volume is your data. Fly volumes are durable but not
  automatically backed up. Snapshot periodically:
  ```bash
  flyctl volumes snapshots list incblog_data
  # Or grab a copy of the DB file:
  flyctl ssh sftp get /data/incblog.db ./incblog-backup-$(date +%F).db
  ```
  With R2 for media, only the `incblog.db` file needs backing up.

---

## Common operations

```bash
flyctl logs                # stream logs
flyctl status              # machine + region status
flyctl ssh console         # shell into the running machine
flyctl secrets list        # see which secrets are set (values are redacted)
flyctl deploy              # redeploy (volume persists — data safe)
flyctl machine stop        # stop without deploy
```

## Troubleshooting

- **Boot crashes with "BASE_URL must be set in production"** — you didn't set
  `BASE_URL` (or set it to localhost/Fly internal host). Set the real `https://<app>.fly.dev`.
- **Boot crashes on `initDb`** — first deploy on a fresh volume should succeed;
  if the volume already had a partial DB, `flyctl ssh sftp get /data/incblog.db`
  to inspect, or (data-loss) `flyctl ssh console -C "rm /data/incblog.db"` and redeploy.
- **Images 404** — confirm `UPLOAD_DIR=/data/uploads` is set and the volume is
  attached at `/data` (`flyctl status` shows the mount). `express.static` serves it
  at `/uploads/<file>`.
- **Emails never arrive** — `RESEND_API_KEY`/`RESEND_FROM` unset or the sender
  domain isn't verified in Resend. Without Resend, `sendMail` no-ops.
