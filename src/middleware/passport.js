// src/middleware/passport.js
// ─────────────────────────────────────────────────────────────────────────────
// PASSPORT AUTHENTICATION CONFIGURATION
//
// Passport uses "strategies" — each strategy is a different way to log in.
// We configure two:
//   1. LocalStrategy  — email + password login (traditional)
//   2. GoogleStrategy — "Sign in with Google" (OAuth 2.0)
//
// HOW SESSIONS WORK WITH PASSPORT:
//   serializeUser   → When user logs in, what do we SAVE to the session? (just the ID)
//   deserializeUser → On each request, we have the ID — go fetch the full user from DB
// ─────────────────────────────────────────────────────────────────────────────

const LocalStrategy  = require('passport-local').Strategy;
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const bcrypt         = require('bcryptjs');
const { User }       = require('../utils/db');

module.exports = function configurePassport(passport) {

  // ── SERIALIZE USER ─────────────────────────────────────────────────────────
  // After login, Passport calls this to decide what to store in the session.
  // We only store the user's ID (a small number) — not the whole user object.
  passport.serializeUser((user, done) => {
    // done(error, dataToStore)
    // null = no error, user.id = what gets saved in req.session.passport.user
    done(null, user.id);
  });

  // ── DESERIALIZE USER ───────────────────────────────────────────────────────
  // On every request, Passport takes the ID from the session and calls this
  // to get the full user object. The result goes into req.user.
  passport.deserializeUser(async (id, done) => {
    try {
      const user = await User.findById(id);
      done(null, user); // user is now available as req.user in every route
    } catch (err) {
      done(err, null);
    }
  });

  // ── LOCAL STRATEGY (Email + Password) ─────────────────────────────────────
  // This handles the traditional login form.
  // By default, Passport looks for "username" and "password" fields.
  // We rename "username" to "email" using the usernameField option.
  passport.use('local', new LocalStrategy(
    { usernameField: 'email' }, // Tell Passport to look for "email" field instead of "username"
    async (email, password, done) => {
      try {
        // Step 1: Find the user by email
        const user = await User.findOne({ email: email.toLowerCase().trim() });

        // Step 2: If no user found, authentication fails
        if (!user) {
          return done(null, false, { message: 'No account found with that email.' });
        }

        // Step 3: Check if this user registered with Google (no password)
        if (!user.passwordHash) {
          return done(null, false, {
            message: 'This account uses Google Sign-In. Please use that instead.'
          });
        }

        // Step 4: Compare the entered password with the stored hash
        // bcrypt.compare is async and returns true/false
        // NEVER store plain-text passwords! Always hash them.
        const isMatch = await bcrypt.compare(password, user.passwordHash);
        if (!isMatch) {
          return done(null, false, { message: 'Incorrect password.' });
        }

        // Step 5: All good! Return the user object.
        return done(null, user);

      } catch (err) {
        return done(err); // Pass any unexpected errors to Passport
      }
    }
  ));

  // ── GOOGLE OAUTH STRATEGY ──────────────────────────────────────────────────
  // This handles "Sign in with Google".
  // Flow:
  //   1. User clicks "Sign in with Google"
  //   2. We redirect them to Google's login page
  //   3. After login, Google redirects back to our callbackURL with a "code"
  //   4. We exchange the code for the user's profile information
  //   5. This callback runs with their profile data
  passport.use('google', new GoogleStrategy(
    {
      clientID:     process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL:  `${process.env.APP_URL || 'http://localhost:3000'}/auth/google/callback`,
      scope: ['profile', 'email'] // What data we want from Google
    },
    async (accessToken, refreshToken, profile, done) => {
      // "profile" contains the user's Google account data
      try {
        const email    = profile.emails?.[0]?.value;
        const avatar   = profile.photos?.[0]?.value;
        const googleId = profile.id;

        if (!email) {
          return done(null, false, { message: 'No email provided by Google.' });
        }

        // Check if a user with this Google ID already exists
        let user = await User.findOne({ googleId });

        if (user) {
          // Returning Google user — just log them in
          return done(null, user);
        }

        // Maybe they previously registered with email?
        user = await User.findOne({ email });

        if (user) {
          // Link their Google account to existing email account
          user.googleId = googleId;
          if (avatar) user.avatar = avatar;
          await user.save();
          return done(null, user);
        }

        // Brand new user — create an account for them
        user = await User.create({
          email,
          username: profile.displayName?.replace(/\s+/g, '_').toLowerCase() || `user_${googleId.slice(-6)}`,
          googleId,
          avatar
        });

        return done(null, user);

      } catch (err) {
        return done(err);
      }
    }
  ));
};
