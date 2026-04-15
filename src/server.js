// src/server.js
// ─────────────────────────────────────────────────────────────────────────────
// This is the ENTRY POINT of our application.
// Think of it as the "main()" function — Node.js starts here.
// We set up Express (our web server framework), connect all the pieces,
// and tell the server to start listening for requests.
// ─────────────────────────────────────────────────────────────────────────────

// "dotenv" reads our .env file and puts all variables into process.env
// This MUST be called first, before anything else!
require('dotenv').config();

const express = require('express');
const session = require('express-session');
const passport = require('passport');
const flash = require('express-flash');
const methodOverride = require('method-override');
const morgan = require('morgan');
const compression = require('compression');
const path = require('path');

// Our custom modules (we'll create each of these)
const { connectDB } = require('./utils/db');
const { MongoStore } = require('connect-mongo');
const passportConfig = require('./middleware/passport');
const authRoutes = require('./routes/auth');
const bookRoutes = require('./routes/books');
const userRoutes = require('./routes/user');
const notificationRoutes = require('./routes/notifications');
const { startCronJobs } = require('./services/cronService');

// ── CREATE EXPRESS APP ────────────────────────────────────────────────────────
const app = express();
const PORT = process.env.PORT || 3000;

// ── VIEW ENGINE SETUP ─────────────────────────────────────────────────────────
// EJS is a templating engine — it lets us write HTML with JavaScript embedded.
// Files go in the /views folder and end in .ejs
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '../views'));

// ── MIDDLEWARE STACK ──────────────────────────────────────────────────────────
// Middleware = functions that run on EVERY request before your route handlers.
// Think of them as security checkpoints and pre-processors.

// Compress all responses (gzip) — makes pages load faster
app.use(compression());

// Log every HTTP request to the console (method, path, status, time)
// 'dev' format: "GET /books 200 15ms"
app.use(morgan('dev'));

// Parse JSON bodies — when the frontend sends { "title": "Book" }, this reads it
app.use(express.json());

// Parse HTML form data — when a form is submitted, this reads the fields
app.use(express.urlencoded({ extended: true }));

// Allow HTML forms to send PUT/DELETE requests using a hidden _method field
// (HTML forms only support GET and POST natively)
app.use(methodOverride('_method'));

// Serve static files (CSS, JS, images) from the /public folder
// e.g., /public/css/style.css becomes accessible at /css/style.css
app.use(express.static(path.join(__dirname, '../public')));

// ── SESSION SETUP ─────────────────────────────────────────────────────────────
// Sessions let us remember who a user is across multiple requests.
// HTTP is stateless — without sessions, every request looks like a new visitor.
// The session is stored server-side; the user gets a cookie with a session ID.
app.use(session({
  secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({
    mongoUrl: process.env.MONGODB_URI || 'mongodb://localhost:27017/ebook-library',
    collectionName: 'sessions'
  }),
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    maxAge: 7 * 24 * 60 * 60 * 1000
  }
}));

// ── PASSPORT AUTHENTICATION ───────────────────────────────────────────────────
// Passport is an authentication library.
// passport.initialize() sets up Passport
// passport.session() lets Passport use our session to remember logged-in users
passportConfig(passport); // Load our custom strategies (local + Google)
app.use(passport.initialize());
app.use(passport.session());

// Flash messages — temporary messages stored in session (e.g., "Login failed!")
// They disappear after being displayed once
app.use(flash());

// ── GLOBAL TEMPLATE VARIABLES ─────────────────────────────────────────────────
// These variables are available in EVERY EJS template automatically.
// res.locals = the "global store" for a single request.
app.use((req, res, next) => {
  res.locals.user = req.user || null;  // Currently logged-in user (or null)
  res.locals.success_messages = req.flash('success');
  res.locals.error_messages = req.flash('error');
  next(); // "next()" means "I'm done, pass to the next middleware"
});

// ── ROUTES ────────────────────────────────────────────────────────────────────
// Routes define WHAT HAPPENS when a user visits a URL.
// We split them into separate files to keep things organized.
app.use('/auth', authRoutes);          // /auth/login, /auth/register, /auth/google
app.use('/api/books', bookRoutes);          // /api/books/search, /api/books/read/:id
app.use('/api/user', userRoutes);          // /api/user/history, /api/user/bookmarks
app.use('/api/notifications', notificationRoutes); // /api/notifications

const { requireAuth } = require('./middleware/auth');

// ── PAGE ROUTES ────────────────────────────────────────────────────────────────
// When someone visits the root URL "/", render the main app page
app.get('/', (req, res) => {
  res.render('index', {
    title: 'Open Library Direct'
  });
});

app.get('/profile', requireAuth, (req, res) => {
  res.render('profile');
});

app.get('/history', requireAuth, (req, res) => {
  res.render('history');
});

app.get('/goals', requireAuth, (req, res) => {
  res.render('goals');
});

app.get('/bookmarks', requireAuth, (req, res) => {
  res.render('bookmarks');
});

// ── 404 HANDLER ───────────────────────────────────────────────────────────────
// If no route matched, send a 404 error page
app.use((req, res) => {
  res.status(404).render('error', {
    title: '404 - Page Not Found',
    message: 'The page you are looking for does not exist.',
    statusCode: 404
  });
});

// ── GLOBAL ERROR HANDLER ──────────────────────────────────────────────────────
// If any route throws an error, it ends up here.
// The "4 arguments" signature is how Express recognizes error handlers.
app.use((err, req, res, next) => {
  console.error('🔴 Server Error:', err.stack);
  res.status(500).render('error', {
    title: '500 - Server Error',
    message: process.env.NODE_ENV === 'production'
      ? 'Something went wrong on our end.'
      : err.message,
    statusCode: 500
  });
});

// ── START SERVER ──────────────────────────────────────────────────────────────
app.listen(PORT, async () => {
  console.log(`\n📚 eBook Library running at http://localhost:${PORT}`);
  console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);

  // Start background jobs (reading reminders, etc.)
  // Only run in production or when explicitly enabled
  if (process.env.NODE_ENV === 'production') {
    startCronJobs();
    console.log('⏰ Cron jobs started');
  }

  // Test database connection
  try {
    await connectDB();
    console.log('🗄️  Database connected successfully');
  } catch (err) {
    console.error('❌ Database connection failed:', err.message);
    console.log('   Make sure MongoDB is running and MONGODB_URI is set in .env');
  }
});

module.exports = app; // Export for testing purposes
