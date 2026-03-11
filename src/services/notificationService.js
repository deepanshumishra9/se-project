// src/services/notificationService.js
// ─────────────────────────────────────────────────────────────────────────────
// NOTIFICATION SERVICE
//
// Handles creating and sending notifications.
// We support two types:
//   1. In-app notifications — stored in the database, shown in the UI bell icon
//   2. Email notifications  — sent via Nodemailer (optional, requires email config)
// ─────────────────────────────────────────────────────────────────────────────

const { prisma }    = require('../utils/db');
const nodemailer    = require('nodemailer');

// ── EMAIL TRANSPORTER ─────────────────────────────────────────────────────────
// Nodemailer sends emails. We configure it with Gmail SMTP here.
// The transporter is created once and reused (like the Prisma client).
let transporter = null;

function getTransporter() {
  if (!transporter && process.env.EMAIL_USER) {
    transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS // Must be an App Password, not your Gmail password
      }
    });
  }
  return transporter;
}

// ── NOTIFICATION TYPES ────────────────────────────────────────────────────────
// Constants for notification types — avoids typos like 'Reminder' vs 'reminder'
const TYPES = {
  REMINDER:       'reminder',
  RECOMMENDATION: 'recommendation',
  ACHIEVEMENT:    'achievement',
  SYSTEM:         'system'
};

/**
 * createNotification — Save a notification to the database
 * @param {Object} data
 * @param {number} data.userId  - Who gets the notification
 * @param {string} data.type    - One of the TYPES constants above
 * @param {string} data.title   - Short headline
 * @param {string} data.body    - Longer description
 * @param {string} [data.link]  - Optional URL to navigate to when clicked
 */
async function createNotification({ userId, type, title, body, link = null }) {
  try {
    const notification = await prisma.notification.create({
      data: { userId, type, title, body, link }
    });

    // Delete old notifications to prevent the database from growing forever
    // Keep only the 50 most recent per user
    const oldOnes = await prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      skip: 50,
      select: { id: true }
    });

    if (oldOnes.length > 0) {
      await prisma.notification.deleteMany({
        where: { id: { in: oldOnes.map(n => n.id) } }
      });
    }

    return notification;
  } catch (err) {
    console.error('Failed to create notification:', err);
  }
}

/**
 * sendReadingReminder — Create a "haven't read in a while" notification
 * Called by the cron job daily for inactive users.
 * @param {Object} user - The User object from Prisma
 */
async function sendReadingReminder(user) {
  // 1. Create in-app notification
  await createNotification({
    userId: user.id,
    type:   TYPES.REMINDER,
    title:  '📚 Time to Read!',
    body:   `You haven't opened a book in a while. Pick up where you left off!`,
    link:   '/'
  });

  // 2. Send email (only if email is configured)
  const mailer = getTransporter();
  if (!mailer) return;

  try {
    await mailer.sendMail({
      from:    process.env.EMAIL_FROM,
      to:      user.email,
      subject: '📚 Your books miss you!',
      html: `
        <div style="font-family:sans-serif;max-width:500px;margin:auto;padding:20px">
          <h2>Hi ${user.username}! 👋</h2>
          <p>You haven't opened a book in the last 3 days. 
             Keep your reading streak alive!</p>
          <a href="${process.env.APP_URL}" 
             style="display:inline-block;padding:12px 24px;background:#f5c842;
                    color:#111;border-radius:6px;text-decoration:none;font-weight:bold">
            Continue Reading
          </a>
          <p style="color:#888;font-size:12px;margin-top:20px">
            Unsubscribe from reminders in your account settings.
          </p>
        </div>
      `
    });
  } catch (err) {
    console.error(`Failed to send reminder email to ${user.email}:`, err.message);
  }
}

/**
 * notifyRecommendation — Tell the user about new book recommendations
 * @param {number} userId
 * @param {string} bookTitle - A sample recommendation to mention
 */
async function notifyRecommendation(userId, bookTitle) {
  await createNotification({
    userId,
    type:  TYPES.RECOMMENDATION,
    title: '✨ New Recommendations for You',
    body:  `Based on your reading history, we think you'll love "${bookTitle}" and more!`,
    link:  '/?tab=recommendations'
  });
}

/**
 * notifyAchievement — Celebrate user milestones
 * @param {number} userId
 * @param {string} achievement - Description of what they achieved
 */
async function notifyAchievement(userId, achievement) {
  await createNotification({
    userId,
    type:  TYPES.ACHIEVEMENT,
    title: '🏆 Achievement Unlocked!',
    body:  achievement,
    link:  '/profile'
  });
}

/**
 * getUnreadCount — Get count of unread notifications for a user
 * Used to show the red badge number on the bell icon.
 * @param {number} userId
 * @returns {number}
 */
async function getUnreadCount(userId) {
  return prisma.notification.count({
    where: { userId, read: false }
  });
}

module.exports = {
  createNotification,
  sendReadingReminder,
  notifyRecommendation,
  notifyAchievement,
  getUnreadCount,
  TYPES
};
