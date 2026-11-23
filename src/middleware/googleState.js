const { randomBytes } = require('node:crypto');
const { AccountProof, Op } = require('../models');
const { digest } = require('../browserSecurity');

const key = (req, state) => digest(`google-oauth:${req.sessionID}:${state}`);

module.exports = {
  store(req, verifier, intent, meta, done) {
    const state = randomBytes(32).toString('hex');
    req.session.googleOAuth = true;
    AccountProof.create({ key: key(req, state), value: JSON.stringify({ verifier, intent }),
      expiresAt: intent.expiresAt }).then(() => done(null, state), done);
  },

  verify(req, state, done) {
    if (!req.session.googleOAuth || typeof state !== 'string' || !/^[a-f0-9]{64}$/.test(state)) {
      return done(null, false);
    }
    const where = { key: key(req, state), expiresAt: { [Op.gt]: Date.now() } };
    AccountProof.findOne({ where }).then(async (proof) => {
      if (!proof || !await AccountProof.destroy({ where })) return done(null, false);
      const { verifier, intent } = JSON.parse(proof.value);
      return done(null, verifier, intent);
    }).catch(done);
  },
};
