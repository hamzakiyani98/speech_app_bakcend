const { db } = require('../config/database');
const { sendPushNotification, createNotification } = require('../utils/notifications');
const { admin, firebaseApp } = require('../config/services');

// Register device token
const registerDeviceToken = async (req, res) => {
  try {
    const { deviceToken, deviceType, deviceId, appVersion } = req.body;

    if (!deviceToken || !deviceType) {
      return res.status(400).json({ error: 'Device token and type are required' });
    }

    // Validate device token format
    if (typeof deviceToken !== 'string' || deviceToken.length < 50) {
      return res.status(400).json({ error: 'Invalid device token format' });
    }

    console.log('📱 Registering device token:', {
      userId: req.user.id,
      deviceType,
      tokenLength: deviceToken.length,
      deviceId: deviceId?.substring(0, 10) + '...' || 'N/A'
    });

    // Test the token by sending a silent notification
    try {
      const testResult = await admin.messaging().send({
        token: deviceToken,
        data: {
          type: 'registration_test',
          timestamp: Date.now().toString()
        },
        android: {
          priority: 'normal',
        },
        apns: {
          headers: {
            'apns-priority': '5',
          },
          payload: {
            aps: {
              'content-available': 1,
            },
          },
        },
      });

      console.log('✅ Token validation successful:', testResult);
    } catch (testError) {
      console.warn('⚠️ Token validation failed:', testError.code);
      if (testError.code === 'messaging/invalid-registration-token') {
        return res.status(400).json({ error: 'Invalid device token' });
      }
    }

    // Upsert device token
    await db.query(`
      INSERT INTO user_device_tokens (user_id, device_token, device_type, device_id, app_version, is_active)
      VALUES (?, ?, ?, ?, ?, TRUE)
      ON DUPLICATE KEY UPDATE
      device_type = VALUES(device_type),
      device_id = VALUES(device_id),
      app_version = VALUES(app_version),
      is_active = TRUE,
      updated_at = CURRENT_TIMESTAMP
    `, [req.user.id, deviceToken, deviceType, deviceId, appVersion]);

    // Initialize notification preferences if not exists
    await db.query(`
      INSERT IGNORE INTO notification_preferences (user_id) VALUES (?)
    `, [req.user.id]);

    // Send welcome notification
    await createNotification(
      req.user.id,
      'Welcome!',
      'Push notifications are now enabled for your account.',
      'system',
      { registration: true }
    );

    res.json({
      success: true,
      message: 'Device token registered successfully',
      tokenValidated: true
    });

  } catch (error) {
    console.error('❌ Register token error:', error);
    res.status(500).json({ error: 'Failed to register device token' });
  }
};

// Send immediate notification
const sendImmediateNotification = async (req, res) => {
  try {
    const { title, message, data = {} } = req.body;

    if (!title || !message) {
      return res.status(400).json({ error: 'Title and message are required' });
    }

    console.log('📤 Sending immediate notification:', { title, message, userId: req.user.id });

    // Get user's device tokens
    const [tokens] = await db.query(
      `SELECT device_token FROM user_device_tokens
       WHERE user_id = ? AND is_active = 1`,
      [req.user.id]
    );

    if (tokens.length === 0) {
      return res.status(404).json({ error: 'No active device tokens found' });
    }

    const deviceTokens = tokens.map(t => t.device_token);

    // Send notification
    const result = await sendPushNotification(deviceTokens, title, message, data);

    if (result.success) {
      // Also save to database
      await createNotification(req.user.id, title, message, 'manual', data, false);

      res.json({
        success: true,
        message: 'Notification sent successfully',
        sentTo: result.successCount,
        failed: result.failureCount
      });
    } else {
      res.status(500).json({
        success: false,
        error: result.error
      });
    }

  } catch (error) {
    console.error('❌ Send immediate notification error:', error);
    res.status(500).json({ error: 'Failed to send notification' });
  }
};

// Broadcast notification
const broadcastNotification = async (req, res) => {
  try {
    const { title, message, data = {}, targetUserIds = [] } = req.body;

    if (!title || !message) {
      return res.status(400).json({ error: 'Title and message are required' });
    }

    console.log('📢 Broadcasting notification:', { title, message, targetUsers: targetUserIds.length });

    let whereClause = 'WHERE is_active = TRUE';
    let queryParams = [];

    if (targetUserIds.length > 0) {
      const placeholders = targetUserIds.map(() => '?').join(',');
      whereClause += ` AND user_id IN (${placeholders})`;
      queryParams = [...targetUserIds];
    }

    // Get all active device tokens
    const [tokens] = await db.query(
      `SELECT user_id, device_token FROM user_device_tokens ${whereClause}`,
      queryParams
    );

    if (tokens.length === 0) {
      return res.status(404).json({ error: 'No active device tokens found' });
    }

    // Group tokens by user for database saving
    const tokensByUser = {};
    const allTokens = [];

    tokens.forEach(({ user_id, device_token }) => {
      if (!tokensByUser[user_id]) {
        tokensByUser[user_id] = [];
      }
      tokensByUser[user_id].push(device_token);
      allTokens.push(device_token);
    });

    // Send notifications in batches (FCM limit is 500 tokens per request)
    const batchSize = 500;
    let totalSent = 0;
    let totalFailed = 0;

    for (let i = 0; i < allTokens.length; i += batchSize) {
      const batch = allTokens.slice(i, i + batchSize);
      const result = await sendPushNotification(batch, title, message, data);

      if (result.success) {
        totalSent += result.successCount;
        totalFailed += result.failureCount;
      }
    }

    // Save notifications to database for each user
    for (const userId of Object.keys(tokensByUser)) {
      await createNotification(parseInt(userId), title, message, 'broadcast', data, false);
    }

    res.json({
      success: true,
      message: 'Broadcast notification sent',
      totalUsers: Object.keys(tokensByUser).length,
      totalSent,
      totalFailed
    });

  } catch (error) {
    console.error('❌ Broadcast notification error:', error);
    res.status(500).json({ error: 'Failed to send broadcast notification' });
  }
};

// Get user notifications
const getNotifications = async (req, res) => {
  try {
    const { page = 1, limit = 20, unreadOnly = false } = req.query;
    const offset = (page - 1) * limit;

    let whereClause = 'WHERE user_id = ?';
    let queryParams = [req.user.id];

    if (unreadOnly === 'true') {
      whereClause += ' AND is_read = FALSE';
    }

    const [notifications] = await db.query(`
      SELECT id, title, message, type, data, is_read, created_at, sent_at
      FROM notifications
      ${whereClause}
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `, [...queryParams, parseInt(limit), parseInt(offset)]);

    // Get unread count
    const [unreadCount] = await db.query(
      'SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND is_read = FALSE',
      [req.user.id]
    );

    // Parse JSON data
    const parsedNotifications = notifications.map(notification => ({
      ...notification,
      data: notification.data ? JSON.parse(notification.data) : {}
    }));

    res.json({
      notifications: parsedNotifications,
      unreadCount: unreadCount[0].count,
      page: parseInt(page),
      limit: parseInt(limit),
      hasMore: notifications.length === parseInt(limit)
    });
  } catch (error) {
    console.error('❌ Get notifications error:', error);
    res.status(500).json({ error: 'Failed to fetch notifications' });
  }
};

// Mark notification as read
const markNotificationAsRead = async (req, res) => {
  try {
    const [result] = await db.query(
      'UPDATE notifications SET is_read = TRUE WHERE id = ? AND user_id = ?',
      [req.params.id, req.user.id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Notification not found' });
    }

    res.json({ success: true, message: 'Notification marked as read' });
  } catch (error) {
    console.error('❌ Mark read error:', error);
    res.status(500).json({ error: 'Failed to mark notification as read' });
  }
};

// Mark all notifications as read
const markAllAsRead = async (req, res) => {
  try {
    await db.query(
      'UPDATE notifications SET is_read = TRUE WHERE user_id = ? AND is_read = FALSE',
      [req.user.id]
    );

    res.json({ success: true, message: 'All notifications marked as read' });
  } catch (error) {
    console.error('❌ Mark all read error:', error);
    res.status(500).json({ error: 'Failed to mark all notifications as read' });
  }
};

// Delete notification
const deleteNotification = async (req, res) => {
  try {
    const [result] = await db.query(
      'DELETE FROM notifications WHERE id = ? AND user_id = ?',
      [req.params.id, req.user.id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Notification not found' });
    }

    res.json({ success: true, message: 'Notification deleted' });
  } catch (error) {
    console.error('❌ Delete notification error:', error);
    res.status(500).json({ error: 'Failed to delete notification' });
  }
};

// Get notification preferences
const getNotificationPreferences = async (req, res) => {
  try {
    const [preferences] = await db.query(
      'SELECT * FROM notification_preferences WHERE user_id = ?',
      [req.user.id]
    );

    if (preferences.length === 0) {
      // Create default preferences
      await db.query(
        'INSERT INTO notification_preferences (user_id) VALUES (?)',
        [req.user.id]
      );

      const [newPreferences] = await db.query(
        'SELECT * FROM notification_preferences WHERE user_id = ?',
        [req.user.id]
      );

      return res.json(newPreferences[0]);
    }

    res.json(preferences[0]);
  } catch (error) {
    console.error('❌ Get preferences error:', error);
    res.status(500).json({ error: 'Failed to fetch notification preferences' });
  }
};

// Update notification preferences
const updateNotificationPreferences = async (req, res) => {
  try {
    const {
      push_enabled,
      email_enabled,
      reading_reminders,
      achievement_notifications,
      content_notifications,
      system_notifications,
      quiet_hours_start,
      quiet_hours_end,
      timezone
    } = req.body;

    await db.query(`
      UPDATE notification_preferences SET
        push_enabled = ?,
        email_enabled = ?,
        reading_reminders = ?,
        achievement_notifications = ?,
        content_notifications = ?,
        system_notifications = ?,
        quiet_hours_start = ?,
        quiet_hours_end = ?,
        timezone = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE user_id = ?
    `, [
      push_enabled, email_enabled, reading_reminders,
      achievement_notifications, content_notifications, system_notifications,
      quiet_hours_start, quiet_hours_end, timezone, req.user.id
    ]);

    res.json({ success: true, message: 'Preferences updated successfully' });
  } catch (error) {
    console.error('❌ Update preferences error:', error);
    res.status(500).json({ error: 'Failed to update notification preferences' });
  }
};

// Send test notification
const sendTestNotification = async (req, res) => {
  try {
    const {
      title = 'Test Notification',
      message = 'This is a test notification from your backend server!',
      data = {}
    } = req.body;

    console.log('🧪 Sending test notification to user:', req.user.id);

    // Get user's device tokens
    const [tokens] = await db.query(
      `SELECT device_token, device_type, updated_at FROM user_device_tokens
       WHERE user_id = ? AND is_active = TRUE`,
      [req.user.id]
    );

    if (tokens.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'No device tokens found. Please ensure the app is properly registered.',
        suggestion: 'Try restarting the app or checking your device registration.'
      });
    }

    console.log(`📱 Found ${tokens.length} device token(s):`,
      tokens.map(t => ({
        type: t.device_type,
        lastUpdated: t.updated_at,
        tokenPreview: t.device_token.substring(0, 20) + '...'
      }))
    );

    const deviceTokens = tokens.map(t => t.device_token);

    // Enhanced test data with proper formatting (all strings)
    const testData = {
      test: 'true', // Convert boolean to string
      timestamp: new Date().toISOString(),
      userId: String(req.user.id), // Ensure userId is a string
      notificationType: 'test',
      source: 'backend_test',
      ...Object.fromEntries(
        Object.entries(data).map(([key, value]) => [key, String(value)])
      )
    };

    console.log('🧪 Test data being sent:', testData);

    // Send the notification
    const result = await sendPushNotification(deviceTokens, title, message, testData);

    if (result.success) {
      // Save test notification to database
      await createNotification(req.user.id, title, message, 'test', testData, false);

      res.json({
        success: true,
        message: 'Test notification sent successfully!',
        details: {
          sentTo: result.successCount,
          failed: result.failureCount,
          totalTokens: deviceTokens.length,
          devices: tokens.map(t => t.device_type),
          testData: testData
        }
      });
    } else {
      res.status(500).json({
        success: false,
        error: result.error,
        details: {
          totalTokens: deviceTokens.length,
          firebaseInitialized: !!firebaseApp,
          failedTokens: result.failedTokens
        }
      });
    }

  } catch (error) {
    console.error('❌ Test notification error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to send test notification: ' + error.message,
      errorCode: error.code || 'UNKNOWN_ERROR'
    });
  }
};

// Get notification delivery status
const getDeliveryStatus = async (req, res) => {
  try {
    const [notification] = await db.query(
      `SELECT n.*, COUNT(udt.device_token) as device_count
       FROM notifications n
       LEFT JOIN user_device_tokens udt ON n.user_id = udt.user_id AND udt.is_active = TRUE
       WHERE n.id = ? AND n.user_id = ?
       GROUP BY n.id`,
      [req.params.id, req.user.id]
    );

    if (notification.length === 0) {
      return res.status(404).json({ error: 'Notification not found' });
    }

    const notif = notification[0];

    res.json({
      id: notif.id,
      title: notif.title,
      message: notif.message,
      type: notif.type,
      sent: notif.is_sent,
      sentAt: notif.sent_at,
      deviceCount: notif.device_count,
      createdAt: notif.created_at
    });

  } catch (error) {
    console.error('❌ Get delivery status error:', error);
    res.status(500).json({ error: 'Failed to get delivery status' });
  }
};

// Webhook for FCM delivery reports (optional)
const deliveryWebhook = (req, res) => {
  try {
    console.log('📊 FCM delivery report:', req.body);

    // Process delivery reports here if needed
    // This endpoint can be configured in Firebase Console

    res.status(200).json({ received: true });
  } catch (error) {
    console.error('❌ Webhook error:', error);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
};

module.exports = {
  registerDeviceToken,
  sendImmediateNotification,
  broadcastNotification,
  getNotifications,
  markNotificationAsRead,
  markAllAsRead,
  deleteNotification,
  getNotificationPreferences,
  updateNotificationPreferences,
  sendTestNotification,
  getDeliveryStatus,
  deliveryWebhook
};
