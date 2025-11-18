const express = require('express');
const router = express.Router();
const {
  getStatistics,
  trackAIAction,
  trackOCRProcessing,
  trackChatMessage,
  getReadingGoals,
  setReadingGoal,
  processVoiceCommandGlobal,
  getDashboardSummary,
  getUserFeatureLimits,
  getUserUsage
} = require('../controllers/statisticsController');
const { authenticateToken } = require('../middleware/auth');
const { checkFeatureAccess, requirePremiumOrTrial } = require('../middleware/featureAccess');
const { upload } = require('../middleware/upload');

// Statistics routes
router.get('/statistics', authenticateToken, getStatistics);

// Tracking routes
router.post('/track/ai-action', authenticateToken, trackAIAction);
router.post('/track/ocr-processing', authenticateToken, trackOCRProcessing);
router.post('/track/chat-message', authenticateToken, trackChatMessage);

// Reading goals routes
router.get('/reading-goals', authenticateToken, getReadingGoals);
router.post('/reading-goals', authenticateToken, setReadingGoal);

// Voice command route
router.post(
  '/voice-command',
  authenticateToken,
  checkFeatureAccess,
  requirePremiumOrTrial,
  upload.single('audio'),
  processVoiceCommandGlobal
);

// Dashboard summary route
router.get('/dashboard-summary', authenticateToken, getDashboardSummary);

// User feature limits and usage routes
router.get('/users/feature-limits', authenticateToken, getUserFeatureLimits);
router.get('/users/usage', authenticateToken, getUserUsage);

module.exports = router;
