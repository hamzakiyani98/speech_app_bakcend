const express = require('express');
const router = express.Router();

// Import middleware
const { authenticateToken } = require('../middleware/auth');
const { checkFeatureAccess } = require('../middleware/featureAccess');

// Import controllers
const {
  startReadingSession,
  updateReadingProgress,
  endReadingSession,
  saveReadingPosition,
  loadReadingPosition,
  saveDocumentPosition,
  getDocumentPosition
} = require('../controllers/readingSessionsController');

// Start reading session
router.post('/start', authenticateToken, checkFeatureAccess, startReadingSession);

// Update reading session progress
router.put('/:sessionId/progress', authenticateToken, updateReadingProgress);

// End reading session
router.post('/:sessionId/end', authenticateToken, endReadingSession);

// Save reading position
router.post('/position', authenticateToken, saveReadingPosition);

// Load reading position
router.get('/position/:documentId', authenticateToken, loadReadingPosition);

module.exports = router;
