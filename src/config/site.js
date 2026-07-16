// Centralized site URL resolution + a hard production guard against localhost links.
//
// Every email link, the Google OAuth callbackURL, sitemaps, RSS and OpenRouter
// referer are all derived from this value. If BASE_URL is missing in production,
// links silently degrade to http://localhost:3000 — dead links in real emails.
// That is a correctness defect (subscribers can't verify, can't unsubscribe — a
// CAN-SPAM/GDMR problem, not just UX), so in production we refuse to emit a
// localhost BASE_URL and fail loudly instead of shipping dead links.

const DEV_FALLBACK = 'http://localhost:3000';

function isLocalhostHost(hostname) {
  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '0.0.0.0' ||
    hostname.endsWith('.local')
  );
}

function resolveBaseUrl() {
  const raw = (process.env.BASE_URL || '').trim();
  const isProd = process.env.NODE_ENV === 'production';

  if (!raw) {
    if (isProd) {
      throw new Error(
        'BASE_URL must be set in production (e.g. https://your-app.fly.dev). ' +
          'Refusing to use a localhost fallback for email links and OAuth callback.'
      );
    }
    return DEV_FALLBACK;
  }

  // Strip a trailing slash so `${baseUrl}/path` never yields a double slash.
  const normalized = raw.replace(/\/$/, '');

  let host = '';
  try {
    host = new URL(normalized).hostname.toLowerCase();
  } catch (err) {
    throw new Error(`BASE_URL is not a valid URL: ${normalized}`);
  }

  if (isProd && isLocalhostHost(host)) {
    throw new Error(
      `BASE_URL points at localhost (${normalized}) in production. Set it to your public ` +
        'domain (e.g. https://your-app.fly.dev or your custom domain).'
    );
  }

  return normalized;
}

const baseUrl = resolveBaseUrl();

module.exports = {
  baseUrl,
  isLocalhostHost,
};
