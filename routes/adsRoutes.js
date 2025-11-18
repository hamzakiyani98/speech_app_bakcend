const express = require('express');
const router = express.Router();
const {
  getAds,
  createAd,
  updateAd,
  deleteAd,
  getAllActiveAds,
  getAdsByPage,
  getSubscriptionPlans,
  uploadAdImage,
  deleteAdImage,
  trackAdImpression,
  trackAdClick
} = require('../controllers/adsController');
const { authenticateToken, authenticateAdmin } = require('../middleware/auth');
const { uploadAdImage: uploadAdImageMiddleware } = require('../middleware/upload');

// ==================== ADMIN ROUTES ====================

// Get all ads (admin)
router.get('/admin/ads', authenticateAdmin, getAds);

// Create new ad
router.post('/admin/ads', authenticateAdmin, createAd);

// Update ad
router.put('/admin/ads/:id', authenticateAdmin, updateAd);

// Delete ad
router.delete('/admin/ads/:id', authenticateAdmin, deleteAd);

// Get available subscription plans for ad targeting
router.get('/admin/subscription-plans', authenticateAdmin, getSubscriptionPlans);

// Upload advertisement image
router.post('/admin/ads/upload-image', authenticateAdmin, uploadAdImageMiddleware.single('image'), uploadAdImage);

// Delete advertisement image
router.delete('/admin/ads/delete-image', authenticateAdmin, deleteAdImage);

// ==================== USER ROUTES ====================

// Get all active ads (for full-screen random display)
router.get('/ads/all-active', authenticateToken, getAllActiveAds);

// Get ads for specific page (for mobile app)
router.get('/ads/page/:pageId', authenticateToken, getAdsByPage);

// Update ad impression count
router.post('/ads/:adId/impression', authenticateToken, trackAdImpression);

// Update ad click count
router.post('/ads/:adId/click', authenticateToken, trackAdClick);

module.exports = router;
