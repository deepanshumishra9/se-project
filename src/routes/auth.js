// src/routes/auth.js
// ─────────────────────────────────────────────────────────────────────────────
// AUTHENTICATION ROUTES
//
// These handle user registration, login, logout, and Google OAuth.
// An Express Router is like a mini-app that handles a group of related routes.
// We mount this at "/auth" in server.js, so:
//   router.get('/login')  →  accessible at  GET /auth/login
//   router.post('/login') →  accessible at  POST /auth/login
// ─────────────────────────────────────────────────────────────────────────────

const express  = require('express');
const passport = require('passport');
const bcrypt   = require('bcryptjs');
const { prisma } = require('../utils/db');
const { redirectIfLoggedIn } = require('../middleware/auth');

const router = express.Router();

// ── REGISTER ──────────────────────────────────────────────────────────────────

// GET /auth/register — Show the registration form
router.get('/register', redirectIfLoggedIn, (req, res) => {
  res.render('auth/register', { title: 'Create Account' });
});

// POST /auth/register — Process the registration form
router.post('/register', redirectIfLoggedIn, async (req, res) => {
  try {
    const { email, username, password, confirmPassword } = req.body;

    // ── VALIDATION ────────────────────────────────────────────────────────────
    // Always validate on the server side! Never trust frontend validation alone.
    const errors = [];

    if (!email || !email.includes('@')) {
      errors.push('Please enter a valid email address.');
    }
    if (!username || username.length < 3) {
      errors.push('Username must be at least 3 characters long.');
    }
    if (!password || password.length < 6) {
      errors.push('Password must be at least 6 characters long.');
    }
    if (password !== confirmPassword) {
      errors.push('Passwords do not match.');
    }

    if (errors.length > 0) {
      req.flash('error', errors.join(' '));
      return res.redirect('/auth/register');
    }

    // ── CHECK FOR EXISTING USERS ──────────────────────────────────────────────
    const existingEmail    = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    const existingUsername = await prisma.user.findUnique({ where: { username } });

    if (existingEmail) {
      req.flash('error', 'An account with that email already exists.');
      return res.redirect('/auth/register');
    }
    if (existingUsername) {
      req.flash('error', 'That username is already taken.');
      return res.redirect('/auth/register');
    }

    // ── HASH PASSWORD ─────────────────────────────────────────────────────────
    // NEVER store plain-text passwords!
    // bcrypt.hash(password, saltRounds)
    // saltRounds = 12 means bcrypt will hash the password 2^12 = 4096 times
    // Higher = more secure but slower. 10-12 is the sweet spot.
    const passwordHash = await bcrypt.hash(password, 12);

    // ── CREATE USER ────────────────────────────────────────────────────────────
    const user = await prisma.user.create({
      data: {
        email: email.toLowerCase().trim(),
        username: username.trim(),
        passwordHash
      }
    });

    // ── LOG THEM IN AUTOMATICALLY ──────────────────────────────────────────────
    // req.login() is added by Passport — it creates a session for the user
    req.login(user, (err) => {
      if (err) throw err;
      req.flash('success', `Welcome, ${user.username}! Your account has been created.`);
      res.redirect('/');
    });

  } catch (err) {
    console.error('Registration error:', err);
    req.flash('error', 'Something went wrong. Please try again.');
    res.redirect('/auth/register');
  }
});

// ── LOGIN ─────────────────────────────────────────────────────────────────────

// GET /auth/login — Show the login form
router.get('/login', redirectIfLoggedIn, (req, res) => {
  res.render('auth/login', { title: 'Sign In' });
});

// POST /auth/login — Process the login form using our LocalStrategy
router.post('/login', redirectIfLoggedIn, (req, res, next) => {
  // passport.authenticate returns a middleware function.
  // We call it here manually so we can customize the redirect behavior.
  passport.authenticate('local', (err, user, info) => {
    if (err) return next(err);

    if (!user) {
      // Authentication failed — info.message has the reason
      req.flash('error', info?.message || 'Login failed.');
      return res.redirect('/auth/login');
    }

    // Log the user in (creates session)
    req.login(user, (err) => {
      if (err) return next(err);

      // Redirect to where they were going before, or home
      const returnTo = req.session.returnTo || '/';
      delete req.session.returnTo;
      res.redirect(returnTo);
    });
  })(req, res, next);
});

// ── LOGOUT ────────────────────────────────────────────────────────────────────

// POST /auth/logout — Log the user out
// We use POST (not GET) to prevent CSRF attacks — a link can trigger a GET request
// but not a POST without a form.
router.post('/logout', (req, res, next) => {
  req.logout((err) => {  // req.logout() is added by Passport — destroys the session
    if (err) return next(err);
    req.flash('success', 'You have been logged out.');
    res.redirect('/auth/login');
  });
});

// ── GOOGLE OAUTH ──────────────────────────────────────────────────────────────

// GET /auth/google — Redirect user to Google's login page
router.get('/google',
  passport.authenticate('google', {
    scope: ['profile', 'email'] // Request access to profile and email
  })
);

// GET /auth/google/callback — Google redirects back here after login
router.get('/google/callback',
  passport.authenticate('google', {
    failureRedirect: '/auth/login',
    failureFlash: 'Google sign-in failed. Please try again.'
  }),
  (req, res) => {
    // Successful Google login
    req.flash('success', `Welcome back, ${req.user.username}!`);
    const returnTo = req.session.returnTo || '/';
    delete req.session.returnTo;
    res.redirect(returnTo);
  }
);

module.exports = router;
