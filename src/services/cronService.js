// src/services/cronService.js
// ─────────────────────────────────────────────────────────────────────────────
// SCHEDULED BACKGROUND JOBS (CRON)
//
// Cron jobs are tasks that run automatically on a schedule.
// The "node-cron" library uses cron syntax to define schedules.
//
// CRON SYNTAX: "minute hour day month weekday"
//   "0 9 * * *"    = Every day at 9:00 AM
//   "0 */6 * * *"  = Every 6 hours
//   "0 0 * * 1"    = Every Monday at midnight
//
// These jobs run in the background while the server is running.
// They don't affect HTTP requests — they run independently.
// ─────────────────────────────────────────────────────────────────────────────

const cron       = require('node-cron');
const { prisma } = require('../utils/db');
const { sendReadingReminder, notifyAchievement } = require('./notificationService');

/**
 * startCronJobs — Register all scheduled jobs
 * Call this once when the server starts (only in production).
 */
function startCronJobs() {

  // ── DAILY READING REMINDERS ────────────────────────────────────────────────
  // Run every day at 9:00 AM
  // Find users who haven't read anything in 3+ days and remind them.
  cron.schedule('0 9 * * *', async () => {
    console.log('⏰ Running daily reading reminder job...');
    try {
      const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);

      // Find users whose most recent read was more than 3 days ago
      // We look at the ReadingHistory table and find users who haven't read recently
      const inactiveUsers = await prisma.user.findMany({
        where: {
          readingHistory: {
            // "some" means "at least one record matches"
            some: {
              lastReadAt: { lt: threeDaysAgo } // lt = less than (older than 3 days)
            },
            // "none" means "no records match this condition"
            // Ensure they haven't read anything recent either
            none: {
              lastReadAt: { gte: threeDaysAgo } // gte = greater than or equal
            }
          }
        },
        select: { id: true, email: true, username: true }
      });

      console.log(`  Found ${inactiveUsers.length} inactive users`);

      for (const user of inactiveUsers) {
        await sendReadingReminder(user);
      }
    } catch (err) {
      console.error('Reading reminder job failed:', err);
    }
  });

  // ── ACHIEVEMENT CHECKER ────────────────────────────────────────────────────
  // Run every day at midnight — check if any users hit new milestones
  cron.schedule('0 0 * * *', async () => {
    console.log('⏰ Running achievement check job...');
    try {
      // Get all users with their reading stats
      const users = await prisma.user.findMany({
        include: {
          readingHistory: {
            where: { completed: true },
            select: { id: true }
          }
        }
      });

      for (const user of users) {
        const completedCount = user.readingHistory.length;

        // Check for milestone achievements
        const milestones = [
          { count: 1,   message: 'You finished your first book! The journey begins. 📖' },
          { count: 5,   message: 'You\'ve completed 5 books! You\'re on a roll! 🎉' },
          { count: 10,  message: '10 books down! You\'re a dedicated reader! 🏅' },
          { count: 25,  message: '25 books! You\'re practically a librarian! 📚' },
          { count: 50,  message: '50 books completed! Legendary reader status! 🏆' },
          { count: 100, message: '100 books! You are a true bibliophile! 🌟' },
        ];

        for (const { count, message } of milestones) {
          if (completedCount === count) {
            // Only notify once — check if we already sent this achievement
            const alreadySent = await prisma.notification.findFirst({
              where: {
                userId: user.id,
                type:   'achievement',
                body:   { contains: `${count} book` }
              }
            });
            if (!alreadySent) {
              await notifyAchievement(user.id, message);
            }
          }
        }
      }
    } catch (err) {
      console.error('Achievement check job failed:', err);
    }
  });

  // ── READING GOAL PROGRESS ──────────────────────────────────────────────────
  // Run on the 1st of every month to reset monthly goals
  cron.schedule('0 0 1 * *', async () => {
    console.log('⏰ Resetting monthly reading goals...');
    try {
      await prisma.readingGoal.updateMany({
        where: { period: 'monthly' },
        data:  { current: 0, achieved: false }
      });
    } catch (err) {
      console.error('Goal reset job failed:', err);
    }
  });
}

module.exports = { startCronJobs };
