const passport = require('passport');
const googleState = require('./googleState');
const GoogleStrategy = require('passport-google-oauth20').Strategy;

const googleEnabled = Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);

if (googleEnabled) {
  passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: `${process.env.BASE_URL || 'http://localhost:3000'}/auth/google/callback`,
    state: true,
    store: googleState,
    pkce: 'S256',
  }, (accessToken, refreshToken, profile, done) => done(null, profile)));
}

passport.googleEnabled = googleEnabled;
module.exports = passport;
