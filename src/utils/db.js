// src/utils/db.js
// ─────────────────────────────────────────────────────────────────────────────
// DATABASE CONNECTION UTILITY
//
// We create a single PrismaClient instance and reuse it everywhere.
// Why? Because creating a new database connection for every request is
// expensive (slow). A single shared "pool" of connections is much faster.
//
// The "global" trick prevents creating multiple instances during hot reloads
// in development (when nodemon restarts the server, we reuse the same client).
// ─────────────────────────────────────────────────────────────────────────────

const { PrismaClient } = require('@prisma/client');

// In development, store the client on the global object
// so hot reloads don't create a new connection every time
const globalForPrisma = globalThis;

const prisma = globalForPrisma.prisma ?? new PrismaClient({
  // Log slow queries in development so you can optimize them
  log: process.env.NODE_ENV === 'development'
    ? ['warn', 'error']
    : ['error']
});

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

module.exports = { prisma };
