const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs-extra');
require('dotenv').config();

// Import configurations
const { testDatabase } = require('./config/database');
const { initializeFirebase } = require('./config/services');
const { initializeCronJobs } = require('./config/cronJobs');
const { ADS_IMAGES_DIR, UPLOAD_LIMITS } = require('./config/constants');

// Import database models
const { initializeDatabaseWithAdmin } = require('./models/database');

// Import routes
const healthRoutes = require('./routes/healthRoutes');
const authRoutes = require('./routes/authRoutes');
const ttsRoutes = require('./routes/ttsRoutes');
const documentsRoutes = require('./routes/documentsRoutes');
const chatRoutes = require('./routes/chatRoutes');
const notificationsRoutes = require('./routes/notificationsRoutes');
const readingSessionsRoutes = require('./routes/readingSessionsRoutes');
const statisticsRoutes = require('./routes/statisticsRoutes');
const adminRoutes = require('./routes/adminRoutes');
const adsRoutes = require('./routes/adsRoutes');
const paymentsRoutes = require('./routes/paymentsRoutes');
const supportRoutes = require('./routes/supportRoutes');

// Create Express app
const app = express();

// CORS configuration
app.use(cors({
  origin: true,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
}));

// Body parsing middleware
app.use(express.json({ limit: `${UPLOAD_LIMITS.JSON_BODY}` }));
app.use(express.urlencoded({ extended: true, limit: `${UPLOAD_LIMITS.JSON_BODY}` }));

// Request logging middleware
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
  next();
});

// Ensure ads images directory exists
const ensureAdsImagesDir = async () => {
  try {
    await fs.ensureDir(ADS_IMAGES_DIR);
    console.log('✅ Ads images directory ready:', ADS_IMAGES_DIR);
  } catch (error) {
    console.error('❌ Failed to create ads images directory:', error);
  }
};

// Static file serving for ads images
app.use('/ads-images', express.static(path.join(__dirname, 'public', 'ads-images')));

// Mount routes
app.use('/api', healthRoutes);
app.use('/api', authRoutes);
app.use('/api/tts', ttsRoutes);
app.use('/api/documents', documentsRoutes);
app.use('/api/chats', chatRoutes);
app.use('/api/notifications', notificationsRoutes);
app.use('/api/reading-sessions', readingSessionsRoutes);
app.use('/api', statisticsRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api', adsRoutes);
app.use('/api', paymentsRoutes);
app.use('/api', supportRoutes);

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    message: 'Speech App Backend API',
    version: '1.0.0',
    status: 'running',
    timestamp: new Date().toISOString()
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: 'Endpoint not found',
    path: req.path
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('❌ Error:', err);
  res.status(err.status || 500).json({
    success: false,
    error: err.message || 'Internal server error'
  });
});

// Initialize and start server
const PORT = process.env.PORT || 3000;

async function startServer() {
  try {
    console.log('🚀 Starting Speech App Backend...');

    // Test database connection
    const dbConnected = await testDatabase();
    if (!dbConnected) {
      console.error('❌ Failed to connect to database. Exiting...');
      process.exit(1);
    }

    // Initialize database tables
    console.log('🔄 Initializing database schema...');
    await initializeDatabaseWithAdmin();
    console.log('✅ Database schema initialized');

    // Initialize Firebase
    console.log('🔄 Initializing Firebase...');
    const firebaseInitialized = initializeFirebase();
    if (firebaseInitialized) {
      console.log('✅ Firebase initialized successfully');
    } else {
      console.warn('⚠️ Firebase initialization failed - push notifications will not work');
    }

    // Ensure ads images directory exists
    await ensureAdsImagesDir();

    // Initialize cron jobs
    console.log('🔄 Initializing scheduled tasks...');
    initializeCronJobs();
    console.log('✅ Scheduled tasks initialized');

    // Start server
    app.listen(PORT, () => {
      console.log('');
      console.log('✅ ========================================');
      console.log(`✅  Server running on port ${PORT}`);
      console.log('✅ ========================================');
      console.log('');
      console.log('📋 Available endpoints:');
      console.log('   • GET  / - API info');
      console.log('   • GET  /api/test - Health check');
      console.log('   • GET  /api/health - Health status');
      console.log('   • POST /api/signup - User registration');
      console.log('   • POST /api/login - User login');
      console.log('   • POST /api/auth/signup/request-otp - Request signup OTP');
      console.log('   • POST /api/auth/login/request-otp - Request login OTP');
      console.log('   • POST /api/tts/synthesize - Text-to-speech');
      console.log('   • POST /api/documents - Upload document');
      console.log('   • GET  /api/documents - List documents');
      console.log('   • POST /api/chats - Create chat');
      console.log('   • GET  /api/notifications - Get notifications');
      console.log('   • POST /api/admin/setup - Setup admin account');
      console.log('   • POST /api/admin/login - Admin login');
      console.log('   ... and many more!');
      console.log('');
      console.log(`🌐 Local: http://localhost:${PORT}`);
      console.log('');
    });

  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

// Start the server
startServer();

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('👋 SIGTERM signal received: closing HTTP server');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('👋 SIGINT signal received: closing HTTP server');
  process.exit(0);
});
