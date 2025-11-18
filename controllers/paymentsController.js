const db = require('../config/database');
const { logAdminAction } = require('../utils/adminLogger');

// Helper functions from server.js
const createNotification = async (userId, title, message, type = 'general', data = {}, sendPush = true) => {
  try {
    // Validate inputs
    if (!userId || userId <= 0) {
      console.warn('⚠️ Invalid userId for notification');
      return { success: false, error: 'Invalid user ID' };
    }

    if (!title || typeof title !== 'string') {
      console.warn('⚠️ Invalid title for notification');
      return { success: false, error: 'Invalid title' };
    }

    if (!message || typeof message !== 'string') {
      console.warn('⚠️ Invalid message for notification');
      return { success: false, error: 'Invalid message' };
    }

    const userIdNum = parseInt(userId);
    const titleStr = String(title).substring(0, 255);
    const messageStr = String(message).substring(0, 1000);

    // Store notification in database
    const [result] = await db.query(
      `INSERT INTO notifications (user_id, title, message, type, data)
       VALUES (?, ?, ?, ?, ?)`,
      [userIdNum, titleStr, messageStr, type, JSON.stringify(data)]
    );

    console.log(`✅ Notification created for user ${userIdNum}:`, titleStr);

    // Send push notification if enabled
    if (sendPush) {
      // Push notification logic would go here
      // This is a placeholder for the actual implementation
    }

    return { success: true, notificationId: result.insertId };
  } catch (error) {
    console.error('❌ Create notification error:', error);
    return { success: false, error: error.message };
  }
};

const trackActivity = async (userId, activityType, entityType = null, entityId = null, activityData = {}, durationSeconds = 0) => {
  try {
    await db.query(
      `INSERT INTO user_activities (user_id, activity_type, entity_type, entity_id, activity_data, duration_seconds)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [userId, activityType, entityType, entityId, JSON.stringify(activityData), durationSeconds]
    );
  } catch (error) {
    console.error('❌ Track activity error:', error);
  }
};

// Get all active pricing plans for mobile app
const getPricingPlans = async (req, res) => {
  try {
    const [plans] = await db.query(`
      SELECT
        id,
        plan_name,
        plan_identifier,
        plan_group,
        description,
        price,
        currency,
        billing_period,
        features,
        is_active,
        sort_order
      FROM pricing_plans
      WHERE is_active = TRUE
      ORDER BY sort_order ASC, price ASC
    `);

    const processedPlans = plans.map(plan => ({
      ...plan,
      features: plan.features ? JSON.parse(plan.features) : []
    }));

    // Group by plan_group for better mobile display
    const groupedPlans = processedPlans.reduce((acc, plan) => {
      if (!acc[plan.plan_group]) {
        acc[plan.plan_group] = {
          group: plan.plan_group,
          name: plan.plan_name,
          description: plan.description,
          features: plan.features,
          variants: []
        };
      }
      acc[plan.plan_group].variants.push({
        id: plan.id,
        identifier: plan.plan_identifier,
        price: plan.price,
        currency: plan.currency,
        billing_period: plan.billing_period
      });
      return acc;
    }, {});

    res.json({
      success: true,
      plans: Object.values(groupedPlans)
    });

  } catch (error) {
    console.error('❌ Get pricing plans error:', error);
    res.status(500).json({ error: 'Failed to fetch pricing plans' });
  }
};

// Create payment intent (for Stripe/PayPal - Debug APK simulation)
const createPaymentIntent = async (req, res) => {
  try {
    const { plan_id, billing_period } = req.body;

    if (!plan_id) {
      return res.status(400).json({ error: 'Plan ID is required' });
    }

    // Get plan details
    const [plans] = await db.query(
      'SELECT * FROM pricing_plans WHERE id = ? AND billing_period = ?',
      [plan_id, billing_period || 'monthly']
    );

    if (plans.length === 0) {
      return res.status(404).json({ error: 'Plan not found' });
    }

    const plan = plans[0];

    // FOR DEBUG APK: Simulate payment intent
    // In production, you would integrate with Stripe/PayPal/Google Play Billing
    const mockPaymentIntent = {
      id: `pi_debug_${Date.now()}_${req.user.id}`,
      client_secret: `pi_secret_${Date.now()}`,
      amount: plan.price * 100, // Convert to cents
      currency: plan.currency.toLowerCase(),
      status: 'requires_payment_method',
      plan_id: plan.id,
      plan_identifier: plan.plan_identifier,
      plan_name: plan.plan_name,
      billing_period: plan.billing_period
    };

    console.log('💳 Payment intent created (DEBUG MODE):', mockPaymentIntent.id);

    res.json({
      success: true,
      payment_intent: mockPaymentIntent,
      plan: {
        id: plan.id,
        name: plan.plan_name,
        price: plan.price,
        currency: plan.currency,
        billing_period: plan.billing_period,
        features: JSON.parse(plan.features || '[]')
      }
    });

  } catch (error) {
    console.error('❌ Create payment intent error:', error);
    res.status(500).json({ error: 'Failed to create payment intent' });
  }
};

// Process payment and update subscription
const processPayment = async (req, res) => {
  try {
    const { payment_intent_id, plan_id, payment_method = 'card' } = req.body;

    if (!payment_intent_id || !plan_id) {
      return res.status(400).json({ error: 'Payment intent ID and plan ID are required' });
    }

    // Get plan details
    const [plans] = await db.query('SELECT * FROM pricing_plans WHERE id = ?', [plan_id]);

    if (plans.length === 0) {
      return res.status(404).json({ error: 'Plan not found' });
    }

    const plan = plans[0];

    // FOR DEBUG APK: Simulate successful payment
    // In production, verify payment with Stripe/PayPal/Google Play
    const paymentSuccess = true; // Simulate success for debug

    if (!paymentSuccess) {
      return res.status(400).json({ error: 'Payment failed' });
    }

    // Calculate subscription dates
    const subscriptionStartDate = new Date();
    const subscriptionEndDate = new Date();

    if (plan.billing_period === 'monthly') {
      subscriptionEndDate.setMonth(subscriptionEndDate.getMonth() + 1);
    } else if (plan.billing_period === 'yearly') {
      subscriptionEndDate.setFullYear(subscriptionEndDate.getFullYear() + 1);
    }

    const nextBillingDate = new Date(subscriptionEndDate);

    // Start transaction
    await db.query('START TRANSACTION');

    try {
      // Update user subscription
      await db.query(
        `UPDATE users SET
          subscription_plan = ?,
          subscription_status = 'active',
          subscription_start_date = ?,
          subscription_end_date = ?,
          next_billing_date = ?,
          payment_method = ?,
          is_trial = FALSE,
          trial_end_date = NULL
         WHERE id = ?`,
        [
          plan.plan_identifier,
          subscriptionStartDate,
          subscriptionEndDate,
          nextBillingDate,
          payment_method,
          req.user.id
        ]
      );

      // Record payment
      await db.query(
        `INSERT INTO user_payments (
          user_id, payment_id, amount, currency, payment_method,
          payment_status, transaction_id, plan_id
        ) VALUES (?, ?, ?, ?, ?, 'completed', ?, ?)`,
        [
          req.user.id,
          payment_intent_id,
          plan.price,
          plan.currency,
          payment_method,
          payment_intent_id,
          plan.id
        ]
      );

      // Commit transaction
      await db.query('COMMIT');

      // Send success notification
      await createNotification(
        req.user.id,
        'Subscription Activated!',
        `Your ${plan.plan_name} subscription is now active. Enjoy all premium features!`,
        'subscription_activated',
        {
          plan_name: plan.plan_name,
          amount: plan.price,
          currency: plan.currency,
          billing_period: plan.billing_period
        }
      );

      console.log('✅ Subscription activated for user:', req.user.id);

      res.json({
        success: true,
        message: 'Payment processed successfully',
        subscription: {
          plan: plan.plan_name,
          plan_identifier: plan.plan_identifier,
          status: 'active',
          start_date: subscriptionStartDate,
          end_date: subscriptionEndDate,
          next_billing_date: nextBillingDate
        }
      });

    } catch (error) {
      await db.query('ROLLBACK');
      throw error;
    }

  } catch (error) {
    console.error('❌ Process payment error:', error);
    res.status(500).json({ error: 'Payment processing failed' });
  }
};

// Get user subscription status
const getSubscriptionStatus = async (req, res) => {
  try {
    const [users] = await db.query(
      `SELECT
        subscription_plan,
        subscription_status,
        subscription_start_date,
        subscription_end_date,
        next_billing_date,
        payment_method,
        is_trial,
        trial_end_date
       FROM users WHERE id = ?`,
      [req.user.id]
    );

    if (users.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = users[0];
    const now = new Date();

    // Check if trial expired
    if (user.is_trial && user.trial_end_date && new Date(user.trial_end_date) < now) {
      await db.query(
        'UPDATE users SET is_trial = FALSE, subscription_status = "expired" WHERE id = ?',
        [req.user.id]
      );
      user.is_trial = false;
      user.subscription_status = 'expired';
    }

    // Get plan details if subscribed
    let planDetails = null;
    if (user.subscription_plan && user.subscription_plan !== 'free') {
      const [plans] = await db.query(
        'SELECT * FROM pricing_plans WHERE plan_identifier = ?',
        [user.subscription_plan]
      );
      if (plans.length > 0) {
        planDetails = {
          ...plans[0],
          features: JSON.parse(plans[0].features || '[]')
        };
      }
    }

    res.json({
      success: true,
      subscription: {
        is_trial: user.is_trial,
        trial_end_date: user.trial_end_date,
        trial_days_remaining: user.is_trial && user.trial_end_date
          ? Math.max(0, Math.ceil((new Date(user.trial_end_date) - now) / (1000 * 60 * 60 * 24)))
          : 0,
        plan: user.subscription_plan || 'free',
        status: user.subscription_status || 'inactive',
        start_date: user.subscription_start_date,
        end_date: user.subscription_end_date,
        next_billing_date: user.next_billing_date,
        payment_method: user.payment_method,
        plan_details: planDetails
      }
    });

  } catch (error) {
    console.error('❌ Get subscription status error:', error);
    res.status(500).json({ error: 'Failed to fetch subscription status' });
  }
};

// Cancel subscription
const cancelSubscription = async (req, res) => {
  try {
    const { reason } = req.body;

    await db.query(
      `UPDATE users SET
        subscription_status = 'cancelled',
        updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [req.user.id]
    );

    // Log cancellation
    await trackActivity(
      req.user.id,
      'subscription_cancelled',
      'subscription',
      null,
      { reason }
    );

    // Notify user
    await createNotification(
      req.user.id,
      'Subscription Cancelled',
      'Your subscription has been cancelled. You can continue using premium features until the end of your billing period.',
      'subscription_cancelled',
      { reason }
    );

    res.json({
      success: true,
      message: 'Subscription cancelled successfully'
    });

  } catch (error) {
    console.error('❌ Cancel subscription error:', error);
    res.status(500).json({ error: 'Failed to cancel subscription' });
  }
};

// Process user refund
const processRefund = async (req, res) => {
  try {
    const { userId } = req.params;
    const { type, value, reason } = req.body;

    if (!type || !value || !reason) {
      return res.status(400).json({ error: 'All refund details are required' });
    }

    // Validate refund type and value
    if (!['amount', 'percent'].includes(type)) {
      return res.status(400).json({ error: 'Invalid refund type' });
    }

    if (type === 'percent' && (value < 0 || value > 100)) {
      return res.status(400).json({ error: 'Percentage must be between 0 and 100' });
    }

    if (type === 'amount' && value < 0) {
      return res.status(400).json({ error: 'Amount must be positive' });
    }

    // Get user information
    const [users] = await db.query(
      'SELECT username, email FROM users WHERE id = ? AND role = "user"',
      [userId]
    );

    if (users.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Insert refund record
    const [result] = await db.query(
      `INSERT INTO refunds (user_id, refund_type, refund_value, reason, processed_by, status)
       VALUES (?, ?, ?, ?, ?, 'processed')`,
      [userId, type, value, reason, req.user.id]
    );

    await logAdminAction(
      req.user.id,
      'process_refund',
      'user',
      userId,
      { type, value, reason, refundId: result.insertId },
      req
    );

    // Send notification to user
    await createNotification(
      parseInt(userId),
      'Refund Processed',
      `Your refund has been processed. ${type === 'percent' ? value + '% refund' : '$' + value + ' refund'} for: ${reason}`,
      'refund',
      { refundId: result.insertId, type, value }
    );

    res.json({
      success: true,
      message: 'Refund processed successfully',
      refundId: result.insertId
    });

  } catch (error) {
    console.error('❌ Process refund error:', error);
    res.status(500).json({ error: 'Failed to process refund' });
  }
};

// Get user refund history
const getRefundHistory = async (req, res) => {
  try {
    const { userId } = req.params;

    const [refunds] = await db.query(`
      SELECT r.*, u.username as processed_by_username
      FROM refunds r
      LEFT JOIN users u ON r.processed_by = u.id
      WHERE r.user_id = ?
      ORDER BY r.created_at DESC
    `, [userId]);

    res.json({
      success: true,
      refunds
    });

  } catch (error) {
    console.error('❌ Get refunds error:', error);
    res.status(500).json({ error: 'Failed to fetch refunds' });
  }
};

// Get all pricing plans
const getAdminPricingPlans = async (req, res) => {
  try {
    const [plans] = await db.query(`
      SELECT pp.*,
        u1.username as created_by_username,
        u2.username as updated_by_username
      FROM pricing_plans pp
      LEFT JOIN users u1 ON pp.created_by = u1.id
      LEFT JOIN users u2 ON pp.updated_by = u2.id
      ORDER BY pp.sort_order ASC, pp.created_at DESC
    `);

    const processedPlans = plans.map(plan => ({
      ...plan,
      features: plan.features ? JSON.parse(plan.features) : []
    }));

    await logAdminAction(req.user.id, 'view_pricing_plans', null, null, {}, req);

    res.json({
      success: true,
      plans: processedPlans
    });

  } catch (error) {
    console.error('❌ Get pricing plans error:', error);
    res.status(500).json({ error: 'Failed to fetch pricing plans' });
  }
};

// Create pricing plan (creates both monthly and yearly variants)
const createPricingPlan = async (req, res) => {
  try {
    const {
      plan_group,
      plan_name,
      description,
      monthly_price,
      yearly_price,
      currency = 'USD',
      features = [],
      is_active = true,
      sort_order = 0
    } = req.body;

    // Validation
    if (!plan_group || !plan_name || !monthly_price || !yearly_price) {
      return res.status(400).json({
        error: 'Plan group, name, monthly price, and yearly price are required'
      });
    }

    if (monthly_price <= 0 || yearly_price <= 0) {
      return res.status(400).json({
        error: 'Prices must be greater than 0'
      });
    }

    // Check if plan group already exists
    const [existingGroup] = await db.query(
      'SELECT plan_group FROM pricing_plans WHERE plan_group = ? LIMIT 1',
      [plan_group]
    );

    if (existingGroup.length > 0) {
      return res.status(400).json({
        error: 'Plan group already exists. Use a different plan group identifier.'
      });
    }

    // Generate plan identifiers
    const monthlyPlanId = `${plan_group}-monthly`;
    const yearlyPlanId = `${plan_group}-yearly`;

    // Start transaction
    await db.query('START TRANSACTION');

    try {
      // Insert monthly plan
      const [monthlyResult] = await db.query(
        `INSERT INTO pricing_plans (
          plan_group, plan_name, plan_identifier, description, price,
          currency, billing_period, features, is_active, sort_order,
          created_by, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'monthly', ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
        [
          plan_group,
          plan_name,
          monthlyPlanId,
          description,
          monthly_price,
          currency,
          JSON.stringify(features),
          is_active,
          sort_order,
          req.user.id
        ]
      );

      // Insert yearly plan
      const [yearlyResult] = await db.query(
        `INSERT INTO pricing_plans (
          plan_group, plan_name, plan_identifier, description, price,
          currency, billing_period, features, is_active, sort_order,
          created_by, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'yearly', ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
        [
          plan_group,
          plan_name,
          yearlyPlanId,
          description,
          yearly_price,
          currency,
          JSON.stringify(features),
          is_active,
          sort_order + 1, // Yearly plan gets slightly higher sort order
          req.user.id
        ]
      );

      // Commit transaction
      await db.query('COMMIT');

      // Log admin action
      await logAdminAction(
        req.user.id,
        'create_pricing_plan_group',
        'pricing_plan',
        plan_group,
        {
          plan_group,
          plan_name,
          monthly_price,
          yearly_price,
          monthly_plan_id: monthlyResult.insertId,
          yearly_plan_id: yearlyResult.insertId
        },
        req
      );

      res.status(201).json({
        success: true,
        message: 'Pricing plan group created successfully',
        data: {
          plan_group,
          plan_name,
          monthly_plan: {
            id: monthlyResult.insertId,
            plan_identifier: monthlyPlanId,
            price: monthly_price,
            billing_period: 'monthly'
          },
          yearly_plan: {
            id: yearlyResult.insertId,
            plan_identifier: yearlyPlanId,
            price: yearly_price,
            billing_period: 'yearly'
          }
        }
      });

    } catch (insertError) {
      // Rollback transaction on error
      await db.query('ROLLBACK');
      throw insertError;
    }

  } catch (error) {
    console.error('❌ Create pricing plan error:', error);

    // Handle specific database errors
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({
        error: 'Plan identifier already exists'
      });
    }

    res.status(500).json({
      error: 'Failed to create pricing plan group',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Update pricing plan group (updates both monthly and yearly variants)
const updatePricingPlan = async (req, res) => {
  try {
    const { planId } = req.params; // This will be the plan_group identifier
    const {
      plan_group,
      plan_name,
      description,
      monthly_price,
      yearly_price,
      currency = 'USD',
      features = [],
      is_active = true,
      sort_order = 0
    } = req.body;

    // Validation
    if (!plan_group || !plan_name || !monthly_price || !yearly_price) {
      return res.status(400).json({
        error: 'Plan group, name, monthly price, and yearly price are required'
      });
    }

    if (monthly_price <= 0 || yearly_price <= 0) {
      return res.status(400).json({
        error: 'Prices must be greater than 0'
      });
    }

    // Check if the plan group exists
    const [existingPlans] = await db.query(
      'SELECT id, plan_identifier, billing_period FROM pricing_plans WHERE plan_group = ?',
      [planId]
    );

    if (existingPlans.length === 0) {
      return res.status(404).json({ error: 'Pricing plan group not found' });
    }

    // Check if new plan_group conflicts with other existing groups (if plan_group is being changed)
    if (plan_group !== planId) {
      const [conflictingGroup] = await db.query(
        'SELECT plan_group FROM pricing_plans WHERE plan_group = ? AND plan_group != ? LIMIT 1',
        [plan_group, planId]
      );

      if (conflictingGroup.length > 0) {
        return res.status(400).json({
          error: 'New plan group identifier already exists for another plan group'
        });
      }
    }

    // Generate new plan identifiers
    const monthlyPlanId = `${plan_group}-monthly`;
    const yearlyPlanId = `${plan_group}-yearly`;

    // Start transaction
    await db.query('START TRANSACTION');

    try {
      // Update monthly plan
      const [monthlyUpdateResult] = await db.query(
        `UPDATE pricing_plans SET
          plan_group = ?, plan_name = ?, plan_identifier = ?, description = ?,
          price = ?, currency = ?, features = ?, is_active = ?,
          sort_order = ?, updated_by = ?, updated_at = CURRENT_TIMESTAMP
         WHERE plan_group = ? AND billing_period = 'monthly'`,
        [
          plan_group,
          plan_name,
          monthlyPlanId,
          description,
          monthly_price,
          currency,
          JSON.stringify(features),
          is_active,
          sort_order,
          req.user.id,
          planId
        ]
      );

      // Update yearly plan
      const [yearlyUpdateResult] = await db.query(
        `UPDATE pricing_plans SET
          plan_group = ?, plan_name = ?, plan_identifier = ?, description = ?,
          price = ?, currency = ?, features = ?, is_active = ?,
          sort_order = ?, updated_by = ?, updated_at = CURRENT_TIMESTAMP
         WHERE plan_group = ? AND billing_period = 'yearly'`,
        [
          plan_group,
          plan_name,
          yearlyPlanId,
          description,
          yearly_price,
          currency,
          JSON.stringify(features),
          is_active,
          sort_order + 1, // Yearly plan gets slightly higher sort order
          req.user.id,
          planId
        ]
      );

      // Check if updates were successful
      if (monthlyUpdateResult.affectedRows === 0 && yearlyUpdateResult.affectedRows === 0) {
        await db.query('ROLLBACK');
        return res.status(404).json({ error: 'No pricing plans were updated' });
      }

      // If plan_group changed, update any users who have this subscription
      if (plan_group !== planId) {
        await db.query(
          'UPDATE users SET subscription_plan = ? WHERE subscription_plan LIKE ?',
          [monthlyPlanId, `${planId}-%`]
        );

        await db.query(
          'UPDATE users SET subscription_plan = ? WHERE subscription_plan LIKE ?',
          [yearlyPlanId, `${planId}-%`]
        );
      }

      // Commit transaction
      await db.query('COMMIT');

      // Get updated plan details
      const [updatedPlans] = await db.query(
        'SELECT id, plan_identifier, price, billing_period FROM pricing_plans WHERE plan_group = ?',
        [plan_group]
      );

      const monthlyPlan = updatedPlans.find(p => p.billing_period === 'monthly');
      const yearlyPlan = updatedPlans.find(p => p.billing_period === 'yearly');

      // Log admin action
      await logAdminAction(
        req.user.id,
        'update_pricing_plan_group',
        'pricing_plan',
        plan_group,
        {
          old_plan_group: planId,
          new_plan_group: plan_group,
          plan_name,
          monthly_price,
          yearly_price,
          monthly_plan_id: monthlyPlan?.id,
          yearly_plan_id: yearlyPlan?.id
        },
        req
      );

      res.json({
        success: true,
        message: 'Pricing plan group updated successfully',
        data: {
          plan_group,
          plan_name,
          monthly_plan: {
            id: monthlyPlan?.id,
            plan_identifier: monthlyPlan?.plan_identifier,
            price: monthlyPlan?.price,
            billing_period: 'monthly'
          },
          yearly_plan: {
            id: yearlyPlan?.id,
            plan_identifier: yearlyPlan?.plan_identifier,
            price: yearlyPlan?.price,
            billing_period: 'yearly'
          }
        }
      });

    } catch (updateError) {
      // Rollback transaction on error
      await db.query('ROLLBACK');
      throw updateError;
    }

  } catch (error) {
    console.error('❌ Update pricing plan error:', error);

    // Handle specific database errors
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({
        error: 'Plan identifier already exists'
      });
    }

    res.status(500).json({
      error: 'Failed to update pricing plan group',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Delete pricing plan group (deletes both monthly and yearly variants)
const deletePricingPlan = async (req, res) => {
  try {
    const { planGroup } = req.params;

    console.log('🗑️ Attempting to delete plan group:', planGroup);

    if (!planGroup || planGroup === 'null' || planGroup === 'undefined') {
      return res.status(400).json({ error: 'Invalid plan group identifier' });
    }

    // Get plan info before deletion
    const [plans] = await db.query(
      'SELECT id, plan_name, plan_identifier, plan_group FROM pricing_plans WHERE plan_group = ?',
      [planGroup]
    );

    console.log('📋 Found plans for deletion:', plans);

    if (plans.length === 0) {
      return res.status(404).json({ error: 'Pricing plan group not found' });
    }

    // Check if any plans in this group are in use by users
    const planIdentifiers = plans.map(p => p.plan_identifier);
    const placeholders = planIdentifiers.map(() => '?').join(',');

    const [usersWithPlan] = await db.query(
      `SELECT COUNT(*) as count FROM users WHERE subscription_plan IN (${placeholders})`,
      planIdentifiers
    );

    console.log('👥 Users with this plan:', usersWithPlan[0].count);

    if (usersWithPlan[0].count > 0) {
      return res.status(400).json({
        error: `Cannot delete plan group. ${usersWithPlan[0].count} users are currently subscribed to plans in this group.`
      });
    }

    // Start transaction
    await db.query('START TRANSACTION');

    try {
      // Delete all plans in this group
      const [result] = await db.query('DELETE FROM pricing_plans WHERE plan_group = ?', [planGroup]);

      console.log('🗑️ Deletion result:', result);

      if (result.affectedRows === 0) {
        await db.query('ROLLBACK');
        return res.status(404).json({ error: 'No plans found to delete' });
      }

      // Commit transaction
      await db.query('COMMIT');

      await logAdminAction(
        req.user.id,
        'delete_pricing_plan_group',
        'pricing_plan',
        planGroup,
        {
          plan_group: planGroup,
          plans_deleted: result.affectedRows,
          plan_names: plans.map(p => p.plan_name)
        },
        req
      );

      console.log('✅ Plan group deleted successfully');

      res.json({
        success: true,
        message: `Pricing plan group '${planGroup}' deleted successfully`,
        plans_deleted: result.affectedRows
      });

    } catch (deleteError) {
      await db.query('ROLLBACK');
      throw deleteError;
    }

  } catch (error) {
    console.error('❌ Delete pricing plan group error:', error);
    res.status(500).json({
      error: 'Failed to delete pricing plan group',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Get all pricing plan groups (grouped by plan_group)
const getPlanGroups = async (req, res) => {
  try {
    const [plans] = await db.query(`
      SELECT
        pp.*,
        u1.username as created_by_username,
        u2.username as updated_by_username
      FROM pricing_plans pp
      LEFT JOIN users u1 ON pp.created_by = u1.id
      LEFT JOIN users u2 ON pp.updated_by = u2.id
      WHERE pp.is_active = 1
      ORDER BY pp.plan_group ASC, pp.billing_period ASC
    `);

    // Group plans by plan_group
    const groupedPlans = plans.reduce((acc, plan) => {
      const groupKey = plan.plan_group;

      if (!acc[groupKey]) {
        acc[groupKey] = {
          plan_group: plan.plan_group,
          plan_name: plan.plan_name,
          description: plan.description,
          currency: plan.currency,
          features: plan.features ? JSON.parse(plan.features) : [],
          is_active: plan.is_active,
          sort_order: plan.sort_order,
          created_at: plan.created_at,
          updated_at: plan.updated_at,
          created_by_username: plan.created_by_username,
          updated_by_username: plan.updated_by_username,
          monthly_price: null,
          yearly_price: null,
          monthly_plan_id: null,
          yearly_plan_id: null
        };
      }

      // Add billing period specific data
      if (plan.billing_period === 'monthly') {
        acc[groupKey].monthly_price = plan.price;
        acc[groupKey].monthly_plan_id = plan.id;
      } else if (plan.billing_period === 'yearly') {
        acc[groupKey].yearly_price = plan.price;
        acc[groupKey].yearly_plan_id = plan.id;
      }

      return acc;
    }, {});

    // Convert to array and sort
    const planGroups = Object.values(groupedPlans).sort((a, b) => a.sort_order - b.sort_order);

    await logAdminAction(req.user.id, 'view_pricing_plan_groups', null, null, {}, req);

    res.json({
      success: true,
      planGroups,
      total: planGroups.length
    });

  } catch (error) {
    console.error('❌ Get pricing plan groups error:', error);
    res.status(500).json({ error: 'Failed to fetch pricing plan groups' });
  }
};

module.exports = {
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
};
