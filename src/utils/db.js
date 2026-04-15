const mongoose = require('mongoose');

// Import models so they can be exported from this central utility if desired
const User = require('../models/User');
const ReadingHistory = require('../models/ReadingHistory');
const Bookmark = require('../models/Bookmark');
const Notification = require('../models/Notification');
const ReadingGoal = require('../models/ReadingGoal');
const DailyReadingLog = require('../models/DailyReadingLog');
const ReadingReminder = require('../models/ReadingReminder');

/**
 * connectDB — Establishes connection to MongoDB using the URI from .env
 */
const connectDB = async () => {
  const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/ebook-library';
  
  try {
    const conn = await mongoose.connect(uri);
    console.log(`\n🍃 MongoDB Connected: ${conn.connection.host}`);
    return conn;
  } catch (err) {
    console.error(`\n❌ MongoDB Connection Error: ${err.message}`);
    process.exit(1);
  }
};

// For backward compatibility during migration, we can export a mock/proxy 
// or just export the models directly.
// Given we are refactoring all files, we will export named models.
module.exports = {
  connectDB,
  User,
  ReadingHistory,
  Bookmark,
  Notification,
  ReadingGoal,
  DailyReadingLog,
  ReadingReminder
};
