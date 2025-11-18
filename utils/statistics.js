const db = require('../config/database');

// Track user activity
const trackActivity = async (userId, activityType, entityType = null, entityId = null, activityData = {}, durationSeconds = 0) => {
  try {
    await db.query(
      `INSERT INTO user_activities (user_id, activity_type, entity_type, entity_id, activity_data, duration_seconds)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [userId, activityType, entityType, entityId, JSON.stringify(activityData), durationSeconds]
    );

    // Update daily stats
    await updateDailyStats(userId, activityType, activityData, durationSeconds);
  } catch (error) {
    console.error('❌ Track activity error:', error);
  }
};

// Also update the updateDailyStats function to properly track document completion
const updateDailyStats = async (userId, activityType, activityData, durationSeconds) => {
  try {
    const today = new Date().toISOString().split('T')[0];

    // Prepare update values based on activity type
    let updateQuery = `
      INSERT INTO daily_stats (user_id, stat_date) VALUES (?, ?)
      ON DUPLICATE KEY UPDATE
    `;
    let updateValues = [userId, today];
    let updateFields = [];

    console.log(`📈 Updating daily stats: ${activityType}`, activityData);

    switch (activityType) {
      case 'reading_session':
        updateFields.push('total_reading_time_seconds = total_reading_time_seconds + ?');
        updateFields.push('total_words_read = total_words_read + ?');
        updateFields.push('sessions_count = sessions_count + 1');
        updateValues.push(durationSeconds, activityData.wordsRead || 0);
        break;

      case 'document_opened':
        updateFields.push('documents_opened = documents_opened + 1');
        break;

      case 'document_completed':
        updateFields.push('documents_completed = documents_completed + 1');
        console.log('✅ Incrementing documents_completed for user', userId);
        break;

      case 'ai_action':
        updateFields.push('ai_actions_used = ai_actions_used + 1');
        break;

      case 'ocr_processed':
        updateFields.push('ocr_documents_processed = ocr_documents_processed + 1');
        break;

      case 'chat_message':
        updateFields.push('chat_messages_sent = chat_messages_sent + 1');
        break;
    }

    if (updateFields.length > 0) {
      updateQuery += updateFields.join(', ');
      console.log('📝 Executing query:', updateQuery, updateValues);
      await db.query(updateQuery, updateValues);
      console.log('✅ Daily stats updated successfully');
    }
  } catch (error) {
    console.error('❌ Update daily stats error:', error);
  }
};



// Start reading session
const startReadingSession = async (userId, documentId, playbackSpeed = 1.0) => {
  try {
    const [result] = await db.query(
      `INSERT INTO reading_sessions (user_id, document_id, session_start, playback_speed, completion_status)
       VALUES (?, ?, CURRENT_TIMESTAMP, ?, 'started')`,
      [userId, documentId, playbackSpeed]
    );

    await trackActivity(userId, 'document_opened', 'document', documentId, { playbackSpeed });

    return result.insertId;
  } catch (error) {
    console.error('❌ Start reading session error:', error);
    return null;
  }
};

// Update reading session
const updateReadingSession = async (sessionId, updateData) => {
  try {
    const { readingTimeSeconds, wordsRead, pagesRead, progressPercentage, completionStatus } = updateData;

    await db.query(
      `UPDATE reading_sessions SET
       reading_time_seconds = ?,
       words_read = ?,
       pages_read = ?,
       progress_percentage = ?,
       completion_status = ?,
       updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [readingTimeSeconds, wordsRead, pagesRead, progressPercentage, completionStatus, sessionId]
    );

    // Get user_id for activity tracking
    const [session] = await db.query('SELECT user_id, document_id FROM reading_sessions WHERE id = ?', [sessionId]);
    if (session.length > 0) {
      await trackActivity(
        session[0].user_id,
        'reading_progress',
        'document',
        session[0].document_id,
        { wordsRead, progressPercentage, completionStatus },
        readingTimeSeconds
      );

      if (completionStatus === 'completed') {
        await trackActivity(session[0].user_id, 'document_completed', 'document', session[0].document_id);
      }
    }
  } catch (error) {
    console.error('❌ Update reading session error:', error);
  }
};

// End reading session
const endReadingSession = async (sessionId, finalData) => {
  try {
    await db.query(
      `UPDATE reading_sessions SET
       session_end = CURRENT_TIMESTAMP,
       reading_time_seconds = ?,
       words_read = ?,
       pages_read = ?,
       progress_percentage = ?,
       completion_status = ?
       WHERE id = ?`,
      [
        finalData.readingTimeSeconds,
        finalData.wordsRead,
        finalData.pagesRead,
        finalData.progressPercentage,
        finalData.completionStatus,
        sessionId
      ]
    );

    // Get user_id for final activity tracking
    const [session] = await db.query('SELECT user_id, document_id FROM reading_sessions WHERE id = ?', [sessionId]);
    if (session.length > 0) {
      await trackActivity(
        session[0].user_id,
        'reading_session',
        'document',
        session[0].document_id,
        {
          wordsRead: finalData.wordsRead,
          progressPercentage: finalData.progressPercentage,
          completionStatus: finalData.completionStatus
        },
        finalData.readingTimeSeconds
      );
    }
  } catch (error) {
    console.error('❌ End reading session error:', error);
  }
};

// Check and award achievements
const checkAchievements = async (userId) => {
  try {
    const today = new Date().toISOString().split('T')[0];

    // Get today's stats
    const [todayStats] = await db.query(
      'SELECT * FROM daily_stats WHERE user_id = ? AND stat_date = ?',
      [userId, today]
    );

    if (todayStats.length === 0) return;

    const stats = todayStats[0];
    const achievements = [];

    // Check various achievements
    if (stats.total_reading_time_seconds >= 3600 && !await hasAchievement(userId, 'hour_reader')) {
      achievements.push({
        type: 'hour_reader',
        name: 'Hour Reader',
        description: 'Read for 1 hour in a single day'
      });
    }

    if (stats.documents_completed >= 5 && !await hasAchievement(userId, 'speed_reader')) {
      achievements.push({
        type: 'speed_reader',
        name: 'Speed Reader',
        description: 'Complete 5 documents in one day'
      });
    }

    if (stats.total_words_read >= 10000 && !await hasAchievement(userId, 'word_master')) {
      achievements.push({
        type: 'word_master',
        name: 'Word Master',
        description: 'Read 10,000 words in one day'
      });
    }

    // Check streak achievement
    const streak = await getReadingStreak(userId);
    if (streak >= 7 && !await hasAchievement(userId, 'week_streak')) {
      achievements.push({
        type: 'week_streak',
        name: 'Weekly Warrior',
        description: 'Maintain a 7-day reading streak'
      });
    }

    // Award achievements
    for (const achievement of achievements) {
      await awardAchievement(userId, achievement);
    }

  } catch (error) {
    console.error('❌ Check achievements error:', error);
  }
};

// Helper functions for achievements
const hasAchievement = async (userId, achievementType) => {
  try {
    const [result] = await db.query(
      'SELECT id FROM user_achievements WHERE user_id = ? AND achievement_type = ?',
      [userId, achievementType]
    );
    return result.length > 0;
  } catch (error) {
    return false;
  }
};

const awardAchievement = async (userId, achievement) => {
  try {
    await db.query(
      `INSERT INTO user_achievements (user_id, achievement_type, achievement_name, achievement_description, achievement_data)
       VALUES (?, ?, ?, ?, ?)`,
      [userId, achievement.type, achievement.name, achievement.description, JSON.stringify(achievement.data || {})]
    );

    // Send notification
    await createNotification(
      userId,
      'Achievement Unlocked!',
      `You've earned the "${achievement.name}" achievement: ${achievement.description}`,
      'achievement',
      { achievementType: achievement.type }
    );

    console.log(`🏆 Achievement awarded to user ${userId}: ${achievement.name}`);
  } catch (error) {
    console.error('❌ Award achievement error:', error);
  }
};

const getReadingStreak = async (userId) => {
  try {
    const [streakData] = await db.query(`
      SELECT COUNT(*) as streak_days
      FROM (
        SELECT stat_date,
               LAG(stat_date) OVER (ORDER BY stat_date) as prev_date,
               DATEDIFF(stat_date, LAG(stat_date) OVER (ORDER BY stat_date)) as date_diff
        FROM daily_stats
        WHERE user_id = ? AND total_reading_time_seconds > 0
        ORDER BY stat_date DESC
      ) as streak_calc
      WHERE date_diff <= 1 OR prev_date IS NULL
    `, [userId]);

    return streakData[0]?.streak_days || 0;
  } catch (error) {
    console.error('❌ Get reading streak error:', error);
    return 0;
  }
};

// ==================== STATISTICS RETRIEVAL FUNCTIONS ====================

const getUserStatistics = async (userId, period = 'week') => {
  try {
    console.log(`📊 Getting statistics for user ${userId}, period: ${period}`);

    let dateCondition = '';
    const now = new Date();

    switch (period) {
      case 'week':
        const weekStart = new Date(now);
        weekStart.setDate(weekStart.getDate() - weekStart.getDay());
        weekStart.setHours(0, 0, 0, 0);
        dateCondition = `stat_date >= '${weekStart.toISOString().split('T')[0]}'`;
        break;

      case 'month':
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
        dateCondition = `stat_date >= '${monthStart.toISOString().split('T')[0]}'`;
        break;

      case '6months':
        const sixMonthsStart = new Date();
        sixMonthsStart.setMonth(sixMonthsStart.getMonth() - 6);
        dateCondition = `stat_date >= '${sixMonthsStart.toISOString().split('T')[0]}'`;
        break;

      case 'year':
        const yearStart = new Date(now.getFullYear(), 0, 1);
        dateCondition = `stat_date >= '${yearStart.toISOString().split('T')[0]}'`;
        break;

      default:
        dateCondition = `stat_date >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)`;
    }

    console.log('📅 Date condition:', dateCondition);

    // Get aggregated stats with proper null handling
    const [aggregatedStats] = await db.query(`
      SELECT
        COALESCE(SUM(total_reading_time_seconds), 0) as total_seconds,
        COALESCE(ROUND(AVG(total_reading_time_seconds)), 0) as daily_avg_seconds,
        COALESCE(SUM(total_words_read), 0) as total_words,
        COALESCE(ROUND(AVG(total_words_read)), 0) as daily_avg_words,
        COALESCE(SUM(documents_opened), 0) as total_documents_opened,
        COALESCE(SUM(documents_completed), 0) as total_documents_completed,
        COALESCE(ROUND(AVG(documents_completed), 1), 0) as daily_avg_documents,
        COALESCE(SUM(sessions_count), 0) as total_sessions,
        COALESCE(ROUND(AVG(sessions_count), 1), 0) as daily_avg_sessions,
        COALESCE(SUM(ai_actions_used), 0) as total_ai_actions,
        COUNT(DISTINCT stat_date) as active_days
      FROM daily_stats
      WHERE user_id = ? AND ${dateCondition}
    `, [userId]);

    console.log('📊 Raw aggregated stats:', aggregatedStats[0]);

    // Get today's specific stats
    const today = new Date().toISOString().split('T')[0];
    const [todayStats] = await db.query(`
      SELECT
        COALESCE(total_reading_time_seconds, 0) as today_seconds,
        COALESCE(total_words_read, 0) as today_words,
        COALESCE(documents_opened, 0) as today_docs_opened,
        COALESCE(documents_completed, 0) as today_docs_completed,
        COALESCE(sessions_count, 0) as today_sessions
      FROM daily_stats
      WHERE user_id = ? AND stat_date = ?
    `, [userId, today]);

    console.log('📅 Today stats:', todayStats[0]);

    // Get chart data for the period - IMPROVED
    let chartDataQuery = '';
    switch (period) {
      case 'week':
        chartDataQuery = `
          SELECT
            DAYNAME(stat_date) as label,
            SUBSTRING(DAYNAME(stat_date), 1, 1) as short_label,
            COALESCE(documents_completed, 0) as value
          FROM daily_stats
          WHERE user_id = ? AND ${dateCondition}
          ORDER BY stat_date ASC
        `;
        break;

      case 'month':
        chartDataQuery = `
          SELECT
            CONCAT('Week ', WEEK(stat_date, 1)) as label,
            CONCAT('W', WEEK(stat_date, 1)) as short_label,
            COALESCE(SUM(documents_completed), 0) as value
          FROM daily_stats
          WHERE user_id = ? AND ${dateCondition}
          GROUP BY WEEK(stat_date, 1)
          ORDER BY stat_date ASC
        `;
        break;

      case '6months':
        chartDataQuery = `
          SELECT
            MONTHNAME(stat_date) as label,
            SUBSTRING(MONTHNAME(stat_date), 1, 3) as short_label,
            COALESCE(SUM(documents_completed), 0) as value
          FROM daily_stats
          WHERE user_id = ? AND ${dateCondition}
          GROUP BY YEAR(stat_date), MONTH(stat_date)
          ORDER BY stat_date ASC
        `;
        break;

      case 'year':
        chartDataQuery = `
          SELECT
            MONTHNAME(stat_date) as label,
            SUBSTRING(MONTHNAME(stat_date), 1, 3) as short_label,
            COALESCE(SUM(documents_completed), 0) as value
          FROM daily_stats
          WHERE user_id = ? AND ${dateCondition}
          GROUP BY MONTH(stat_date)
          ORDER BY MONTH(stat_date) ASC
        `;
        break;

      default:
        chartDataQuery = `
          SELECT
            DATE_FORMAT(stat_date, '%a') as label,
            DATE_FORMAT(stat_date, '%a') as short_label,
            COALESCE(documents_completed, 0) as value
          FROM daily_stats
          WHERE user_id = ? AND ${dateCondition}
          ORDER BY stat_date ASC
        `;
    }

    const [chartData] = await db.query(chartDataQuery, [userId]);
    console.log('📈 Chart data:', chartData);

    // Get reading goals for progress calculation
    const [goals] = await db.query(`
      SELECT target_type, target_value, current_value, goal_type
      FROM reading_goals
      WHERE user_id = ? AND is_active = TRUE
    `, [userId]);

    console.log('🎯 Goals:', goals);

    // Process the data
    const stats = aggregatedStats[0] || {};
    const todayData = todayStats[0] || {};

    // Convert seconds to minutes for display
    const totalMinutes = Math.round(stats.total_seconds / 60);
    const dailyAvgMinutes = Math.round(stats.daily_avg_seconds / 60);
    const todayMinutes = Math.round(todayData.today_seconds / 60);

    // Calculate reading streak
    const [streakData] = await db.query(`
      SELECT COUNT(DISTINCT stat_date) as streak_days
      FROM daily_stats
      WHERE user_id = ?
      AND stat_date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
      AND total_reading_time_seconds > 0
      ORDER BY stat_date DESC
    `, [userId]);

    const streak = streakData[0]?.streak_days || 0;

    // Build goal map for easy lookup
    const goalMap = {};
    goals.forEach(goal => {
      const key = `${goal.goal_type}_${goal.target_type}`;
      goalMap[key] = {
        target: goal.target_value,
        current: goal.current_value,
        percentage: Math.round((goal.current_value / goal.target_value) * 100)
      };
    });

    // FIXED: Properly structure the response with all metrics
    const result = {
      time: {
        daily: todayMinutes, // Today's reading time in minutes
        total: totalMinutes, // Total for the period
        goal: goalMap['daily_time']?.target || 60, // Default 60 min goal
        current: goalMap['daily_time']?.current || todayMinutes,
        unit: 'min'
      },
      words: {
        daily: todayData.today_words || 0,
        total: stats.total_words || 0,
        goal: goalMap['monthly_words']?.target || 2000,
        current: goalMap['monthly_words']?.current || stats.total_words || 0,
        unit: 'words'
      },
      documents: {
        daily: todayData.today_docs_completed || 0, // TODAY'S COMPLETED DOCUMENTS
        total: stats.total_documents_completed || 0, // TOTAL COMPLETED FOR PERIOD
        goal: goalMap['weekly_documents']?.target || 5,
        current: goalMap['weekly_documents']?.current || stats.total_documents_completed || 0,
        unit: 'docs'
      },
      sessions: {
        daily: todayData.today_sessions || 0,
        total: stats.total_sessions || 0,
        goal: goalMap['daily_sessions']?.target || 3,
        current: goalMap['daily_sessions']?.current || stats.total_sessions || 0,
        unit: 'sessions'
      },
      streak: streak,
      chartData: chartData.map(row => ({
        day: row.label,
        value: Math.min(100, Math.max(0, row.value || 0)),
        label: row.short_label
      }))
    };

    console.log('✅ Final processed statistics:', JSON.stringify(result, null, 2));
    return result;

  } catch (error) {
    console.error('❌ Get user statistics error:', error);
    throw error;
  }
};


// Get user insights
const getUserInsights = async (userId) => {
  try {
    const insights = [];

    // Get recent performance
    const [recentStats] = await db.query(`
      SELECT * FROM daily_stats
      WHERE user_id = ?
      ORDER BY stat_date DESC
      LIMIT 14
    `, [userId]);

    if (recentStats.length >= 2) {
      const today = recentStats[0];
      const yesterday = recentStats[1];

      // Progress insight
      const progressChange = ((today.total_reading_time_seconds - yesterday.total_reading_time_seconds) / yesterday.total_reading_time_seconds) * 100;
      if (progressChange > 15) {
        insights.push({
          type: 'progress',
          icon: 'trending-up',
          color: '#4CAF50',
          title: 'Great Progress!',
          message: `You're ${Math.round(progressChange)}% ahead of yesterday's performance. Keep it up!`
        });
      }
    }

    // Reading streak
    const streak = await getReadingStreak(userId);
    if (streak >= 3) {
      insights.push({
        type: 'streak',
        icon: 'local-fire-department',
        color: '#FF9800',
        title: 'Streak Bonus',
        message: `You've maintained a ${streak}-day learning streak. Amazing consistency!`
      });
    }

    // Peak time analysis
    const [peakTimeData] = await db.query(`
      SELECT HOUR(session_start) as hour, COUNT(*) as session_count
      FROM reading_sessions
      WHERE user_id = ? AND session_start >= DATE_SUB(NOW(), INTERVAL 30 DAY)
      GROUP BY HOUR(session_start)
      ORDER BY session_count DESC
      LIMIT 1
    `, [userId]);

    if (peakTimeData.length > 0) {
      const peakHour = peakTimeData[0].hour;
      const timeRange = `${peakHour}:00-${peakHour + 1}:00`;
      insights.push({
        type: 'peak_time',
        icon: 'schedule',
        color: '#2196F3',
        title: 'Peak Learning Time',
        message: `Your most productive time is between ${timeRange}. Schedule important reading during this time.`
      });
    }

    return insights;
  } catch (error) {
    console.error('❌ Get user insights error:', error);
    return [];
  }
};

// Get user achievements
const getUserAchievements = async (userId) => {
  try {
    const [achievements] = await db.query(`
      SELECT achievement_type, achievement_name, achievement_description, earned_at, achievement_data
      FROM user_achievements
      WHERE user_id = ?
      ORDER BY earned_at DESC
    `, [userId]);

    return achievements.map(achievement => ({
      id: achievement.achievement_type,
      name: achievement.achievement_name,
      description: achievement.achievement_description,
      earnedAt: achievement.earned_at,
      data: achievement.achievement_data ? JSON.parse(achievement.achievement_data) : {},
      icon: getAchievementIcon(achievement.achievement_type),
      color: getAchievementColor(achievement.achievement_type)
    }));
  } catch (error) {
    console.error('❌ Get user achievements error:', error);
    return [];
  }
};

// Helper functions for achievements
const getAchievementIcon = (type) => {
  const iconMap = {
    hour_reader: 'emoji-events',
    speed_reader: 'flash-on',
    word_master: 'bookmark',
    week_streak: 'local-fire-department',
    month_streak: 'military-tech',
    first_document: 'first-page',
    ai_explorer: 'psychology',
    ocr_master: 'camera',
    chat_enthusiast: 'chat',
    goal_achiever: 'flag'
  };
  return iconMap[type] || 'emoji-events';
};

const getAchievementColor = (type) => {
  const colorMap = {
    hour_reader: '#FFD700',
    speed_reader: '#FF5722',
    word_master: '#9C27B0',
    week_streak: '#FF9800',
    month_streak: '#795548',
    first_document: '#4CAF50',
    ai_explorer: '#3F51B5',
    ocr_master: '#607D8B',
    chat_enthusiast: '#00BCD4',
    goal_achiever: '#FFC107'
  };
  return colorMap[type] || '#FFD700';
};

module.exports = {
  trackActivity,
  updateDailyStats,
  startReadingSession,
  updateReadingSession,
  endReadingSession,
  checkAchievements,
  hasAchievement,
  awardAchievement,
  getReadingStreak,
  getUserStatistics,
  getUserInsights,
  getUserAchievements,
  getAchievementIcon,
  getAchievementColor
};
