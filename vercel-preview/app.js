'use strict';
// SAFE PREVIEW ONLY: synthetic posts, no database, no credentials, no user mutations.
const express = require('express');
const path = require('node:path');
const app = express();
app.disable('x-powered-by');
app.use(express.static(path.join(__dirname, 'public')));
app.use((req, res, next) => {
  res.set('X-Robots-Tag', 'noindex, nofollow, noarchive');
  res.set('Cache-Control', 'no-store');
  next();
});
const user = { username: 'preview-writer', name: 'Preview Writer (synthetic)' };
const posts = [
  { slug: 'first-disposable-post', title: 'A disposable preview post',
    date: '2026-11-23', excerpt: 'Synthetic content used to test routing and presentation on Vercel.',
    body: 'This post is not from Fly.io and does not belong to any real IncBlog account.' },
  { slug: 'second-disposable-post', title: 'Checking the preview route',
    date: '2026-11-23', excerpt: 'Confirm that blog slugs render without a database.',
    body: 'Production content will only be imported after an approved, verified recovery.' }
];
const esc = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]));
const chrome = (title, body) => `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} — IncBlog recovery preview</title><link rel="stylesheet" href="/style.css">
</head><body><header><div class="wrap nav"><a href="/" class="brand">inc<span>blog</span></a>
<span class="chip">PREVIEW · SYNTHETIC DATA</span></div></header>
<main class="wrap">${body}</main><footer class="wrap">
Recovery preview only. No real accounts, posts, credentials, or uploads have been imported.
</footer></body></html>`;
const list = () => `<div class="eyebrow">DISPOSABLE STAGING</div>
<h1>Reading, without the production data.</h1>
<p class="lead">This isolated Vercel smoke test proves Express routes and static assets can run while Fly.io recovery is pending.</p>
<section class="notice"><strong>Not your original blog.</strong> All content on this page is synthetic. Authentication, uploads, and writes are disabled.</section>
<h2>${esc(user.name)}'s demo posts</h2><div class="stack">${posts.map(p =>
  `<article class="post"><div class="date">${esc(p.date)}</div>
  <h3><a href="/blog/${esc(user.username)}/${esc(p.slug)}">${esc(p.title)}</a></h3>
  <p>${esc(p.excerpt)}</p></article>`).join('')}</div>`;
app.get('/', (req, res) => res.send(chrome('Preview', list())));
app.get('/blog/preview-writer', (req, res) => res.send(chrome('Preview blog', list())));
app.get('/blog/preview-writer/:slug', (req, res) => {
  const post = posts.find(p => p.slug === req.params.slug);
  if (!post) return res.status(404).send(chrome('Not found', '<h1>Post not found</h1>'));
  res.send(chrome(post.title,
    `<div class="eyebrow">SYNTHETIC BLOG POST</div><a class="back" href="/blog/preview-writer">← Back to preview posts</a>
    <h1>${esc(post.title)}</h1><p class="date">${esc(post.date)} · ${esc(user.name)}</p>
    <article class="article">${esc(post.body)}</article>`));
});
app.get('/health', (req, res) => res.json({
  ok: true, environment: 'disposable-preview', database: 'none', uploads: 'none', auth: 'disabled'
}));
app.all(['/login', '/register', '/dashboard', '/dashboard/*', '/api/*'], (req, res) =>
  res.status(503).json({ error: 'Disabled in disposable preview: no real data or writes' }));
app.use((req, res) => res.status(404).send(chrome('Not found', '<h1>Page not found</h1>')));
if (require.main === module) app.listen(process.env.PORT || 3000);
module.exports = app;
