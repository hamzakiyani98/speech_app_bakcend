const jwt = require('jsonwebtoken');
const { JWT_SECRET } = require('../config/constants');
const { db } = require('../config/database');

// Auth middleware - authenticates regular users
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid token' });
    }
    req.user = user;
    next();
  });
};

// Admin authentication middleware
const authenticateAdmin = async (req, res, next) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
      return res.status(401).json({
        success: false,
        error: 'Admin access token required'
      });
    }

    // Verify JWT token
    const decoded = jwt.verify(token, JWT_SECRET);

    if (!decoded.adminId) {
      return res.status(403).json({
        success: false,
        error: 'Invalid admin token'
      });
    }

    // Verify admin exists and is active
    const [admins] = await db.query(
      'SELECT id, username, email, role, permissions, is_active FROM admin_users WHERE id = ?',
      [decoded.adminId]
    );

    if (admins.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Admin not found'
      });
    }

    const admin = admins[0];

    if (!admin.is_active) {
      return res.status(403).json({
        success: false,
        error: 'Admin account is inactive'
      });
    }

    // Attach admin to request
    req.admin = admin;
    next();

  } catch (error) {
    console.error('❌ Admin authentication error:', error);

    if (error.name === 'JsonWebTokenError') {
      return res.status(403).json({
        success: false,
        error: 'Invalid admin token'
      });
    }

    if (error.name === 'TokenExpiredError') {
      return res.status(403).json({
        success: false,
        error: 'Admin token expired'
      });
    }

    return res.status(500).json({
      success: false,
      error: 'Authentication error'
    });
  }
};

module.exports = {
  authenticateToken,
  authenticateAdmin
};
