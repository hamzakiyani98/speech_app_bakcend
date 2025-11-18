const express = require('express');
const router = express.Router();
const {
  getPricingPlans,
  createPaymentIntent,
  processPayment,
  getSubscriptionStatus,
  cancelSubscription,
  processRefund,
  getRefundHistory,
  getAdminPricingPlans,
  createPricingPlan,
  updatePricingPlan,
  deletePricingPlan,
  getPlanGroups
} = require('../controllers/paymentsController');
const { authenticateToken, authenticateAdmin } = require('../middleware/auth');

// ==================== USER ROUTES ====================

// Get all active pricing plans for mobile app
router.get('/pricing-plans', authenticateToken, getPricingPlans);

// Create payment intent (for Stripe/PayPal - Debug APK simulation)
router.post('/payments/create-intent', authenticateToken, createPaymentIntent);

// Process payment and update subscription
router.post('/payments/process', authenticateToken, processPayment);

// Get user subscription status
router.get('/subscription/status', authenticateToken, getSubscriptionStatus);

// Cancel subscription
router.post('/subscription/cancel', authenticateToken, cancelSubscription);

// ==================== ADMIN ROUTES ====================

// ==================== REFUND PROCESSING ====================

// Process user refund
router.post('/admin/users/:userId/refund', authenticateAdmin, processRefund);

// Get user refund history
router.get('/admin/users/:userId/refunds', authenticateAdmin, getRefundHistory);

// ==================== PRICING PLANS MANAGEMENT ====================

// Get all pricing plans
router.get('/admin/pricing-plans', authenticateAdmin, getAdminPricingPlans);

// Create pricing plan (creates both monthly and yearly variants)
router.post('/admin/pricing-plans', authenticateAdmin, createPricingPlan);

// Update pricing plan group (updates both monthly and yearly variants)
router.put('/admin/pricing-plans/:planId', authenticateAdmin, updatePricingPlan);

// Delete pricing plan group (deletes both monthly and yearly variants)
router.delete('/admin/pricing-plans/:planGroup', authenticateAdmin, deletePricingPlan);

// Get all pricing plan groups (grouped by plan_group)
router.get('/admin/pricing-plans/groups', authenticateAdmin, getPlanGroups);

module.exports = router;
