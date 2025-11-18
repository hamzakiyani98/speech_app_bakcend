const { db } = require('../config/database');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { JWT_SECRET } = require('../config/constants');
const { logAdminAction } = require('../utils/adminLogger');
const { sendPushNotification, createNotification } = require('../utils/notifications');

// ==================== ADMIN AUTHENTICATION ====================

// Create first admin user
const setupAdmin = async (req, res) => {
  try {
    const { email, password, setupKey } = req.body;

    // Check setup key (you should set this in environment variables)
    if (setupKey !== process.env.ADMIN_SETUP_KEY) {
      return res.status(403).json({ error: 'Invalid setup key' });
    }

    // Check if admin already exists
    const [existingAdmin] = await db.query('SELECT * FROM users WHERE role = "admin"');
    if (existingAdmin.length > 0) {
      return res.status(400).json({ error: 'Admin already exists' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    await db.query(
      'INSERT INTO users (username, email, password, role) VALUES (?, ?, ?, ?)',
      ['admin', email, hashedPassword, 'admin']
    );

    res.json({ message: 'Admin user created successfully' });

  } catch (error) {
    console.error('❌ Admin setup error:', error);
    res.status(500).json({ error: 'Setup failed' });
  }
};

const loginAdmin = async (req, res) => {
  try {
    const { email, password } = req.body;

    // Query by email OR username to be flexible
    const [users] = await db.query(
      'SELECT * FROM users WHERE (email = ? OR username = ?) AND role IN ("admin", "moderator")',
      [email, email] // This allows login with either email or username
    );

    if (users.length === 0) {
      return res.status(400).json({ error: 'Invalid admin credentials' });
    }

    const user = users[0];
    const isValidPassword = await bcrypt.compare(password, user.password);

    if (!isValidPassword) {
      return res.status(400).json({ error: 'Invalid admin credentials' });
    }

    // Update last login
    await db.query(
      'UPDATE users SET last_login = CURRENT_TIMESTAMP, login_count = login_count + 1 WHERE id = ?',
      [user.id]
    );

    // Create token with proper expiration
    const token = jwt.sign(
      {
        id: user.id,
        email: user.email,
        username: user.username,
        role: user.role
      },
      JWT_SECRET,
      { expiresIn: '24h' } // Increased to 24 hours
    );

    await logAdminAction(user.id, 'admin_login', null, null, { ip: req.ip }, req);

    console.log('✅ Admin login successful:', user.email, 'Token generated');

    res.json({
      token,
      admin: {
        id: user.id,
        email: user.email,
        username: user.username,
        role: user.role
      }
    });

  } catch (error) {
    console.error('❌ Admin login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
};

const getAdminProfile = async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1]; // Get Bearer token
    if (!token) {
      return res.status(401).json({ error: 'No token provided' });
    }

    console.log('🔍 Verifying admin token...');

    const decoded = jwt.verify(token, JWT_SECRET);
    console.log('✅ Token decoded:', { id: decoded.id, role: decoded.role });

    const [users] = await db.query(
      'SELECT id, email, role, username FROM users WHERE id = ? AND role IN ("admin", "moderator")',
      [decoded.id]
    );

    if (users.length === 0) {
      console.log('❌ Admin user not found in database');
      return res.status(401).json({ error: 'Admin user not found' });
    }

    const user = users[0];
    console.log('✅ Admin user found:', user.username);

    res.json({
      id: user.id,
      username: user.username,
      email: user.email,
      role: user.role
    });

  } catch (error) {
    console.error('❌ /api/admin/me error:', error);

    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired', code: 'TOKEN_EXPIRED' });
    }

    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({ error: 'Invalid token', code: 'INVALID_TOKEN' });
    }

    res.status(500).json({ error: 'Authentication failed' });
  }
};

// ==================== DASHBOARD & ANALYTICS ====================

// Admin dashboard overview
const getDashboard = async (req, res) => {
  try {
    console.log('📊 Getting admin dashboard data...');

    // Users statistics
    const [userStats] = await db.query(`
      SELECT
        COUNT(*) as total_users,
        COUNT(CASE WHEN created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY) THEN 1 END) as new_users_week,
        COUNT(CASE WHEN created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY) THEN 1 END) as new_users_month,
        COUNT(CASE WHEN last_login >= DATE_SUB(NOW(), INTERVAL 7 DAY) THEN 1 END) as active_users_week,
        COUNT(CASE WHEN status = 'active' THEN 1 END) as active_users,
        COUNT(CASE WHEN status = 'suspended' THEN 1 END) as suspended_users
      FROM users WHERE role = 'user'
    `);

    // Documents statistics
    const [docStats] = await db.query(`
      SELECT
        COUNT(*) as total_documents,
        COUNT(CASE WHEN created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY) THEN 1 END) as new_documents_week,
        COUNT(CASE WHEN file_type = 'image_ocr' THEN 1 END) as ocr_documents,
        ROUND(AVG(file_size)) as avg_file_size,
        SUM(file_size) as total_storage_used
      FROM documents
    `);

    // Chat statistics
    const [chatStats] = await db.query(`
      SELECT
        COUNT(DISTINCT cs.id) as total_chats,
        COUNT(cm.id) as total_messages,
        COUNT(CASE WHEN cs.created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY) THEN 1 END) as new_chats_week
      FROM chat_sessions cs
      LEFT JOIN chat_messages cm ON cs.id = cm.chat_id
    `);

    // System statistics
    const [systemStats] = await db.query(`
      SELECT
        (SELECT COUNT(*) FROM notifications WHERE created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)) as notifications_sent_today,
        (SELECT COUNT(*) FROM user_device_tokens WHERE is_active = TRUE) as active_devices,
        (SELECT COUNT(*) FROM admin_logs WHERE created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)) as admin_actions_today
    `);

    // Recent activity
    const [recentUsers] = await db.query(`
      SELECT id, username, email, created_at, last_login, status
      FROM users
      WHERE role = 'user'
      ORDER BY created_at DESC
      LIMIT 10
    `);

    const [recentDocuments] = await db.query(`
      SELECT d.id, d.title, d.file_type, d.created_at, u.username, u.email
      FROM documents d
      JOIN users u ON d.user_id = u.id
      ORDER BY d.created_at DESC
      LIMIT 10
    `);

    // Error logs (last 24 hours)
    const [errorLogs] = await db.query(`
      SELECT action, details, created_at, COUNT(*) as count
      FROM admin_logs
      WHERE created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
        AND action LIKE '%error%'
      GROUP BY action, DATE(created_at)
      ORDER BY created_at DESC
      LIMIT 10
    `);

    await logAdminAction(req.user.id, 'view_dashboard', null, null, {}, req);

    res.json({
      success: true,
      dashboard: {
        users: userStats[0],
        documents: docStats[0],
        chats: chatStats[0],
        system: systemStats[0],
        recentUsers,
        recentDocuments,
        errorLogs
      }
    });

  } catch (error) {
    console.error('❌ Admin dashboard error:', error);
    res.status(500).json({ error: 'Failed to load dashboard' });
  }
};

// System analytics
const getAnalytics = async (req, res) => {
  try {
    const { period = '30days', metric = 'users' } = req.query;

    let dateCondition = '';
    switch (period) {
      case '7days':
        dateCondition = 'created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)';
        break;
      case '30days':
        dateCondition = 'created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)';
        break;
      case '90days':
        dateCondition = 'created_at >= DATE_SUB(NOW(), INTERVAL 90 DAY)';
        break;
      default:
        dateCondition = 'created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)';
    }

    let chartData = [];

    if (metric === 'users') {
      const [userData] = await db.query(`
        SELECT
          DATE(created_at) as date,
          COUNT(*) as count
        FROM users
        WHERE role = 'user' AND ${dateCondition}
        GROUP BY DATE(created_at)
        ORDER BY date ASC
      `);
      chartData = userData;
    } else if (metric === 'documents') {
      const [docData] = await db.query(`
        SELECT
          DATE(created_at) as date,
          COUNT(*) as count
        FROM documents
        WHERE ${dateCondition}
        GROUP BY DATE(created_at)
        ORDER BY date ASC
      `);
      chartData = docData;
    }

    await logAdminAction(req.user.id, 'view_analytics', null, null, { period, metric }, req);

    res.json({
      success: true,
      analytics: {
        period,
        metric,
        chartData
      }
    });

  } catch (error) {
    console.error('❌ Analytics error:', error);
    res.status(500).json({ error: 'Failed to load analytics' });
  }
};

// Admin: Get all feature limits
const getFeatureLimits = async (req, res) => {
  try {
    const [limits] = await db.query(`
      SELECT * FROM feature_limits ORDER BY plan_type, feature_key
    `);

    res.json({
      success: true,
      limits
    });

  } catch (error) {
    console.error('Get feature limits error:', error);
    res.status(500).json({ error: 'Failed to get feature limits' });
  }
};

// Admin: Update feature limit
const updateFeatureLimit = async (req, res) => {
  try {
    const { id } = req.params;
    const { daily_limit, monthly_limit, is_unlimited } = req.body;

    await db.query(
      `UPDATE feature_limits
       SET daily_limit = ?, monthly_limit = ?, is_unlimited = ?
       WHERE id = ?`,
      [daily_limit, monthly_limit, is_unlimited, id]
    );

    await logAdminAction(
      req.user.id,
      'update_feature_limit',
      'feature_limit',
      id,
      { daily_limit, monthly_limit, is_unlimited },
      req
    );

    res.json({
      success: true,
      message: 'Feature limit updated'
    });

  } catch (error) {
    console.error('Update feature limit error:', error);
    res.status(500).json({ error: 'Failed to update feature limit' });
  }
};

// Admin: Bulk update feature limits for a plan
const updateFeatureLimitsByPlan = async (req, res) => {
  try {
    const { planType } = req.params;
    const { limits } = req.body; // Array of {feature_key, daily_limit, monthly_limit, is_unlimited}

    if (!['free', 'trial', 'premium'].includes(planType)) {
      return res.status(400).json({ error: 'Invalid plan type' });
    }

    for (const limit of limits) {
      await db.query(
        `UPDATE feature_limits
         SET daily_limit = ?, monthly_limit = ?, is_unlimited = ?
         WHERE plan_type = ? AND feature_key = ?`,
        [limit.daily_limit, limit.monthly_limit, limit.is_unlimited, planType, limit.feature_key]
      );
    }

    await logAdminAction(
      req.user.id,
      'bulk_update_feature_limits',
      'feature_limits',
      null,
      { planType, limitsCount: limits.length },
      req
    );

    res.json({
      success: true,
      message: `Updated ${limits.length} feature limits for ${planType} plan`
    });

  } catch (error) {
    console.error('Bulk update feature limits error:', error);
    res.status(500).json({ error: 'Failed to update feature limits' });
  }
};

// ==================== USER MANAGEMENT ====================

// Get all users with filtering and pagination
const getUsers = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      search = '',
      status = 'all',
      sortBy = 'created_at',
      sortOrder = 'desc'
    } = req.query;

    const offset = (page - 1) * limit;
    let whereClause = 'WHERE role = "user"';
    let queryParams = [];

    if (search) {
      whereClause += ' AND (username LIKE ? OR email LIKE ?)';
      queryParams.push(`%${search}%`, `%${search}%`);
    }

    if (status !== 'all') {
      whereClause += ' AND status = ?';
      queryParams.push(status);
    }

    const validSortColumns = ['created_at', 'username', 'email', 'last_login', 'login_count'];
    const sortColumn = validSortColumns.includes(sortBy) ? sortBy : 'created_at';
    const order = sortOrder.toLowerCase() === 'asc' ? 'ASC' : 'DESC';

    const [users] = await db.query(`
      SELECT
        u.id, u.username, u.email, u.status, u.created_at, u.last_login, u.login_count,
        COUNT(d.id) as document_count,
        COUNT(cs.id) as chat_count
      FROM users u
      LEFT JOIN documents d ON u.id = d.user_id
      LEFT JOIN chat_sessions cs ON u.id = cs.user_id
      ${whereClause}
      GROUP BY u.id
      ORDER BY ${sortColumn} ${order}
      LIMIT ? OFFSET ?
    `, [...queryParams, parseInt(limit), parseInt(offset)]);

    const [totalCount] = await db.query(`
      SELECT COUNT(*) as total FROM users ${whereClause}
    `, queryParams);

    await logAdminAction(req.user.id, 'view_users', null, null, { search, status }, req);

    res.json({
      success: true,
      users,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: totalCount[0].total,
        totalPages: Math.ceil(totalCount[0].total / limit)
      }
    });

  } catch (error) {
    console.error('❌ Get users error:', error);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
};

// Get user details
const getUserDetails = async (req, res) => {
  try {
    const { userId } = req.params;

    const [users] = await db.query(`
      SELECT u.*,
        COUNT(DISTINCT d.id) as document_count,
        COUNT(DISTINCT cs.id) as chat_count,
        COUNT(DISTINCT n.id) as notification_count,
        SUM(d.file_size) as total_storage_used
      FROM users u
      LEFT JOIN documents d ON u.id = d.user_id
      LEFT JOIN chat_sessions cs ON u.id = cs.user_id
      LEFT JOIN notifications n ON u.id = n.user_id
      WHERE u.id = ? AND u.role = 'user'
      GROUP BY u.id
    `, [userId]);

    if (users.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Get subscription plan details
    let subscriptionDetails = null;
    const user = users[0];

    if (user.subscription_plan && user.subscription_plan !== 'free') {
      const [planDetails] = await db.query(`
        SELECT
          plan_name,
          plan_identifier,
          description,
          price,
          currency,
          billing_period,
          features,
          is_active as plan_is_active
        FROM pricing_plans
        WHERE plan_identifier = ?
      `, [user.subscription_plan]);

      if (planDetails.length > 0) {
        subscriptionDetails = {
          ...planDetails[0],
          features: planDetails[0].features ? JSON.parse(planDetails[0].features) : [],
          subscription_status: user.subscription_status || 'inactive',
          subscription_start_date: user.subscription_start_date || null,
          subscription_end_date: user.subscription_end_date || null,
          last_payment_date: user.last_payment_date || null,
          last_payment_amount: user.last_payment_amount || 0,
          next_billing_date: user.next_billing_date || null,
          payment_method: user.payment_method || null,
          total_payments: user.total_payments || 0,
          is_trial: user.is_trial || false,
          trial_end_date: user.trial_end_date || null
        };
      }
    }

    // If no subscription plan found or user has free plan
    if (!subscriptionDetails) {
      subscriptionDetails = {
        plan_name: 'Free Plan',
        plan_identifier: 'free',
        description: 'Basic free tier with limited features',
        price: 0,
        currency: 'USD',
        billing_period: 'free',
        features: [
          'Basic document upload',
          'Limited OCR processing',
          'Standard support'
        ],
        plan_is_active: true,
        subscription_status: 'active',
        subscription_start_date: user.created_at,
        subscription_end_date: null,
        last_payment_date: null,
        last_payment_amount: 0,
        next_billing_date: null,
        payment_method: null,
        total_payments: 0,
        is_trial: false,
        trial_end_date: null
      };
    }

    const [recentDocuments] = await db.query(`
      SELECT id, title, file_type, file_size, created_at
      FROM documents
      WHERE user_id = ?
      ORDER BY created_at DESC
      LIMIT 5
    `, [userId]);

    const [recentActivity] = await db.query(`
      SELECT activity_type, entity_type, activity_data, created_at
      FROM user_activities
      WHERE user_id = ?
      ORDER BY created_at DESC
      LIMIT 10
    `, [userId]);

    // Get payment history if user has made payments
    let paymentHistory = [];
    if (user.subscription_plan && user.subscription_plan !== 'free') {
      const [payments] = await db.query(`
        SELECT
          payment_id,
          amount,
          currency,
          payment_method,
          payment_status,
          transaction_id,
          created_at as payment_date
        FROM user_payments
        WHERE user_id = ?
        ORDER BY created_at DESC
        LIMIT 10
      `, [userId]);

      paymentHistory = payments || [];
    }

    // Get refund history
    const [refundHistory] = await db.query(`
      SELECT
        id as refund_id,
        refund_type,
        refund_value,
        reason,
        status,
        processed_at,
        created_at
      FROM refunds
      WHERE user_id = ?
      ORDER BY created_at DESC
      LIMIT 10
    `, [userId]);

    await logAdminAction(req.user.id, 'view_user_details', 'user', userId, {}, req);

    res.json({
      success: true,
      user: users[0],
      subscriptionDetails,
      paymentHistory,
      refundHistory,
      recentDocuments,
      recentActivity
    });

  } catch (error) {
    console.error('❌ Get user details error:', error);
    res.status(500).json({ error: 'Failed to fetch user details' });
  }
};

// Update user status
const updateUserStatus = async (req, res) => {
  try {
    const { userId } = req.params;
    const { status, reason } = req.body;

    if (!['active', 'suspended', 'banned'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    const [result] = await db.query(
      'UPDATE users SET status = ? WHERE id = ? AND role = "user"',
      [status, userId]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    await logAdminAction(
      req.user.id,
      'update_user_status',
      'user',
      userId,
      { status, reason },
      req
    );

    res.json({
      success: true,
      message: `User status updated to ${status}`
    });

  } catch (error) {
    console.error('❌ Update user status error:', error);
    res.status(500).json({ error: 'Failed to update user status' });
  }
};

// Delete user account
const deleteUser = async (req, res) => {
  try {
    const { userId } = req.params;
    const { reason } = req.body;

    // Get user info before deletion
    const [users] = await db.query('SELECT username, email FROM users WHERE id = ?', [userId]);
    if (users.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Delete user (cascade will handle related data)
    await db.query('DELETE FROM users WHERE id = ? AND role = "user"', [userId]);

    await logAdminAction(
      req.user.id,
      'delete_user',
      'user',
      userId,
      { username: users[0].username, email: users[0].email, reason },
      req
    );

    res.json({
      success: true,
      message: 'User account deleted successfully'
    });

  } catch (error) {
    console.error('❌ Delete user error:', error);
    res.status(500).json({ error: 'Failed to delete user' });
  }
};

// ==================== CONTENT MANAGEMENT ====================

// Get all documents with filtering
const getDocuments = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      search = '',
      fileType = 'all',
      userId = null
    } = req.query;

    const offset = (page - 1) * limit;
    let whereClause = 'WHERE 1=1';
    let queryParams = [];

    if (search) {
      whereClause += ' AND (d.title LIKE ? OR d.description LIKE ?)';
      queryParams.push(`%${search}%`, `%${search}%`);
    }

    if (fileType !== 'all') {
      whereClause += ' AND d.file_type = ?';
      queryParams.push(fileType);
    }

    if (userId) {
      whereClause += ' AND d.user_id = ?';
      queryParams.push(userId);
    }

    const [documents] = await db.query(`
      SELECT
        d.id, d.title, d.description, d.file_type, d.file_size, d.total_pages,
        d.processing_status, d.ocr_confidence, d.created_at,
        u.username, u.email
      FROM documents d
      JOIN users u ON d.user_id = u.id
      ${whereClause}
      ORDER BY d.created_at DESC
      LIMIT ? OFFSET ?
    `, [...queryParams, parseInt(limit), parseInt(offset)]);

    const [totalCount] = await db.query(`
      SELECT COUNT(*) as total FROM documents d ${whereClause}
    `, queryParams);

    res.json({
      success: true,
      documents,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: totalCount[0].total,
        totalPages: Math.ceil(totalCount[0].total / limit)
      }
    });

  } catch (error) {
    console.error('❌ Get documents error:', error);
    res.status(500).json({ error: 'Failed to fetch documents' });
  }
};

// Delete document
const deleteDocument = async (req, res) => {
  try {
    const { documentId } = req.params;
    const { reason } = req.body;

    // Get document info before deletion
    const [docs] = await db.query(`
      SELECT d.title, d.user_id, u.username
      FROM documents d
      JOIN users u ON d.user_id = u.id
      WHERE d.id = ?
    `, [documentId]);

    if (docs.length === 0) {
      return res.status(404).json({ error: 'Document not found' });
    }

    await db.query('DELETE FROM documents WHERE id = ?', [documentId]);

    await logAdminAction(
      req.user.id,
      'delete_document',
      'document',
      documentId,
      { title: docs[0].title, owner: docs[0].username, reason },
      req
    );

    res.json({
      success: true,
      message: 'Document deleted successfully'
    });

  } catch (error) {
    console.error('❌ Delete document error:', error);
    res.status(500).json({ error: 'Failed to delete document' });
  }
};

// ==================== SYSTEM MANAGEMENT ====================

// Get system settings
const getSettings = async (req, res) => {
  try {
    const [settings] = await db.query('SELECT * FROM system_settings ORDER BY setting_key');

    res.json({
      success: true,
      settings
    });

  } catch (error) {
    console.error('❌ Get settings error:', error);
    res.status(500).json({ error: 'Failed to fetch settings' });
  }
};

// Update system setting
const updateSetting = async (req, res) => {
  try {
    const { settingKey } = req.params;
    const { value, description } = req.body;

    await db.query(`
      INSERT INTO system_settings (setting_key, setting_value, description, updated_by)
      VALUES (?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
      setting_value = VALUES(setting_value),
      description = VALUES(description),
      updated_by = VALUES(updated_by),
      updated_at = CURRENT_TIMESTAMP
    `, [settingKey, JSON.stringify(value), description, req.user.id]);

    await logAdminAction(
      req.user.id,
      'update_setting',
      'system_setting',
      null,
      { key: settingKey, value },
      req
    );

    res.json({
      success: true,
      message: 'Setting updated successfully'
    });

  } catch (error) {
    console.error('❌ Update setting error:', error);
    res.status(500).json({ error: 'Failed to update setting' });
  }
};

// Get admin logs
const getLogs = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 50,
      action = 'all',
      adminId = 'all'
    } = req.query;

    const offset = (page - 1) * limit;
    let whereClause = 'WHERE 1=1';
    let queryParams = [];

    if (action !== 'all') {
      whereClause += ' AND al.action = ?';
      queryParams.push(action);
    }

    if (adminId !== 'all') {
      whereClause += ' AND al.admin_id = ?';
      queryParams.push(adminId);
    }

    const [logs] = await db.query(`
      SELECT
        al.*, u.username as admin_name, u.email as admin_email
      FROM admin_logs al
      JOIN users u ON al.admin_id = u.id
      ${whereClause}
      ORDER BY al.created_at DESC
      LIMIT ? OFFSET ?
    `, [...queryParams, parseInt(limit), parseInt(offset)]);

    const [totalCount] = await db.query(`
      SELECT COUNT(*) as total FROM admin_logs al ${whereClause}
    `, queryParams);

    res.json({
      success: true,
      logs,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: totalCount[0].total,
        totalPages: Math.ceil(totalCount[0].total / limit)
      }
    });

  } catch (error) {
    console.error('❌ Get logs error:', error);
    res.status(500).json({ error: 'Failed to fetch logs' });
  }
};

// Send broadcast notification to all users
const broadcastNotification = async (req, res) => {
  try {
    const { title, message, data = {} } = req.body;

    if (!title || !message) {
      return res.status(400).json({ error: 'Title and message are required' });
    }

    // Get all active user device tokens
    const [tokens] = await db.query(`
      SELECT udt.device_token, udt.user_id
      FROM user_device_tokens udt
      JOIN users u ON udt.user_id = u.id
      WHERE udt.is_active = 1 AND u.status = 'active'
    `);

    if (tokens.length === 0) {
      return res.status(404).json({ error: 'No active devices found' });
    }

    const deviceTokens = tokens.map(t => t.device_token);

    // Send push notification
    const result = await sendPushNotification(deviceTokens, title, message, {
      ...data,
      broadcast: true,
      admin_sent: true
    });

    // Save notifications to database for each user
    const uniqueUserIds = [...new Set(tokens.map(t => t.user_id))];
    for (const userId of uniqueUserIds) {
      await createNotification(userId, title, message, 'admin_broadcast', data, false);
    }

    await logAdminAction(
      req.user.id,
      'broadcast_notification',
      null,
      null,
      { title, recipientCount: uniqueUserIds.length },
      req
    );

    res.json({
      success: true,
      message: 'Broadcast notification sent',
      sentTo: result.successCount,
      failed: result.failureCount,
      totalUsers: uniqueUserIds.length
    });

  } catch (error) {
    console.error('❌ Broadcast notification error:', error);
    res.status(500).json({ error: 'Failed to send broadcast notification' });
  }
};

// Export system data
const exportData = async (req, res) => {
  try {
    const { dataType } = req.params;
    const { format = 'json' } = req.query;

    let data = [];
    let filename = '';

    switch (dataType) {
      case 'users':
        const [users] = await db.query(`
          SELECT u.id, u.username, u.email, u.status, u.created_at, u.last_login, u.login_count,
            COUNT(DISTINCT d.id) as document_count,
            COUNT(DISTINCT cs.id) as chat_count,
            SUM(d.file_size) as total_storage_used
          FROM users u
          LEFT JOIN documents d ON u.id = d.user_id
          LEFT JOIN chat_sessions cs ON u.id = cs.user_id
          WHERE u.role = 'user'
          GROUP BY u.id
          ORDER BY u.created_at DESC
        `);
        data = users;
        filename = `users_export_${new Date().toISOString().split('T')[0]}`;
        break;

      case 'documents':
        const [documents] = await db.query(`
          SELECT d.id, d.title, d.description, d.file_type, d.file_size, d.total_pages,
            d.processing_status, d.ocr_confidence, d.created_at,
            u.username as owner_username, u.email as owner_email
          FROM documents d
          JOIN users u ON d.user_id = u.id
          ORDER BY d.created_at DESC
        `);
        data = documents;
        filename = `documents_export_${new Date().toISOString().split('T')[0]}`;
        break;

      case 'analytics':
        const [analytics] = await db.query(`
          SELECT
            DATE(created_at) as date,
            COUNT(CASE WHEN table_name = 'users' THEN 1 END) as new_users,
            COUNT(CASE WHEN table_name = 'documents' THEN 1 END) as new_documents,
            COUNT(CASE WHEN table_name = 'chat_sessions' THEN 1 END) as new_chats
          FROM (
            SELECT 'users' as table_name, created_at FROM users WHERE role = 'user'
            UNION ALL
            SELECT 'documents' as table_name, created_at FROM documents
            UNION ALL
            SELECT 'chat_sessions' as table_name, created_at FROM chat_sessions
          ) combined
          WHERE created_at >= DATE_SUB(NOW(), INTERVAL 90 DAY)
          GROUP BY DATE(created_at)
          ORDER BY date DESC
        `);
        data = analytics;
        filename = `analytics_export_${new Date().toISOString().split('T')[0]}`;
        break;

      default:
        return res.status(400).json({ error: 'Invalid data type' });
    }

    await logAdminAction(
      req.user.id,
      'export_data',
      null,
      null,
      { dataType, format, recordCount: data.length },
      req
    );

    if (format === 'csv') {
      // Convert to CSV
      if (data.length === 0) {
        return res.status(404).json({ error: 'No data to export' });
      }

      const headers = Object.keys(data[0]);
      const csvContent = [
        headers.join(','),
        ...data.map(row => headers.map(header => `"${row[header] || ''}"`).join(','))
      ].join('\n');

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}.csv"`);
      res.send(csvContent);
    } else {
      // Return JSON
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}.json"`);
      res.json({
        success: true,
        dataType,
        exportedAt: new Date().toISOString(),
        recordCount: data.length,
        data
      });
    }

  } catch (error) {
    console.error('❌ Export data error:', error);
    res.status(500).json({ error: 'Failed to export data' });
  }
};

// Feature flags management
const getFeatureFlags = async (req, res) => {
  try {
    const [flags] = await db.query('SELECT * FROM feature_flags ORDER BY flag_name');

    res.json({
      success: true,
      flags
    });

  } catch (error) {
    console.error('❌ Get feature flags error:', error);
    res.status(500).json({ error: 'Failed to fetch feature flags' });
  }
};

const updateFeatureFlag = async (req, res) => {
  try {
    const { flagName } = req.params;
    const { isEnabled, rolloutPercentage, targetUsers, description } = req.body;

    await db.query(`
      INSERT INTO feature_flags (flag_name, description, is_enabled, rollout_percentage, target_users, created_by, updated_by)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
      description = VALUES(description),
      is_enabled = VALUES(is_enabled),
      rollout_percentage = VALUES(rollout_percentage),
      target_users = VALUES(target_users),
      updated_by = VALUES(updated_by),
      updated_at = CURRENT_TIMESTAMP
    `, [
      flagName,
      description,
      isEnabled,
      rolloutPercentage || 0,
      JSON.stringify(targetUsers || []),
      req.user.id,
      req.user.id
    ]);

    await logAdminAction(
      req.user.id,
      'update_feature_flag',
      'feature_flag',
      null,
      { flagName, isEnabled, rolloutPercentage },
      req
    );

    res.json({
      success: true,
      message: 'Feature flag updated successfully'
    });

  } catch (error) {
    console.error('❌ Update feature flag error:', error);
    res.status(500).json({ error: 'Failed to update feature flag' });
  }
};

// System health check
const getSystemHealth = async (req, res) => {
  try {
    // Database health
    const dbStart = Date.now();
    await db.query('SELECT 1');
    const dbLatency = Date.now() - dbStart;

    // Storage health
    const [storageInfo] = await db.query(`
      SELECT
        SUM(file_size) as total_storage,
        COUNT(*) as total_files,
        AVG(file_size) as avg_file_size
      FROM documents
    `);

    // Active connections
    const [activeUsers] = await db.query(`
      SELECT COUNT(*) as count
      FROM users
      WHERE last_login >= DATE_SUB(NOW(), INTERVAL 24 HOUR) AND role = 'user'
    `);

    // Error rates (last 24 hours)
    const [errors] = await db.query(`
      SELECT COUNT(*) as error_count
      FROM admin_logs
      WHERE created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
        AND (action LIKE '%error%' OR action LIKE '%failed%')
    `);

    // OCR processing stats
    const [ocrStats] = await db.query(`
      SELECT
        COUNT(*) as total_ocr_docs,
        AVG(ocr_confidence) as avg_confidence,
        COUNT(CASE WHEN processing_status = 'failed' THEN 1 END) as failed_ocr
      FROM documents
      WHERE file_type = 'image_ocr'
        AND created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
    `);

    const health = {
      database: {
        status: dbLatency < 100 ? 'healthy' : dbLatency < 500 ? 'warning' : 'critical',
        latency: dbLatency
      },
      storage: {
        totalSizeGB: Math.round((storageInfo[0].total_storage || 0) / 1024 / 1024 / 1024 * 100) / 100,
        totalFiles: storageInfo[0].total_files || 0,
        avgFileSizeMB: Math.round((storageInfo[0].avg_file_size || 0) / 1024 / 1024 * 100) / 100
      },
      users: {
        activeToday: activeUsers[0].count || 0
      },
      errors: {
        errorCount24h: errors[0].error_count || 0,
        status: (errors[0].error_count || 0) < 10 ? 'healthy' : 'warning'
      },
      ocr: {
        processedToday: ocrStats[0].total_ocr_docs || 0,
        avgConfidence: Math.round((ocrStats[0].avg_confidence || 0) * 100) / 100,
        failedCount: ocrStats[0].failed_ocr || 0
      }
    };

    res.json({
      success: true,
      health,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ System health error:', error);
    res.status(500).json({
      error: 'Failed to check system health',
      health: {
        database: { status: 'critical', error: error.message }
      }
    });
  }
};

module.exports = {
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
};
