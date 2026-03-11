// src/middleware/auth.js
// ─────────────────────────────────────────────────────────────────────────────
// AUTHENTICATION GUARD MIDDLEWARE
//
// These are functions you put BEFORE a route handler to protect it.
// Example usage:
//   router.get('/profile', requireAuth, (req, res) => { ... })
//
// If the user isn't logged in, they get redirected to the login page
// instead of seeing the protected content.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * requireAuth — Protect a route so only logged-in users can access it.
 *
 * req.isAuthenticated() is a method added by Passport.
 * It returns true if the user has a valid session.
 */
function requireAuth(req, res, next) {
  if (req.isAuthenticated()) {
    return next(); // User is logged in → let them through
  }

  // Save where they were trying to go, so we can redirect after login
  req.session.returnTo = req.originalUrl;
  req.flash('error', 'Please log in to access that page.');
  res.redirect('/auth/login');
}

/**
 * requireAuthJson — Like requireAuth, but for API endpoints.
 * Instead of a redirect, returns a JSON error response.
 * Used for AJAX requests from the frontend.
 */
function requireAuthJson(req, res, next) {
  if (req.isAuthenticated()) {
    return next();
  }
  res.status(401).json({
    success: false,
    error: 'Authentication required. Please log in.'
  });
}

/**
 * redirectIfLoggedIn — Prevent logged-in users from accessing login/register pages.
 * If a logged-in user visits /auth/login, redirect them to home.
 */
function redirectIfLoggedIn(req, res, next) {
  if (req.isAuthenticated()) {
    return res.redirect('/');
  }
  next();
}

module.exports = { requireAuth, requireAuthJson, redirectIfLoggedIn };
