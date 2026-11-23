# Private media and database rollout

Rehearse the migration and cutover on copies of the database and media. Apply live steps only after approval. Take a database backup and a file or object inventory, and pause writes during a coordinated cutover so the previous app cannot create new unindexed media references.

## Database and TLS

- In the migration job, set `MIGRATION_DATABASE_URL` to a PostgreSQL role that can create and own the app tables, indexes, sequences, and the `incblog_private` schema. Set `DATABASE_URL` in the application to the runtime role. Use separate credentials. Leave `MIGRATION_DATABASE_URL` out of the application's environment.
- Use the provider's DNS hostname in both URLs. PostgreSQL requires TLS with certificate chain and hostname checks. If the provider needs a private CA, mount its PEM chain and set `PG_CA_FILE` to the path for both connections. The platform trust store is used when the file is omitted. Remove TLS query overrides such as `sslmode` from the URLs.
- Run `npm run db:prepare` against the approved target. Versioned migrations adopt existing tables without dropping or rebuilding them, create ownership and reference tables, and clear retired plaintext verification tokens. They also support an empty database. Review duplicate Google subjects and duplicate email subscriptions within each blog before creating the existing named unique indexes. The app checks the migration ledger at startup. Hosted SQLite needs an explicit persistent `DATABASE_FILE` and the same offline migration command. The local development SQLite workflow applies migrations automatically.
- Keep `incblog_private` out of the Supabase Data API. The runtime role needs `CONNECT` on the database and `USAGE` on the app schemas. It needs no table ownership, schema creation, or alteration grants.

| Runtime grants | Tables |
| --- | --- |
| SELECT | `categories`, `incblog_private.schema_migrations`, `incblog_private.disabled_logins` |
| SELECT, INSERT | `tags` |
| SELECT, INSERT, DELETE | `media`, `page_views`, `post_tags`, `incblog_private.upload_assets`, `incblog_private.post_assets` |
| SELECT, INSERT, UPDATE, DELETE | `users`, `posts`, `subscribers`, `settings`, `incblog_private.browser_sessions`, `incblog_private.browser_rate_limits`, `incblog_private.account_proofs` |
| SELECT, INSERT, UPDATE | `incblog_private.post_slugs` |

Grant `USAGE` on the ID sequences for `users`, `posts`, `tags`, `media`, `page_views`, `subscribers`, and `settings`. If default type privileges are restricted, also grant `USAGE` on the app's enum types. Grant these privileges only on app objects. Supabase browser roles should have no direct access to these server-only tables.

## Local media

1. Set `MEDIA_DIRECTORY` to a writable persistent directory outside the public web root. New original WebPs and variants go there. Set `LEGACY_MEDIA_DIRECTORY` to the directory holding prior `/uploads/` files if it differs from the old checkout's `src/public/uploads`.
2. Preserve existing files by copying them under their unchanged filenames into the private directory. Verify their checksums before retiring the old directory or mount. The application can read the old directory during the cutover through the same gated route. Remove any independent web-server alias that serves it directly.
3. Keep `/uploads/<filename>` routed to IncBlog and configure reverse proxies and caches to bypass caching for it. Purge previous responses for that prefix, including variant and thumbnail URLs. The browser-facing route now sends `Cache-Control: private, no-store` and checks current publication and ownership on each request.

## Cloudflare R2

1. Set `R2_BUCKET`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, and `R2_SECRET_ACCESS_KEY` for server-side object read, write, and delete in the chosen bucket. The migration preserves original object keys and records which assets use R2. If changing buckets, copy and verify the keys before switching the runtime credentials.
2. Set `LEGACY_R2_MEDIA_URLS` to the comma-separated former public URL prefixes, with their original path prefixes if any. The old `R2_PUBLIC_URL` is accepted as a legacy alias. If the site used absolute local upload URLs on old domains, list those origins in `LEGACY_MEDIA_ORIGINS`. Set the same aliases for the migration and app. Keep the aliases configured while older inline Markdown or HTML is still stored. The app renders those known URLs through `/uploads/`; it keeps the original article source.
3. In **R2 → bucket → Settings**, disable the **Public Development URL** and disconnect **Custom Domains** that directly expose the bucket. Remove any public access served by Workers, Pages, or other proxies. If you control an old image hostname and need old external links to keep working, redirect recognized object paths to the new gated app route. The old hostname must serve no object bytes directly. A former `r2.dev` address can be disabled, but the app cannot redirect it.
4. Purge Cloudflare and any other CDN caches for old hosts and media paths, including cached originals, thumbnails, and variants. Remove Cache Everything or custom cache rules for the app's media route. Probe the old endpoints from a signed-out client, then confirm public post images and avatars still work via the app and library and draft images return 404.

The migration infers ownership from library records, existing uploaded avatars, and existing featured and OG fields. It links recognized inline images only when there is matching ownership evidence. It reports untracked or mismatched inline references for review and stops on contradictory ownership for adopted files. Keep an inventory of unresolved objects, and validate that older URLs still render where ownership is known. Old files without size metadata still use their original source. New featured and library images store their variant dimensions. Unpublishing, removing an avatar, or deleting a post removes the corresponding public reference. Soft-deleted posts and replaced avatars can keep owner-only objects until account deletion. Failed object cleanup is logged and unreachable objects can be reconciled later from the private storage inventory.

## Previously seeded demo account

On a read-only copy, look for the exact pair `username = 'demo'` and `email = 'demo@incblog.com'`. Compare the user ID, creation date, and the known sample slugs `welcome-to-incblog`, `why-markdown-still-wins`, and `growing-a-newsletter-from-zero` before deciding it was seeded. Do not conclude ownership from the username alone. Once confirmed and approved, add the verified user ID to `incblog_private.disabled_logins` in PostgreSQL (or `disabled_logins` in SQLite):

```sql
INSERT INTO incblog_private.disabled_logins ("userId")
SELECT id FROM users
WHERE id = :verified_demo_id AND username = 'demo' AND email = 'demo@incblog.com'
ON CONFLICT ("userId") DO NOTHING;
```

Use a bound parameter with the verified numeric ID. This disables password and Google sign-in and rejects already-issued login cookies for that account. It preserves the user, posts, profile, and media for review. The app seeds demo data only with `SEED_DEMO=true` in local development or in explicit in-memory test fixtures.
