const request = require('supertest');

function withOrigin(client) {
  const post = client.post.bind(client);
  client.post = (...args) => {
    const test = post(...args);
    return test.set('Origin', new URL(test.url).origin);
  };
  return client;
}

const browser = (app) => withOrigin(request(app));
browser.agent = (app) => withOrigin(request.agent(app));
module.exports = browser;
