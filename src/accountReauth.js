const bcrypt = require('bcryptjs');
const { randomBytes } = require('node:crypto');
const { AccountProof, Op } = require('./models');
const { digest, emailAddress, emptyForm, validPassword } = require('./browserSecurity');
const { sendMail } = require('./middleware/mailer');

const lifetime = 10 * 60 * 1000;
const settings = '/dashboard/settings';
const key = (req, purpose) => digest(`${purpose}:${req.user.id}:${req.sessionID}:${req.cookies.token}`);

async function sendChallenge(req, res, next) {
  try {
    const email = emailAddress(req.user.email);
    if (req.user.passwordHash || !req.user.googleId || !req.user.emailVerified || !email ||
        !emptyForm(req)) return res.status(400).send('Email reauthentication is unavailable.');
    const code = randomBytes(16).toString('hex');
    req.session.accountReauth = true;
    await AccountProof.upsert({ key: key(req, 'challenge'), value: digest(code), expiresAt: Date.now() + lifetime });
    const sent = await sendMail({ to: email, subject: 'Confirm your IncBlog account deletion',
      html: `<p>Use this one-time code in your IncBlog settings: <strong>${code}</strong>. It expires in 10 minutes.</p>` });
    if (!sent) return res.status(503).send('Email delivery is temporarily unavailable.');
    return res.redirect(`${settings}?reauth=sent`);
  } catch (err) {
    next(err);
  }
}

async function reauthenticate(req, res, next) {
  try {
    let confirmed = false;
    if (req.user.passwordHash) {
      const password = req.body?.password;
      confirmed = validPassword(password) && await bcrypt.compare(password, req.user.passwordHash);
    } else if (req.user.googleId && req.user.emailVerified && req.session.accountReauth &&
        typeof req.body?.code === 'string' && /^[a-f0-9]{32}$/.test(req.body.code)) {
      confirmed = await AccountProof.destroy({ where: {
        key: key(req, 'challenge'), value: digest(req.body.code), expiresAt: { [Op.gt]: Date.now() },
      } });
    }
    if (!confirmed) return res.redirect(`${settings}?error=Identity+confirmation+failed`);
    req.session.accountReauth = true;
    await AccountProof.upsert({ key: key(req, 'delete'), value: 'approved', expiresAt: Date.now() + lifetime });
    return res.redirect(`${settings}?reauth=ready`);
  } catch (err) {
    next(err);
  }
}

function consumeDeletionProof(req) {
  if (!req.session.accountReauth) return 0;
  return AccountProof.destroy({ where: { key: key(req, 'delete'), expiresAt: { [Op.gt]: Date.now() } } });
}

module.exports = { sendChallenge, reauthenticate, consumeDeletionProof };
