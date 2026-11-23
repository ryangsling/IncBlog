const slugify = require('slugify');
const { Setting, User, DisabledLogin, sequelize, Sequelize } = require('./models');
const { emailAddress } = require('./browserSecurity');
const { uniqueUsername } = require('./controllers/authController');

async function signInWithGoogle(profile) {
  const subject = profile.id;
  if (typeof subject !== 'string' || !subject) return null;
  const existing = await User.findOne({ where: { googleId: subject } });
  if (existing) return await DisabledLogin.findByPk(existing.id) ? null : existing;

  const address = profile.emails?.find((email) => email.verified === true);
  const email = emailAddress(address?.value);
  if (!email) return null;
  const emailOwner = await User.findOne({ where: sequelize.where(sequelize.fn('lower', sequelize.col('email')), email) });
  if (emailOwner) return emailOwner.googleId === subject && !await DisabledLogin.findByPk(emailOwner.id) ? emailOwner : null;

  const name = profile.displayName || 'Writer';
  const username = await uniqueUsername(slugify(name, { lower: true, strict: true }));
  try {
    return await sequelize.transaction(async (transaction) => {
      const user = await User.create({ name, email, username, googleId: subject, emailVerified: true }, { transaction });
      await Setting.create({ userId: user.id, blogTitle: `${name}'s Blog` }, { transaction });
      return user;
    });
  } catch (error) {
    if (!(error instanceof Sequelize.UniqueConstraintError)) throw error;
    const owner = await User.findOne({ where: { googleId: subject } });
    return owner && !await DisabledLogin.findByPk(owner.id) ? owner : null;
  }
}

async function linkGoogleSubject(userId, subject) {
  if (typeof subject !== 'string' || !subject) return false;
  try {
    const [updated] = await User.update({ googleId: subject }, { where: { id: userId, googleId: null } });
    if (updated) return true;
    return Boolean(await User.findOne({ where: { id: userId, googleId: subject }, attributes: ['id'] }));
  } catch (error) {
    if (!(error instanceof Sequelize.UniqueConstraintError)) throw error;
    return false;
  }
}

module.exports = { signInWithGoogle, linkGoogleSubject };
