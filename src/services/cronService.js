// src/services/cronService.js
// ─────────────────────────────────────────────────────────────────────────────
// SCHEDULED BACKGROUND JOBS
//
// We run 4 categories of jobs:
//   1. General inactivity reminders (3+ days without reading)
//   2. Achievement checker (book milestones)
//   3. Monthly goal reset
//   4. User-scheduled personal reminders (fires at user's chosen time)
//
// The user-reminder job runs every minute and checks if any user's chosen time
// matches the current HH:MM — this is the "scheduler within the scheduler"
// pattern, which avoids creating dynamic cron jobs per user at startup.
// ─────────────────────────────────────────────────────────────────────────────

const cron = require('node-cron');
const { User, ReadingHistory, ReadingGoal, Notification, ReadingReminder } = require('../utils/db');
const { sendReadingReminder, notifyAchievement, createNotification, TYPES } = require('./notificationService');

function startCronJobs() {

  // ── 1. DAILY INACTIVITY REMINDERS ─────────────────────────────────────────
  // Run every day at 9:00 AM UTC — send reminder if user hasn't read in 3+ days
  cron.schedule('0 9 * * *', async () => {
    console.log('⏰ Running daily inactivity reminder job...');
    try {
      const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);

      const inactiveUsers = await User.aggregate([
        {
          $lookup: {
            from: 'readinghistories',
            localField: '_id',
            foreignField: 'userId',
            as: 'history'
          }
        },
        {
          $match: {
            'history.lastReadAt': { $lt: threeDaysAgo },
            history: {
              $not: { $elemMatch: { lastReadAt: { $gte: threeDaysAgo } } }
            }
          }
        },
        { $project: { id: '$_id', email: 1, username: 1 } }
      ]);

      console.log(`  Found ${inactiveUsers.length} inactive users`);
      for (const user of inactiveUsers) {
        await sendReadingReminder(user);
      }
    } catch (err) {
      console.error('Inactivity reminder job failed:', err);
    }
  });

  // ── 2. ACHIEVEMENT CHECKER ─────────────────────────────────────────────────
  // Runs every day at midnight — checks for book-count milestones
  cron.schedule('0 0 * * *', async () => {
    console.log('⏰ Running achievement check job...');
    try {
      const users = await User.aggregate([
        {
          $lookup: {
            from: 'readinghistories',
            let: { userId: '$_id' },
            pipeline: [
              {
                $match: {
                  $expr: {
                    $and: [
                      { $eq: ['$userId', '$$userId'] },
                      { $eq: ['$completed', true] }
                    ]
                  }
                }
              }
            ],
            as: 'completedHistory'
          }
        },
        {
          $project: {
            id: '$_id',
            username: 1,
            completedCount: { $size: '$completedHistory' }
          }
        }
      ]);

      const milestones = [
        { count: 1,   message: 'You finished your first book! The journey begins. 📖' },
        { count: 5,   message: "You've completed 5 books! You're on a roll! 🎉" },
        { count: 10,  message: "10 books down! You're a dedicated reader! 🏅" },
        { count: 25,  message: "25 books! You're practically a librarian! 📚" },
        { count: 50,  message: '50 books completed! Legendary reader status! 🏆' },
        { count: 100, message: '100 books! You are a true bibliophile! 🌟' }
      ];

      for (const user of users) {
        for (const { count, message } of milestones) {
          if (user.completedCount === count) {
            const alreadySent = await Notification.findOne({
              userId: user.id,
              type: 'achievement',
              body: { $regex: `${count} book`, $options: 'i' }
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

  // ── 3. MONTHLY GOAL RESET ──────────────────────────────────────────────────
  // Run on the 1st of each month at midnight — reset monthly goal progress
  cron.schedule('0 0 1 * *', async () => {
    console.log('⏰ Resetting monthly reading goals...');
    try {
      await ReadingGoal.updateMany(
        { period: 'monthly' },
        { $set: { current: 0, achieved: false } }
      );
      console.log('  Monthly goals reset.');
    } catch (err) {
      console.error('Goal reset job failed:', err);
    }
  });

  // ── 4. YEARLY GOAL RESET ───────────────────────────────────────────────────
  // Run on Jan 1 every year
  cron.schedule('0 0 1 1 *', async () => {
    console.log('⏰ Resetting yearly reading goals...');
    try {
      await ReadingGoal.updateMany(
        { period: 'yearly' },
        { $set: { current: 0, achieved: false } }
      );
    } catch (err) {
      console.error('Yearly goal reset failed:', err);
    }
  });

  // ── 5. USER-SCHEDULED PERSONAL REMINDERS ──────────────────────────────────
  // Runs every minute — checks if current HH:MM matches any user's reminder time.
  // This is more efficient than creating thousands of dynamic cron jobs.
  cron.schedule('* * * * *', async () => {
    try {
      // Get current UTC time as "HH:MM"
      const now     = new Date();
      const hours   = String(now.getUTCHours()).padStart(2, '0');
      const minutes = String(now.getUTCMinutes()).padStart(2, '0');
      const currentTime = `${hours}:${minutes}`;

      // Find all enabled reminders set to fire right now
      const reminders = await ReadingReminder.find({
        enabled:      true,
        reminderTime: currentTime
      }).populate('userId');

      if (reminders.length === 0) return;

      console.log(`⏰ Firing ${reminders.length} user reading reminder(s) at ${currentTime} UTC`);

      for (const reminder of reminders) {
        // Avoid spamming — check if we already sent one today
        const startOfDay = new Date();
        startOfDay.setUTCHours(0, 0, 0, 0);

        const sentToday = await Notification.findOne({
          userId:    reminder.userId,
          type:      TYPES.REMINDER,
          title:     '⏰ Reading Time!',
          createdAt: { $gte: startOfDay }
        });

        if (!sentToday) {
          await createNotification({
            userId: reminder.userId,
            type:   TYPES.REMINDER,
            title:  '⏰ Reading Time!',
            body:   "It's your scheduled reading time. Open a book and keep the habit alive! 📚",
            link:   '/'
          });
        }
      }
    } catch (err) {
      console.error('User reminder job failed:', err);
    }
  });

  console.log('✅ All cron jobs registered.');
}

module.exports = { startCronJobs };
