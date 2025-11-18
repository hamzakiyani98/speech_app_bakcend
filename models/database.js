const { db } = require('../config/database');

const initializeOTPTable = async () => {
  try {
    console.log('🔄 Initializing OTP table...');

    await db.query(`
      CREATE TABLE IF NOT EXISTS otp_verifications (
        id INT AUTO_INCREMENT PRIMARY KEY,
        email VARCHAR(255) NOT NULL,
        otp_code VARCHAR(6) NOT NULL,
        otp_type ENUM('signup', 'login') NOT NULL,
        is_verified BOOLEAN DEFAULT FALSE,
        expires_at TIMESTAMP NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        verified_at TIMESTAMP NULL,
        attempts INT DEFAULT 0,
        INDEX idx_email_type (email, otp_type, is_verified),
        INDEX idx_expires (expires_at)
      )
    `);

    console.log('✅ OTP table initialized');
  } catch (error) {
    console.error('❌ OTP table init error:', error);
    throw error;
  }
};


// Database Initialization
const initializeChatTables = async () => {
  try {
    console.log('🔄 Initializing chat tables...');

    await db.query(`
      CREATE TABLE IF NOT EXISTS chat_sessions (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        document_id INT NOT NULL,
        title VARCHAR(500) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
      )
    `);

    await db.query(`
      CREATE TABLE IF NOT EXISTS chat_messages (
        id INT AUTO_INCREMENT PRIMARY KEY,
        chat_id INT NOT NULL,
        sender ENUM('user', 'bot') NOT NULL,
        message LONGTEXT NOT NULL,
        message_type VARCHAR(50) DEFAULT 'text',
        metadata JSON,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (chat_id) REFERENCES chat_sessions(id) ON DELETE CASCADE
      )
    `);

    console.log('✅ Chat tables initialized');
  } catch (error) {
    console.error('❌ Chat tables init error:', error);
    throw error;
  }
};

const updateDatabaseSchema = async () => {
  try {
    console.log('🔄 Updating database schema for OCR support...');

    await db.query(`
      ALTER TABLE documents
      ADD COLUMN IF NOT EXISTS ocr_confidence DECIMAL(5,2) DEFAULT NULL,
      ADD COLUMN IF NOT EXISTS ocr_metadata JSON DEFAULT NULL,
      ADD COLUMN IF NOT EXISTS image_data JSON DEFAULT NULL,
      ADD COLUMN IF NOT EXISTS processing_status ENUM('pending', 'processing', 'completed', 'failed') DEFAULT 'completed'
    `);

    console.log('✅ Database schema updated for OCR support');

  } catch (error) {
    console.error('❌ Database schema update error:', error);
    throw error;
  }
};

const initializeDatabase = async () => {
  try {
    console.log('🔄 Initializing database...');

    await db.query(`
      CREATE TABLE IF NOT EXISTS users (
        id INT AUTO_INCREMENT PRIMARY KEY,
        username VARCHAR(255) NOT NULL,
        email VARCHAR(255) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await db.query(`
      CREATE TABLE IF NOT EXISTS documents (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        title VARCHAR(500) NOT NULL,
        description TEXT,
        content LONGTEXT NOT NULL,
        page_content LONGTEXT,
        total_pages INT DEFAULT 0,
        file_type VARCHAR(50) NOT NULL,
        category VARCHAR(50) DEFAULT 'uncategorized',
        file_size BIGINT DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        ocr_confidence DECIMAL(5,2) DEFAULT NULL,
        ocr_metadata JSON DEFAULT NULL,
        image_data JSON DEFAULT NULL,
        processing_status ENUM('pending', 'processing', 'completed', 'failed') DEFAULT 'completed',
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);

    // Feature limits table
    await db.query(`
  CREATE TABLE IF NOT EXISTS feature_limits (
    id INT AUTO_INCREMENT PRIMARY KEY,
    plan_type ENUM('free', 'trial', 'premium') NOT NULL,
    feature_key VARCHAR(50) NOT NULL,
    daily_limit INT NOT NULL,
    monthly_limit INT DEFAULT NULL,
    is_unlimited BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY unique_plan_feature (plan_type, feature_key)
  )
`);

// Insert default limits from your table
await db.query(`
  INSERT INTO feature_limits (plan_type, feature_key, daily_limit, monthly_limit, is_unlimited) VALUES
  -- FREEMIUM PLAN (Limited features)
  ('free', 'characters', 10000, 0, false),  -- ~20 min listening at 150 wpm = ~10k chars
  ('free', 'listening_time', 20, 0, false),
  ('free', 'translations', 0, 0, false),
  ('free', 'voice_commands', 0, 0, false),
  ('free', 'ocr_pages', 0, 0, false),
  ('free', 'social_media_control', 1, 0, false),
  ('free', 'downloads', 0, 0, false),
  ('free', 'action_points', 0, 0, false),
  ('free', 'summaries', 0, 0, false),
  ('free', 'chatbot_questions', 0, 0, false),
  ('free', 'natural_voices', 0, 0, false),
  ('free', 'ads_free', 0, 0, false),

  -- 3-DAY TRIAL (Max 40k characters/day)
  ('trial', 'characters', 40000, 0, false),
  ('trial', 'listening_time', 30, 0, false),
  ('trial', 'translations', 1, 0, false),
  ('trial', 'voice_commands', 10, 0, false),
  ('trial', 'ocr_pages', 5, 0, false),
  ('trial', 'social_media_control', 0, 0, true),
  ('trial', 'downloads', 1, 0, false),
  ('trial', 'action_points', 2, 0, false),
  ('trial', 'summaries', 2, 0, false),
  ('trial', 'chatbot_questions', 2, 0, false),
  ('trial', 'natural_voices', 0, 0, true),
  ('trial', 'ads_free', 0, 0, true),

  -- PREMIUM PLAN (Max 500k characters/day, rest unlimited)
  ('premium', 'characters', 500000, 0, false),
  ('premium', 'listening_time', 0, 0, true),
  ('premium', 'translations', 0, 0, true),
  ('premium', 'voice_commands', 0, 0, true),
  ('premium', 'ocr_pages', 300, 9000, false),
  ('premium', 'social_media_control', 0, 0, true),
  ('premium', 'downloads', 0, 0, true),
  ('premium', 'action_points', 0, 0, true),
  ('premium', 'summaries', 0, 0, true),
  ('premium', 'chatbot_questions', 0, 0, true),
  ('premium', 'natural_voices', 0, 0, true),
  ('premium', 'ads_free', 0, 0, true)
  ON DUPLICATE KEY UPDATE
    daily_limit = VALUES(daily_limit),
    monthly_limit = VALUES(monthly_limit),
    is_unlimited = VALUES(is_unlimited)
`);

await db.query(`
  CREATE TABLE IF NOT EXISTS user_usage (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    date DATE NOT NULL,
    charactersUsed INT DEFAULT 0,
    listeningTimeUsed INT DEFAULT 0,
    translationsUsed INT DEFAULT 0,
    voiceCommandsUsed INT DEFAULT 0,
    ocrPagesUsed INT DEFAULT 0,
    downloadsUsed INT DEFAULT 0,
    actionPointsUsed INT DEFAULT 0,
    summariesUsed INT DEFAULT 0,
    chatbotQuestionsUsed INT DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY unique_user_date (user_id, date),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_user_date (user_id, date)
  )
`);

await db.query(`
      CREATE TABLE IF NOT EXISTS user_payments (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        payment_id VARCHAR(255) NOT NULL,
        amount DECIMAL(10,2) NOT NULL,
        currency VARCHAR(3) DEFAULT 'USD',
        payment_method VARCHAR(50) NOT NULL,
        payment_status ENUM('pending', 'completed', 'failed', 'refunded') DEFAULT 'pending',
        transaction_id VARCHAR(255),
        plan_id INT,
        plan_identifier VARCHAR(100),
        billing_period ENUM('monthly', 'yearly', 'lifetime'),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (plan_id) REFERENCES pricing_plans(id) ON DELETE SET NULL,
        INDEX idx_user_payments (user_id, created_at),
        INDEX idx_payment_id (payment_id),
        INDEX idx_transaction_id (transaction_id)
      )
    `);
    await db.query(`
      CREATE TABLE IF NOT EXISTS reading_positions (
  id INT PRIMARY KEY AUTO_INCREMENT,
  user_id INT NOT NULL,
  document_id VARCHAR(255) NOT NULL,
  paragraph_index INT NOT NULL DEFAULT 0,
  character_position INT NOT NULL DEFAULT 0,
  total_paragraphs INT DEFAULT 0,
  progress INT DEFAULT 0,
  document_length INT DEFAULT 0,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY unique_user_document (user_id, document_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.log('✅ reading_positions table ready');

    await initializeChatTables();
    // Initialize notification tables
    await initializeNotificationTables();

    // Initialize statistics tables
    await initializeStatisticsTables();
    await updateDatabaseSchema();
    await initializeOTPTable();


    console.log('✅ Database initialized');
  } catch (error) {
    console.error('❌ Database init error:', error);
    throw error;
  }
};

const cleanExpiredOTPs = async () => {
  try {
    const [result] = await db.query(
      'DELETE FROM otp_verifications WHERE expires_at < NOW()'
    );
    if (result.affectedRows > 0) {
      console.log(`🧹 Cleaned ${result.affectedRows} expired OTPs`);
    }
  } catch (error) {
    console.error('❌ Clean expired OTPs error:', error);
  }
};

const initializeNotificationTables = async () => {
  try {
    console.log('🔄 Initializing notification tables...');

    // User device tokens table
    await db.query(`
      CREATE TABLE IF NOT EXISTS user_device_tokens (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        device_token VARCHAR(500) NOT NULL,
        device_type ENUM('android', 'ios') NOT NULL,
        device_id VARCHAR(255),
        app_version VARCHAR(50),
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        UNIQUE KEY unique_user_device (user_id, device_token)
      )
    `);

    // Notifications table
    await db.query(`
      CREATE TABLE IF NOT EXISTS notifications (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT,
        title VARCHAR(255) NOT NULL,
        message TEXT NOT NULL,
        type VARCHAR(50) DEFAULT 'general',
        data JSON,
        is_read BOOLEAN DEFAULT FALSE,
        is_sent BOOLEAN DEFAULT FALSE,
        scheduled_at TIMESTAMP NULL,
        sent_at TIMESTAMP NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);

    // Notification preferences table
    await db.query(`
      CREATE TABLE IF NOT EXISTS notification_preferences (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        push_enabled BOOLEAN DEFAULT TRUE,
        email_enabled BOOLEAN DEFAULT TRUE,
        reading_reminders BOOLEAN DEFAULT TRUE,
        achievement_notifications BOOLEAN DEFAULT TRUE,
        content_notifications BOOLEAN DEFAULT TRUE,
        system_notifications BOOLEAN DEFAULT TRUE,
        quiet_hours_start TIME DEFAULT '22:00:00',
        quiet_hours_end TIME DEFAULT '08:00:00',
        timezone VARCHAR(50) DEFAULT 'UTC',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        UNIQUE KEY unique_user_prefs (user_id)
      )
    `);

    console.log('✅ Notification tables initialized');
  } catch (error) {
    console.error('❌ Notification tables init error:', error);
    throw error;
  }
};

const initializeStatisticsTables = async () => {
  try {
    console.log('🔄 Initializing statistics tables...');

    // User sessions table
    await db.query(`
      CREATE TABLE IF NOT EXISTS user_sessions (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        session_start TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        session_end TIMESTAMP NULL,
        duration_seconds INT DEFAULT 0,
        platform VARCHAR(50) DEFAULT 'mobile',
        app_version VARCHAR(50),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        INDEX idx_user_sessions (user_id, session_start)
      )
    `);

    // Reading sessions table
    await db.query(`
      CREATE TABLE IF NOT EXISTS reading_sessions (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        document_id INT NOT NULL,
        session_start TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        session_end TIMESTAMP NULL,
        reading_time_seconds INT DEFAULT 0,
        words_read INT DEFAULT 0,
        pages_read INT DEFAULT 0,
        progress_percentage DECIMAL(5,2) DEFAULT 0,
        playback_speed DECIMAL(3,1) DEFAULT 1.0,
        completion_status ENUM('started', 'paused', 'completed', 'abandoned') DEFAULT 'started',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE,
        INDEX idx_reading_sessions (user_id, session_start),
        INDEX idx_document_sessions (document_id, session_start)
      )
    `);

    // Daily statistics table
    await db.query(`
      CREATE TABLE IF NOT EXISTS daily_stats (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        stat_date DATE NOT NULL,
        total_reading_time_seconds INT DEFAULT 0,
        total_words_read INT DEFAULT 0,
        documents_opened INT DEFAULT 0,
        documents_completed INT DEFAULT 0,
        sessions_count INT DEFAULT 0,
        ai_actions_used INT DEFAULT 0,
        ocr_documents_processed INT DEFAULT 0,
        chat_messages_sent INT DEFAULT 0,
        average_reading_speed DECIMAL(8,2) DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        UNIQUE KEY unique_user_date (user_id, stat_date),
        INDEX idx_daily_stats (user_id, stat_date)
      )
    `);

    // User achievements table
    await db.query(`
      CREATE TABLE IF NOT EXISTS user_achievements (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        achievement_type VARCHAR(100) NOT NULL,
        achievement_name VARCHAR(200) NOT NULL,
        achievement_description TEXT,
        achievement_data JSON,
        earned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        is_notified BOOLEAN DEFAULT FALSE,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        INDEX idx_user_achievements (user_id, earned_at),
        UNIQUE KEY unique_user_achievement (user_id, achievement_type)
      )
    `);

    // Activity tracking table
    await db.query(`
      CREATE TABLE IF NOT EXISTS user_activities (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        activity_type VARCHAR(100) NOT NULL,
        entity_type VARCHAR(50),
        entity_id INT,
        activity_data JSON,
        duration_seconds INT DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        INDEX idx_user_activities (user_id, created_at),
        INDEX idx_activity_type (activity_type, created_at)
      )
    `);

    // Reading goals table
    await db.query(`
      CREATE TABLE IF NOT EXISTS reading_goals (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        goal_type ENUM('daily', 'weekly', 'monthly', 'yearly') NOT NULL,
        target_type ENUM('time', 'words', 'documents', 'sessions') NOT NULL,
        target_value INT NOT NULL,
        current_value INT DEFAULT 0,
        start_date DATE NOT NULL,
        end_date DATE NOT NULL,
        is_active BOOLEAN DEFAULT TRUE,
        is_completed BOOLEAN DEFAULT FALSE,
        completed_at TIMESTAMP NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        INDEX idx_reading_goals (user_id, goal_type, is_active)
      )
    `);

    console.log('✅ Statistics tables initialized');
  } catch (error) {
    console.error('❌ Statistics tables init error:', error);
    throw error;
  }
};

const initializeRefundsAndSupportTables = async () => {
  try {
    // Refunds table
    await db.query(`
      CREATE TABLE IF NOT EXISTS refunds (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        refund_type ENUM('amount', 'percent') NOT NULL,
        refund_value DECIMAL(10,2) NOT NULL,
        reason TEXT NOT NULL,
        status ENUM('pending', 'processed', 'failed') DEFAULT 'pending',
        processed_by INT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        processed_at TIMESTAMP NULL,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (processed_by) REFERENCES users(id) ON DELETE SET NULL
      )
    `);

    // Support requests table
    await db.query(`
      CREATE TABLE IF NOT EXISTS support_requests (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        subject VARCHAR(255) NOT NULL,
        message TEXT NOT NULL,
        priority ENUM('low', 'medium', 'high', 'urgent') DEFAULT 'medium',
        status ENUM('open', 'in_progress', 'resolved', 'closed') DEFAULT 'open',
        category VARCHAR(100),
        assigned_to INT,
        admin_response TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        resolved_at TIMESTAMP NULL,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (assigned_to) REFERENCES users(id) ON DELETE SET NULL
      )
    `);

    // Pricing plans table
    await db.query(`
      CREATE TABLE IF NOT EXISTS pricing_plans (
        id INT AUTO_INCREMENT PRIMARY KEY,
        plan_name VARCHAR(100) NOT NULL,
        plan_identifier VARCHAR(50) UNIQUE NOT NULL,
        description TEXT,
        price DECIMAL(10,2) NOT NULL,
        currency VARCHAR(3) DEFAULT 'USD',
        billing_period ENUM('monthly', 'yearly', 'lifetime') NOT NULL,
        features JSON,
        is_active BOOLEAN DEFAULT TRUE,
        sort_order INT DEFAULT 0,
        created_by INT,
        updated_by INT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
        FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
      )
    `);

    await db.query(`
  ALTER TABLE users
  ADD COLUMN IF NOT EXISTS role ENUM('user', 'admin', 'moderator') DEFAULT 'user',
  ADD COLUMN IF NOT EXISTS status ENUM('active', 'suspended', 'banned') DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS last_login TIMESTAMP NULL,
  ADD COLUMN IF NOT EXISTS login_count INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS subscription_plan VARCHAR(50) DEFAULT 'free'
`);



    console.log('✅ Refunds, support, and pricing tables initialized');
  } catch (error) {
    console.error('❌ Additional tables init error:', error);
    throw error;
  }
};


// Initialize admin tables
const initializeAdminTables = async () => {
  try {
    console.log('🔧 Initializing admin tables...');

    // Add role column to users table if not exists
    await db.query(`
      ALTER TABLE users
      ADD COLUMN IF NOT EXISTS role ENUM('user', 'admin', 'moderator') DEFAULT 'user',
      ADD COLUMN IF NOT EXISTS status ENUM('active', 'suspended', 'banned') DEFAULT 'active',
      ADD COLUMN IF NOT EXISTS last_login TIMESTAMP NULL,
      ADD COLUMN IF NOT EXISTS login_count INT DEFAULT 0
    `);

    // Admin logs table
    await db.query(`
      CREATE TABLE IF NOT EXISTS admin_logs (
        id INT AUTO_INCREMENT PRIMARY KEY,
        admin_id INT NOT NULL,
        action VARCHAR(100) NOT NULL,
        target_type VARCHAR(50),
        target_id INT,
        details JSON,
        ip_address VARCHAR(45),
        user_agent TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (admin_id) REFERENCES users(id) ON DELETE CASCADE,
        INDEX idx_admin_logs (admin_id, created_at),
        INDEX idx_action_logs (action, created_at)
      )
    `);

    // System settings table
    await db.query(`
      CREATE TABLE IF NOT EXISTS system_settings (
        id INT AUTO_INCREMENT PRIMARY KEY,
        setting_key VARCHAR(100) UNIQUE NOT NULL,
        setting_value JSON NOT NULL,
        description TEXT,
        updated_by INT,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
      )
    `);

    // Content moderation table
    await db.query(`
      CREATE TABLE IF NOT EXISTS content_moderation (
        id INT AUTO_INCREMENT PRIMARY KEY,
        content_type ENUM('document', 'chat_message', 'user_profile') NOT NULL,
        content_id INT NOT NULL,
        reporter_id INT,
        reason VARCHAR(255),
        status ENUM('pending', 'approved', 'rejected', 'escalated') DEFAULT 'pending',
        moderator_id INT,
        moderator_notes TEXT,
        action_taken ENUM('none', 'warning', 'content_removed', 'user_suspended') DEFAULT 'none',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        resolved_at TIMESTAMP NULL,
        FOREIGN KEY (reporter_id) REFERENCES users(id) ON DELETE SET NULL,
        FOREIGN KEY (moderator_id) REFERENCES users(id) ON DELETE SET NULL,
        INDEX idx_moderation_status (status, created_at)
      )
    `);

    // Feature flags table
    await db.query(`
      CREATE TABLE IF NOT EXISTS feature_flags (
        id INT AUTO_INCREMENT PRIMARY KEY,
        flag_name VARCHAR(100) UNIQUE NOT NULL,
        description TEXT,
        is_enabled BOOLEAN DEFAULT FALSE,
        rollout_percentage INT DEFAULT 0,
        target_users JSON,
        created_by INT,
        updated_by INT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
        FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
      )
    `);

    // Ads table
    await db.query(`
      CREATE TABLE IF NOT EXISTS ads (
        id INT AUTO_INCREMENT PRIMARY KEY,
        ad_type ENUM('full_screen', 'popup', 'banner', 'interstitial') NOT NULL,
        content JSON NOT NULL,
        target_users JSON,
        schedule_start TIMESTAMP NULL,
        schedule_end TIMESTAMP NULL,
        is_active BOOLEAN DEFAULT TRUE,
        priority INT DEFAULT 0,
        impressions INT DEFAULT 0,
        clicks INT DEFAULT 0,
        created_by INT,
        updated_by INT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
        FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
      )
    `);

    await db.query(`
  ALTER TABLE ads
  ADD COLUMN IF NOT EXISTS banner_pages JSON DEFAULT NULL
`);

    console.log('✅ Admin tables initialized');
  } catch (error) {
    console.error('❌ Admin tables init error:', error);
    throw error;
  }
};

const initializeDatabaseWithAdmin = async () => {
  await initializeDatabase();
  await initializeAdminTables();
  await initializeRefundsAndSupportTables();
};

module.exports = {
  initializeOTPTable,
  initializeChatTables,
  updateDatabaseSchema,
  initializeDatabase,
  cleanExpiredOTPs,
  initializeNotificationTables,
  initializeStatisticsTables,
  initializeRefundsAndSupportTables,
  initializeAdminTables,
  initializeDatabaseWithAdmin
};
