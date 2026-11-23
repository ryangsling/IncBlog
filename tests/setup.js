const app = require('../app');
const { sequelize, initDb } = require('../src/models');
const supertest = require('./browser');

let counter = 0;

async function createApp() {
  await initDb();
  return app;
}

async function registerAndGetCookie(app) {
  const n = ++counter;
  const ts = Date.now();
  const email = `u${n}-${ts}@test.com`;
  const username = `u${n}-${ts}`;
  const res = await supertest(app)
    .post('/register')
    .send({ name: 'Test User', email, password: 'test1234', username });
  const setCookie = res.headers['set-cookie'];
  const cookie = setCookie ? setCookie[0].split(';')[0] : '';
  return { cookie, email, username, password: 'test1234', userId: res.body && res.body.userId };
}

module.exports = { createApp, registerAndGetCookie, get sequelize() { return sequelize; } };
