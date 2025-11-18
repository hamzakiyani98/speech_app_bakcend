const { db } = require('../config/database');

// Check feature access based on user subscription plan
const checkFeatureAccess = async (req, res, next) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'User not authenticated' });
    }

    // Get user subscription plan
    const [users] = await db.query(
      'SELECT subscription_plan, is_trial, trial_end_date FROM users WHERE id = ?',
      [userId]
    );

    if (users.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = users[0];

    // Normalize plan to base type for limits lookup
    let planType = 'free';

    if (user.is_trial && user.trial_end_date && new Date(user.trial_end_date) > new Date()) {
      planType = 'trial';
    } else if (user.subscription_plan && user.subscription_plan !== 'free') {
      // Extract base plan from variants like "premium-yearly"
      planType = user.subscription_plan.includes('premium') ? 'premium' : 'free';
    }

    console.log('🔍 Feature access check:', {
      userId,
      rawPlan: user.subscription_plan,
      normalizedPlanType: planType
    });

    // Attach to request for use in route
    req.user.planType = planType;
    req.user.subscription_plan = user.subscription_plan;
    req.user.is_trial = user.is_trial;
    req.user.trial_end_date = user.trial_end_date;

    next();
  } catch (error) {
    console.error('Feature access check error:', error);
    res.status(500).json({ error: 'Failed to verify access' });
  }
};

// Verify premium subscription
const requirePremium = (req, res, next) => {
  if (req.user.planType !== 'premium') {
    return res.status(403).json({
      error: 'Premium subscription required',
      code: 'PREMIUM_REQUIRED',
      plan: req.user.planType,
      message: `This feature is only available for Premium users. Your current plan: ${req.user.planType}`
    });
  }
  next();
};

// Verify premium or trial access
const requirePremiumOrTrial = (req, res, next) => {
  if (req.user.planType !== 'premium' && req.user.planType !== 'trial') {
    return res.status(403).json({
      error: 'Premium or Trial subscription required',
      code: 'PREMIUM_REQUIRED',
      plan: req.user.planType,
      message: 'This feature is not available in the free plan'
    });
  }
  next();
};

module.exports = {
  checkFeatureAccess,
  requirePremium,
  requirePremiumOrTrial
};
