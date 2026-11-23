const { randomBytes } = require('node:crypto');

process.env.DATABASE_URL = '';
process.env.DATABASE_FILE = ':memory:';
process.env.JWT_SECRET = randomBytes(32).toString('hex');
process.env.SESSION_SECRET = randomBytes(32).toString('hex');
process.env.TRUSTED_PROXIES = '';
process.env.OPENROUTER_API_KEY = '';
process.env.BASE_URL = 'https://incblog.example.test';
