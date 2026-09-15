const rateLimit = require('express-rate-limit');

const isTest = process.env.NODE_ENV === 'test';

function intFromEnv(key, fallback) {
  const parsed = Number.parseInt(process.env[key] || '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function createLimiter({ windowMs, max, message }) {
  const testMax = intFromEnv('RATE_LIMIT_TEST_MAX', 0);
  return rateLimit({
    windowMs,
    max: isTest ? (testMax || Math.max(max, 1000)) : max,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: message },
    handler: (req, res) => {
      const wantsJson = req.xhr || (req.headers.accept || '').includes('application/json');
      if (wantsJson) return res.status(429).json({ error: message });
      return res.status(429).render('404', { title: 'Too many requests', message });
    },
  });
}

const authLimiter = createLimiter({
  windowMs: intFromEnv('RATE_LIMIT_AUTH_WINDOW_MS', 15 * 60 * 1000),
  max: intFromEnv('RATE_LIMIT_AUTH_MAX', 20),
  message: 'Too many authentication attempts. Please try again in 15 minutes.',
});

const subscribeLimiter = createLimiter({
  windowMs: intFromEnv('RATE_LIMIT_SUBSCRIBE_WINDOW_MS', 10 * 60 * 1000),
  max: intFromEnv('RATE_LIMIT_SUBSCRIBE_MAX', 30),
  message: 'Too many subscription actions from this IP. Please try again soon.',
});

const aiLimiter = createLimiter({
  windowMs: intFromEnv('RATE_LIMIT_AI_WINDOW_MS', 5 * 60 * 1000),
  max: intFromEnv('RATE_LIMIT_AI_MAX', 25),
  message: 'AI assist is temporarily rate-limited. Please wait a few minutes.',
});

module.exports = { authLimiter, subscribeLimiter, aiLimiter };
