const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const {
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
} = require('../controllers/notificationsController');

// Register device token for push notifications
router.post('/register-token', authenticateToken, registerDeviceToken);

// Send immediate notification
router.post('/send-immediate', authenticateToken, sendImmediateNotification);

// Broadcast notification to multiple users
router.post('/broadcast', authenticateToken, broadcastNotification);

// Get user notifications
router.get('/', authenticateToken, getNotifications);

// Mark notification as read
router.put('/:id/read', authenticateToken, markNotificationAsRead);

// Mark all notifications as read
router.put('/mark-all-read', authenticateToken, markAllAsRead);

// Delete notification
router.delete('/:id', authenticateToken, deleteNotification);

// Get notification preferences
router.get('/preferences', authenticateToken, getNotificationPreferences);

// Update notification preferences
router.put('/preferences', authenticateToken, updateNotificationPreferences);

// Send test notification
router.post('/test', authenticateToken, sendTestNotification);

// Get notification delivery status
router.get('/:id/delivery-status', authenticateToken, getDeliveryStatus);

// Webhook for FCM delivery reports
router.post('/delivery-webhook', deliveryWebhook);

module.exports = router;
