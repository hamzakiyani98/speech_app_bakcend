const { db } = require('../config/database');
const {
  getUserStatistics,
  getUserInsights,
  getUserAchievements,
  trackActivity
} = require('../utils/statistics');
const {
  transcribeAudioWithWhisper,
  processVoiceCommandWithAI
} = require('../utils/voiceCommands');

// Get user statistics
const getStatistics = async (req, res) => {
  try {
    const { period = 'week', metric = 'time' } = req.query;

    console.log(`📊 Getting statistics for user ${req.user.id}, period: ${period}, metric: ${metric}`);

    const statistics = await getUserStatistics(req.user.id, period);
    const insights = await getUserInsights(req.user.id);
    const achievements = await getUserAchievements(req.user.id);

    res.json({
      success: true,
      period,
      metric,
      statistics,
      insights,
      achievements,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Get statistics error:', error);
    res.status(500).json({ error: 'Failed to fetch statistics' });
  }
};

// Track AI action usage
const trackAIAction = async (req, res) => {
  try {
    const { actionType, documentId, processingTime, selectedTextLength } = req.body;

    await trackActivity(req.user.id, 'ai_action', 'document', documentId, {
      actionType,
      processingTime,
      selectedTextLength
    });

    res.json({ success: true });
  } catch (error) {
    console.error('❌ Track AI action error:', error);
    res.status(500).json({ error: 'Failed to track AI action' });
  }
};

// Track OCR processing
const trackOCRProcessing = async (req, res) => {
  try {
    const { documentId, confidence, processingTime, imageSize } = req.body;

    await trackActivity(req.user.id, 'ocr_processed', 'document', documentId, {
      confidence,
      processingTime,
      imageSize
    });

    res.json({ success: true });
  } catch (error) {
    console.error('❌ Track OCR processing error:', error);
    res.status(500).json({ error: 'Failed to track OCR processing' });
  }
};

// Track chat message
const trackChatMessage = async (req, res) => {
  try {
    const { chatId, messageLength, messageType } = req.body;

    await trackActivity(req.user.id, 'chat_message', 'chat', chatId, {
      messageLength,
      messageType
    });

    res.json({ success: true });
  } catch (error) {
    console.error('❌ Track chat message error:', error);
    res.status(500).json({ error: 'Failed to track chat message' });
  }
};

// Get reading goals
const getReadingGoals = async (req, res) => {
  try {
    const [goals] = await db.query(`
      SELECT * FROM reading_goals
      WHERE user_id = ? AND is_active = TRUE
      ORDER BY goal_type, target_type
    `, [req.user.id]);

    res.json({ success: true, goals });
  } catch (error) {
    console.error('❌ Get reading goals error:', error);
    res.status(500).json({ error: 'Failed to fetch reading goals' });
  }
};

// Set reading goal
const setReadingGoal = async (req, res) => {
  try {
    const { goalType, targetType, targetValue, startDate, endDate } = req.body;

    if (!goalType || !targetType || !targetValue) {
      return res.status(400).json({ error: 'Goal type, target type, and target value are required' });
    }

    // Deactivate existing goal of same type
    await db.query(
      'UPDATE reading_goals SET is_active = FALSE WHERE user_id = ? AND goal_type = ? AND target_type = ?',
      [req.user.id, goalType, targetType]
    );

    // Create new goal
    const [result] = await db.query(`
      INSERT INTO reading_goals (user_id, goal_type, target_type, target_value, start_date, end_date)
      VALUES (?, ?, ?, ?, ?, ?)
    `, [req.user.id, goalType, targetType, targetValue, startDate, endDate]);

    res.json({
      success: true,
      goalId: result.insertId,
      message: 'Reading goal set successfully'
    });

  } catch (error) {
    console.error('❌ Set reading goal error:', error);
    res.status(500).json({ error: 'Failed to set reading goal' });
  }
};

// Process voice command (global)
const processVoiceCommandGlobal = async (req, res) => {
  try {
    const { textChunks, totalChunks } = req.body;
    const userId = req.user.id;

    if (!req.file) {
      return res.status(400).json({ error: 'No audio file provided' });
    }

    // Check daily usage limit
    const today = new Date().toISOString().split('T')[0];
    const [usageData] = await db.query(
      `SELECT COALESCE(voiceCommandsUsed, 0) as used FROM user_usage
       WHERE user_id = ? AND date = ?`,
      [userId, today]
    );

    const [limits] = await db.query(
      `SELECT daily_limit FROM feature_limits
       WHERE plan_type = ? AND feature_key = 'voice_commands'`,
      [req.user.planType]
    );

    const dailyLimit = limits[0]?.daily_limit || 0;
    const used = usageData[0]?.used || 0;

    if (used >= dailyLimit && !limits[0]?.is_unlimited) {
      return res.status(429).json({
        error: 'Daily voice command limit reached',
        code: 'LIMIT_EXCEEDED'
      });
    }

    console.log('🎤 Processing voice command...');

    // Transcribe audio with Whisper
    const transcription = await transcribeAudioWithWhisper(req.file.buffer);

    if (!transcription || !transcription.text) {
      return res.status(400).json({ error: 'Failed to transcribe audio' });
    }

    // Process command
    const commandResult = await processVoiceCommandWithAI(transcription.text, totalChunks || 100);

    // Increment usage
    await db.query(
      `INSERT INTO user_usage (user_id, date, voiceCommandsUsed)
       VALUES (?, ?, 1)
       ON DUPLICATE KEY UPDATE voiceCommandsUsed = voiceCommandsUsed + 1`,
      [userId, today]
    );

    // Log activity
    await trackActivity(userId, 'voice_command', 'document', null, {
      transcription: transcription.text.substring(0, 100)
    });

    res.json({
      success: true,
      transcription: transcription.text,
      ...commandResult,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Voice command error:', error);
    res.status(500).json({ error: 'Voice command processing failed: ' + error.message });
  }
};

// Get dashboard summary
const getDashboardSummary = async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];

    //console.log(`📊 Getting dashboard summary for user ${req.user.id}`);

    // Get today's stats
    const [todayStats] = await db.query(
      `SELECT
        COALESCE(total_reading_time_seconds, 0) as total_reading_time_seconds,
        COALESCE(total_words_read, 0) as total_words_read,
        COALESCE(documents_completed, 0) as documents_completed,
        COALESCE(sessions_count, 0) as sessions_count,
        COALESCE(documents_opened, 0) as documents_opened
       FROM daily_stats
       WHERE user_id = ? AND stat_date = ?`,
      [req.user.id, today]
    );

    // Get total documents
    const [totalDocs] = await db.query(
      'SELECT COUNT(*) as total FROM documents WHERE user_id = ?',
      [req.user.id]
    );

    // Get reading streak
    const [streakData] = await db.query(`
      SELECT COUNT(DISTINCT stat_date) as streak_days
      FROM daily_stats
      WHERE user_id = ?
      AND stat_date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
      AND total_reading_time_seconds > 0
    `, [req.user.id]);

    const stats = todayStats[0] || {
      total_reading_time_seconds: 0,
      total_words_read: 0,
      documents_completed: 0,
      sessions_count: 0,
      documents_opened: 0
    };

    const streak = streakData[0]?.streak_days || 0;

    // console.log('📊 Dashboard summary stats:', {
    //   readingTime: stats.total_reading_time_seconds,
    //   words: stats.total_words_read,
    //   completed: stats.documents_completed,
    //   sessions: stats.sessions_count,
    //   streak: streak
    // });

    const summary = {
      todayReadingTime: Math.round(stats.total_reading_time_seconds / 60), // Convert to minutes
      todayWordsRead: stats.total_words_read,
      todayDocumentsCompleted: stats.documents_completed,
      todaySessions: stats.sessions_count,
      totalDocuments: totalDocs[0].total,
      currentStreak: streak,
      recentAchievements: []
    };

    //console.log('✅ Final dashboard summary:', summary);

    res.json({
      success: true,
      summary: summary
    });

  } catch (error) {
    console.error('❌ Get dashboard summary error:', error);
    res.status(500).json({ error: 'Failed to fetch dashboard summary' });
  }
};

// Get user's feature limits based on their plan
const getUserFeatureLimits = async (req, res) => {
  try {
    // Get user's current plan
    const [users] = await db.query(
      'SELECT subscription_plan, is_trial, trial_end_date FROM users WHERE id = ?',
      [req.user.id]
    );

    if (users.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = users[0];
    let planType = 'free';

    // Determine plan type
    if (user.is_trial && user.trial_end_date && new Date(user.trial_end_date) > new Date()) {
      planType = 'trial';
    } else if (user.subscription_plan && user.subscription_plan !== 'free') {
      planType = 'premium';
    }

    // Get all feature limits for this plan from database
    const [limits] = await db.query(
      'SELECT feature_key, daily_limit, monthly_limit, is_unlimited FROM feature_limits WHERE plan_type = ?',
      [planType]
    );

    // Convert to object format
    const featureLimits = {};
    limits.forEach(limit => {
      featureLimits[limit.feature_key] = {
        daily: limit.is_unlimited ? 999999 : limit.daily_limit,
        monthly: limit.is_unlimited ? 999999 : (limit.monthly_limit || 0),
        unlimited: limit.is_unlimited
      };
    });

    res.json({
      success: true,
      plan_type: planType,
      limits: featureLimits
    });

  } catch (error) {
    console.error('Get feature limits error:', error);
    res.status(500).json({ error: 'Failed to get feature limits' });
  }
};

// Get user usage
const getUserUsage = async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];

    // Get user plan
    const [users] = await db.query(
      'SELECT subscription_plan, is_trial, trial_end_date FROM users WHERE id = ?',
      [req.user.id]
    );

    if (users.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = users[0];

    // ✅ FIX: Return actual plan, only normalize for limits lookup
    let actualPlan = user.subscription_plan || 'free';
    let planTypeForLimits = 'free';

    if (user.is_trial && user.trial_end_date && new Date(user.trial_end_date) > new Date()) {
      actualPlan = 'trial';
      planTypeForLimits = 'trial';
    } else if (user.subscription_plan && user.subscription_plan !== 'free') {
      actualPlan = user.subscription_plan; // ✅ "premium-yearly" or "premium-monthly"
      planTypeForLimits = user.subscription_plan.includes('premium') ? 'premium' : 'free';
    }

    console.log('📊 /api/users/usage:', {
      userId: req.user.id,
      actualPlan: actualPlan,
      planTypeForLimits: planTypeForLimits,
    });

    // Get limits from database using normalized plan type
    const [limits] = await db.query(
      'SELECT feature_key, daily_limit, is_unlimited FROM feature_limits WHERE plan_type = ?',
      [planTypeForLimits]
    );

    const limitsMap = {};
    limits.forEach(limit => {
      limitsMap[limit.feature_key] = limit.is_unlimited ? 999999 : limit.daily_limit;
    });

    // Get today's usage
    const [usage] = await db.query(
      'SELECT * FROM user_usage WHERE user_id = ? AND date = ?',
      [req.user.id, today]
    );

    const usageData = usage[0] || {};

    res.json({
      success: true,
      plan: actualPlan, // ✅ SEND ACTUAL PLAN: "premium-yearly"
      limits: {
        characters: limitsMap.characters || 0,
        listening_time: limitsMap.listening_time || 0,
        translations: limitsMap.translations || 0,
        voice_commands: limitsMap.voice_commands || 0,
        ocr_pages: limitsMap.ocr_pages || 0,
        downloads: limitsMap.downloads || 0,
        action_points: limitsMap.action_points || 0,
        summaries: limitsMap.summaries || 0,
        chatbot_questions: limitsMap.chatbot_questions || 0,
        natural_voices: limitsMap.natural_voices || 0,
        ads_free: limitsMap.ads_free || 0,
      },
      usage: {
        characters: usageData.charactersUsed || 0,
        listening_time: usageData.listeningTimeUsed || 0,
        translations: usageData.translationsUsed || 0,
        voice_commands: usageData.voiceCommandsUsed || 0,
        ocr_pages: usageData.ocrPagesUsed || 0,
        downloads: usageData.downloadsUsed || 0,
        action_points: usageData.actionPointsUsed || 0,
        summaries: usageData.summariesUsed || 0,
        chatbot_questions: usageData.chatbotQuestionsUsed || 0,
      }
    });

  } catch (error) {
    console.error('❌ Get usage error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get usage'
    });
  }
};

module.exports = {
  getStatistics,
  trackAIAction,
  trackOCRProcessing,
  trackChatMessage,
  getReadingGoals,
  setReadingGoal,
  processVoiceCommandGlobal,
  getDashboardSummary,
  getUserFeatureLimits,
  getUserUsage
};
