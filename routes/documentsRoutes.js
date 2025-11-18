const express = require('express');
const router = express.Router();

// Import middleware
const { authenticateToken } = require('../middleware/auth');
const { checkFeatureAccess, requirePremiumOrTrial } = require('../middleware/featureAccess');
const { upload } = require('../middleware/upload');

// Import controllers
const {
  uploadDocument,
  getDocuments,
  getDocumentById,
  getDocumentOCRStatus,
  reprocessOCR,
  getUserOCRStats,
  summarizeDocument,
  extractActionPoints,
  getDecisionMaking,
  translateDocument,
  processVoiceCommand,
  createDocumentFromUrl,
  extractUrl,
  extractMultipleUrls,
  getOCRQuotaInfo,
  getOCRUsage
} = require('../controllers/documentsController');

// Import position functions from reading sessions controller
const {
  saveDocumentPosition,
  getDocumentPosition
} = require('../controllers/readingSessionsController');

// Upload document (root POST)
router.post('/', authenticateToken, checkFeatureAccess, upload.single('file'), uploadDocument);

// OCR routes (must be before /:id routes)
router.get('/user/ocr-stats', authenticateToken, getUserOCRStats);
router.get('/ocr/quota-info', authenticateToken, getOCRQuotaInfo);
router.get('/ocr/usage', authenticateToken, getOCRUsage);

// URL-based routes (must be before /:id routes)
router.post('/from-url', authenticateToken, createDocumentFromUrl);
router.post('/extract-url', authenticateToken, extractUrl);
router.post('/extract-multiple-urls', authenticateToken, extractMultipleUrls);

// Get all documents (root GET)
router.get('/', authenticateToken, getDocuments);

// Document-specific routes (with :id or :documentId parameter)
router.get('/:id', authenticateToken, getDocumentById);
router.get('/:id/ocr-status', authenticateToken, getDocumentOCRStatus);
router.post('/:id/reprocess-ocr', authenticateToken, upload.single('image'), reprocessOCR);

// Premium feature routes
router.post('/:id/summarize', authenticateToken, checkFeatureAccess, requirePremiumOrTrial, summarizeDocument);
router.post('/:id/action-points', authenticateToken, checkFeatureAccess, requirePremiumOrTrial, extractActionPoints);
router.post('/:id/decision-making', authenticateToken, checkFeatureAccess, requirePremiumOrTrial, getDecisionMaking);
router.post('/:id/translate', authenticateToken, checkFeatureAccess, requirePremiumOrTrial, translateDocument);

// Voice command route
router.post('/:id/voice-command', processVoiceCommand);

// Position routes
router.post('/:documentId/position', authenticateToken, saveDocumentPosition);
router.get('/:documentId/position', authenticateToken, getDocumentPosition);

module.exports = router;
