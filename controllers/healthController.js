// Health check controller

// Test endpoint
const test = (req, res) => {
  res.json({
    success: true,
    message: 'Backend API is running',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development'
  });
};

// Health check endpoint
const health = (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString()
  });
};

module.exports = {
  test,
  health
};
