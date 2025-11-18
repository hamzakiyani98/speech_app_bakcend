const cron = require('node-cron');
const { db } = require('./database');
const { cleanExpiredOTPs } = require('../models/database');
const { createNotification } = require('../utils/notifications');

/**
 * Initialize all cron jobs and scheduled tasks
 */
const initializeCronJobs = () => {
  // Daily reading reminder (cron job)
  cron.schedule('0 18 * * *', async () => {
    try {
      console.log('📅 Running daily reading reminder...');

      const [users] = await db.query(`
      SELECT u.id, u.username
      FROM users u
      JOIN notification_preferences np ON u.id = np.user_id
      WHERE np.reading_reminders = TRUE AND np.push_enabled = TRUE
    `);

      for (const user of users) {
        await createNotification(
          user.id,
          'Daily Reading Goal',
          `Hi ${user.username}! Don't forget to continue your reading journey today.`,
          'daily_reminder',
          { action: 'open_app' }
        );
      }

      console.log(`✅ Sent daily reminders to ${users.length} users`);
    } catch (error) {
      console.error('❌ Daily reminder error:', error);
    }
  });

  // Schedule cleanup every hour
  setInterval(cleanExpiredOTPs, 60 * 60 * 1000);

  console.log('✅ Cron jobs initialized');
};

module.exports = { initializeCronJobs };
