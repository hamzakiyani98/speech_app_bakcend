const { db } = require('../config/database');

// Log admin action
const logAdminAction = async (adminId, action, targetType = null, targetId = null, details = {}, req = null) => {
  try {
    await db.query(
      `INSERT INTO admin_logs (admin_id, action, target_type, target_id, details, ip_address, user_agent)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        adminId,
        action,
        targetType,
        targetId,
        JSON.stringify(details),
        req?.ip || null,
        req?.get('User-Agent') || null
      ]
    );
  } catch (error) {
    console.error('❌ Log admin action error:', error);
  }
};

module.exports = { logAdminAction };
