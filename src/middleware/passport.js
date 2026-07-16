const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const slugify = require('slugify');
const { User, Setting } = require('../models');
const { uniqueUsername } = require('../controllers/authController');
const { baseUrl } = require('../config/site');

const googleEnabled = Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);

if (googleEnabled) {
  passport.use(
    new GoogleStrategy(
      {
        clientID: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        callbackURL: `${baseUrl}/auth/google/callback`,
      },
      async (accessToken, refreshToken, profile, done) => {
        try {
          const email = profile.emails && profile.emails[0] && profile.emails[0].value;
          let user = await User.findOne({ where: { googleId: profile.id } });
          if (!user && email) {
            user = await User.findOne({ where: { email } });
          }
          if (user) {
            if (!user.googleId) {
              user.googleId = profile.id;
              await user.save();
            }
            return done(null, user);
          }
          const name = profile.displayName || 'Writer';
          const base = slugify(name, { lower: true, strict: true }) || 'writer';
          const username = await uniqueUsername(base);
          user = await User.create({
            name,
            email: email || `${username}@users.incblog.local`,
            googleId: profile.id,
            username,
            avatar: profile.photos && profile.photos[0] ? profile.photos[0].value : null,
          });
          await Setting.create({ userId: user.id, blogTitle: `${name}'s Blog` });
          return done(null, user);
        } catch (err) {
          return done(err);
        }
      }
    )
  );
}

passport.googleEnabled = googleEnabled;
module.exports = passport;
