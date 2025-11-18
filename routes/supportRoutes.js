const express = require('express');
const router = express.Router();
const { authenticateToken, authenticateAdmin } = require('../middleware/auth');
const {
  createSupportRequest,
  getMySupportRequests,
  getSupportRequestDetails,
  createRefundRequest,
  getAdminSupportRequests,
  getAdminSupportRequestDetails,
  updateSupportRequest,
  assignSupportRequest,
  getSupportStats
} = require('../controllers/supportController');

// User support routes
router.post('/create', authenticateToken, createSupportRequest);
router.get('/my-requests', authenticateToken, getMySupportRequests);
router.get('/requests/:requestId', authenticateToken, getSupportRequestDetails);
router.post('/refund-request', authenticateToken, createRefundRequest);

// Admin support routes
router.get('/admin/support-requests', authenticateAdmin, getAdminSupportRequests);
router.get('/admin/support-requests/:requestId', authenticateAdmin, getAdminSupportRequestDetails);
router.put('/admin/support-requests/:requestId', authenticateAdmin, updateSupportRequest);
router.put('/admin/support-requests/:requestId/assign', authenticateAdmin, assignSupportRequest);
router.get('/admin/support-stats', authenticateAdmin, getSupportStats);

module.exports = router;
