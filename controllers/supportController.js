const { db } = require('../config/database');
const { logAdminAction } = require('../utils/adminLogger');
const { createNotification } = require('../utils/notifications');

// Create support request
const createSupportRequest = async (req, res) => {
  try {
    const { subject, message, category = 'general', priority = 'medium' } = req.body;

    if (!subject || !message) {
      return res.status(400).json({ error: 'Subject and message are required' });
    }

    if (!['low', 'medium', 'high', 'urgent'].includes(priority)) {
      return res.status(400).json({ error: 'Invalid priority level' });
    }

    const [result] = await db.query(
      `INSERT INTO support_requests (user_id, subject, message, category, priority, status)
       VALUES (?, ?, ?, ?, ?, 'open')`,
      [req.user.id, subject, message, category, priority]
    );

    // Notify admins about new support request
    const [admins] = await db.query('SELECT id FROM users WHERE role IN ("admin", "moderator")');

    for (const admin of admins) {
      await createNotification(
        admin.id,
        'New Support Request',
        `${subject} - Priority: ${priority}`,
        'support_request',
        { requestId: result.insertId, priority }
      );
    }

    console.log('✅ Support request created:', result.insertId);

    res.json({
      success: true,
      message: 'Support request submitted successfully',
      request_id: result.insertId
    });

  } catch (error) {
    console.error('❌ Create support request error:', error);
    res.status(500).json({ error: 'Failed to create support request' });
  }
};

// Get user's support requests
const getMySupportRequests = async (req, res) => {
  try {
    const { status = 'all' } = req.query;

    let whereClause = 'WHERE user_id = ?';
    const queryParams = [req.user.id];

    if (status !== 'all') {
      whereClause += ' AND status = ?';
      queryParams.push(status);
    }

    const [requests] = await db.query(
      `SELECT
        id,
        subject,
        message,
        category,
        priority,
        status,
        admin_response,
        created_at,
        updated_at,
        resolved_at
       FROM support_requests
       ${whereClause}
       ORDER BY
         CASE priority
           WHEN 'urgent' THEN 1
           WHEN 'high' THEN 2
           WHEN 'medium' THEN 3
           WHEN 'low' THEN 4
         END,
         created_at DESC`,
      queryParams
    );

    res.json({
      success: true,
      requests
    });

  } catch (error) {
    console.error('❌ Get user support requests error:', error);
    res.status(500).json({ error: 'Failed to fetch support requests' });
  }
};

// Get single support request
const getSupportRequestDetails = async (req, res) => {
  try {
    const { requestId } = req.params;

    const [requests] = await db.query(
      `SELECT * FROM support_requests WHERE id = ? AND user_id = ?`,
      [requestId, req.user.id]
    );

    if (requests.length === 0) {
      return res.status(404).json({ error: 'Support request not found' });
    }

    res.json({
      success: true,
      request: requests[0]
    });

  } catch (error) {
    console.error('❌ Get support request error:', error);
    res.status(500).json({ error: 'Failed to fetch support request' });
  }
};

// Request refund
const createRefundRequest = async (req, res) => {
  try {
    const { reason, order_details = '' } = req.body;

    if (!reason) {
      return res.status(400).json({ error: 'Refund reason is required' });
    }

    // Get user's subscription info
    const [users] = await db.query(
      'SELECT subscription_plan, email, username FROM users WHERE id = ?',
      [req.user.id]
    );

    if (users.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = users[0];

    if (!user.subscription_plan || user.subscription_plan === 'free') {
      return res.status(400).json({
        error: 'No active subscription found. Refunds are only available for paid subscriptions.'
      });
    }

    // Create support request for refund
    const subject = 'Refund Request';
    const message = `Refund Request\n\nReason: ${reason}\n\nOrder Details: ${order_details}\n\nSubscription Plan: ${user.subscription_plan}`;

    const [result] = await db.query(
      `INSERT INTO support_requests (user_id, subject, message, category, priority, status)
       VALUES (?, ?, ?, 'refund', 'high', 'open')`,
      [req.user.id, subject, message]
    );

    // Notify admins
    const [admins] = await db.query('SELECT id FROM users WHERE role IN ("admin", "moderator")');

    for (const admin of admins) {
      await createNotification(
        admin.id,
        'Refund Request',
        `User ${user.username} requested a refund`,
        'refund_request',
        { requestId: result.insertId, userId: req.user.id }
      );
    }

    // Notify user
    await createNotification(
      req.user.id,
      'Refund Request Received',
      'Your refund request has been submitted. Our team will review it and respond within 24-48 hours.',
      'refund_request',
      { requestId: result.insertId }
    );

    console.log('✅ Refund request created:', result.insertId);

    res.json({
      success: true,
      message: 'Refund request submitted successfully. You will receive a response within 24-48 hours.',
      request_id: result.insertId
    });

  } catch (error) {
    console.error('❌ Refund request error:', error);
    res.status(500).json({ error: 'Failed to submit refund request' });
  }
};

// Get all support requests
const getAdminSupportRequests = async (req, res) => {
  try {
    const {
      status = 'all',
      priority = 'all',
      page = 1,
      limit = 20
    } = req.query;

    let whereClause = 'WHERE 1=1';
    let queryParams = [];

    if (status !== 'all') {
      whereClause += ' AND sr.status = ?';
      queryParams.push(status);
    }

    if (priority !== 'all') {
      whereClause += ' AND sr.priority = ?';
      queryParams.push(priority);
    }

    const offset = (page - 1) * limit;

    const [requests] = await db.query(`
      SELECT
        sr.*,
        u.username,
        u.email,
        a.username as assigned_to_username
      FROM support_requests sr
      JOIN users u ON sr.user_id = u.id
      LEFT JOIN users a ON sr.assigned_to = a.id
      ${whereClause}
      ORDER BY
        CASE sr.priority
          WHEN 'urgent' THEN 1
          WHEN 'high' THEN 2
          WHEN 'medium' THEN 3
          WHEN 'low' THEN 4
        END,
        sr.created_at DESC
      LIMIT ? OFFSET ?
    `, [...queryParams, parseInt(limit), parseInt(offset)]);

    const [totalCount] = await db.query(`
      SELECT COUNT(*) as total FROM support_requests sr ${whereClause}
    `, queryParams);

    await logAdminAction(req.user.id, 'view_support_requests', null, null, { status, priority }, req);

    res.json({
      success: true,
      requests,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: totalCount[0].total,
        totalPages: Math.ceil(totalCount[0].total / limit)
      }
    });

  } catch (error) {
    console.error('❌ Get support requests error:', error);
    res.status(500).json({ error: 'Failed to fetch support requests' });
  }
};

// Get support request by ID
const getAdminSupportRequestDetails = async (req, res) => {
  try {
    const { requestId } = req.params;

    const [requests] = await db.query(`
      SELECT
        sr.*,
        u.username,
        u.email,
        u.created_at as user_joined,
        a.username as assigned_to_username
      FROM support_requests sr
      JOIN users u ON sr.user_id = u.id
      LEFT JOIN users a ON sr.assigned_to = a.id
      WHERE sr.id = ?
    `, [requestId]);

    if (requests.length === 0) {
      return res.status(404).json({ error: 'Support request not found' });
    }

    await logAdminAction(req.user.id, 'view_support_request', 'support_request', requestId, {}, req);

    res.json({
      success: true,
      request: requests[0]
    });

  } catch (error) {
    console.error('❌ Get support request error:', error);
    res.status(500).json({ error: 'Failed to fetch support request' });
  }
};

// Update support request (respond)
const updateSupportRequest = async (req, res) => {
  try {
    const { requestId } = req.params;
    const { admin_response, status, priority, assigned_to } = req.body;

    // Check if request exists
    const [existingRequest] = await db.query(
      'SELECT user_id, subject FROM support_requests WHERE id = ?',
      [requestId]
    );

    if (existingRequest.length === 0) {
      return res.status(404).json({ error: 'Support request not found' });
    }

    const updateData = {
      updated_at: 'CURRENT_TIMESTAMP'
    };
    const updateParams = [];
    const updateFields = [];

    if (admin_response !== undefined) {
      updateFields.push('admin_response = ?');
      updateParams.push(admin_response);
    }

    if (status !== undefined) {
      updateFields.push('status = ?');
      updateParams.push(status);

      if (status === 'resolved' || status === 'closed') {
        updateFields.push('resolved_at = CURRENT_TIMESTAMP');
      }
    }

    if (priority !== undefined) {
      updateFields.push('priority = ?');
      updateParams.push(priority);
    }

    if (assigned_to !== undefined) {
      updateFields.push('assigned_to = ?');
      updateParams.push(assigned_to === '' ? null : assigned_to);
    }

    if (updateFields.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    const [result] = await db.query(
      `UPDATE support_requests SET ${updateFields.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [...updateParams, requestId]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Support request not found' });
    }

    // Send notification to user if there's a response
    if (admin_response && admin_response.trim()) {
      await createNotification(
        existingRequest[0].user_id,
        'Support Response',
        `We've responded to your support request: "${existingRequest[0].subject}"`,
        'support_response',
        {
          requestId: parseInt(requestId),
          response: admin_response.substring(0, 200) + (admin_response.length > 200 ? '...' : '')
        }
      );
    }

    await logAdminAction(
      req.user.id,
      'update_support_request',
      'support_request',
      requestId,
      { status, admin_response: !!admin_response },
      req
    );

    res.json({
      success: true,
      message: 'Support request updated successfully'
    });

  } catch (error) {
    console.error('❌ Update support request error:', error);
    res.status(500).json({ error: 'Failed to update support request' });
  }
};

// Assign support request to admin
const assignSupportRequest = async (req, res) => {
  try {
    const { requestId } = req.params;
    const { admin_id } = req.body;

    const [result] = await db.query(
      'UPDATE support_requests SET assigned_to = ?, status = "in_progress", updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [admin_id || null, requestId]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Support request not found' });
    }

    await logAdminAction(
      req.user.id,
      'assign_support_request',
      'support_request',
      requestId,
      { assigned_to: admin_id },
      req
    );

    res.json({
      success: true,
      message: admin_id ? 'Support request assigned successfully' : 'Support request unassigned successfully'
    });

  } catch (error) {
    console.error('❌ Assign support request error:', error);
    res.status(500).json({ error: 'Failed to assign support request' });
  }
};

// Get support statistics
const getSupportStats = async (req, res) => {
  try {
    const [stats] = await db.query(`
      SELECT
        COUNT(*) as total_requests,
        COUNT(CASE WHEN status = 'open' THEN 1 END) as open_requests,
        COUNT(CASE WHEN status = 'in_progress' THEN 1 END) as in_progress_requests,
        COUNT(CASE WHEN status = 'resolved' THEN 1 END) as resolved_requests,
        COUNT(CASE WHEN status = 'closed' THEN 1 END) as closed_requests,
        COUNT(CASE WHEN priority = 'urgent' THEN 1 END) as urgent_requests,
        COUNT(CASE WHEN priority = 'high' THEN 1 END) as high_priority_requests,
        COUNT(CASE WHEN created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR) THEN 1 END) as requests_today,
        COUNT(CASE WHEN created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY) THEN 1 END) as requests_this_week,
        AVG(CASE
          WHEN resolved_at IS NOT NULL
          THEN TIMESTAMPDIFF(HOUR, created_at, resolved_at)
          ELSE NULL
        END) as avg_resolution_time_hours
      FROM support_requests
    `);

    res.json({
      success: true,
      stats: stats[0]
    });

  } catch (error) {
    console.error('❌ Get support stats error:', error);
    res.status(500).json({ error: 'Failed to fetch support statistics' });
  }
};

module.exports = {
  createSupportRequest,
  getMySupportRequests,
  getSupportRequestDetails,
  createRefundRequest,
  getAdminSupportRequests,
  getAdminSupportRequestDetails,
  updateSupportRequest,
  assignSupportRequest,
  getSupportStats
};
