const express = require('express');
const router = express.Router();
const { authenticateAdmin } = require('../middleware/auth');
const {
  setupAdmin,
  loginAdmin,
  getAdminProfile,
  getDashboard,
  getAnalytics,
  getFeatureLimits,
  updateFeatureLimit,
  updateFeatureLimitsByPlan,
  getUsers,
  getUserDetails,
  updateUserStatus,
  deleteUser,
  getDocuments,
  deleteDocument,
  getSettings,
  updateSetting,
  getLogs,
  broadcastNotification,
  exportData,
  getFeatureFlags,
  updateFeatureFlag,
  getSystemHealth
} = require('../controllers/adminController');

// Public routes (no middleware)
router.post('/setup', setupAdmin);
router.post('/login', loginAdmin);

// Admin profile (controller handles token verification)
router.get('/me', getAdminProfile);

// Protected admin routes (with authenticateAdmin middleware)
router.get('/dashboard', authenticateAdmin, getDashboard);
router.get('/analytics', authenticateAdmin, getAnalytics);
router.get('/feature-limits', authenticateAdmin, getFeatureLimits);
router.put('/feature-limits/:id', authenticateAdmin, updateFeatureLimit);
router.put('/feature-limits/plan/:planType', authenticateAdmin, updateFeatureLimitsByPlan);
router.get('/users', authenticateAdmin, getUsers);
router.get('/users/:userId', authenticateAdmin, getUserDetails);
router.put('/users/:userId/status', authenticateAdmin, updateUserStatus);
router.delete('/users/:userId', authenticateAdmin, deleteUser);
router.get('/documents', authenticateAdmin, getDocuments);
router.delete('/documents/:documentId', authenticateAdmin, deleteDocument);
router.get('/settings', authenticateAdmin, getSettings);
router.put('/settings/:settingKey', authenticateAdmin, updateSetting);
router.get('/logs', authenticateAdmin, getLogs);
router.post('/broadcast-notification', authenticateAdmin, broadcastNotification);
router.get('/export/:dataType', authenticateAdmin, exportData);
router.get('/feature-flags', authenticateAdmin, getFeatureFlags);
router.put('/feature-flags/:flagName', authenticateAdmin, updateFeatureFlag);
router.get('/system-health', authenticateAdmin, getSystemHealth);

module.exports = router;
