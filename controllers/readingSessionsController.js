const { db } = require('../config/database');
const { updateDailyStats, endReadingSession, trackActivity, checkAchievements, updateReadingSession } = require('../utils/statistics');

// Start reading session
const startReadingSession = async (req, res) => {
  try {
    const { documentId, playbackSpeed = 1.0 } = req.body;
    const userId = req.user.id;

    if (!documentId) {
      return res.status(400).json({ error: 'Document ID is required' });
    }

    // Free users: Check listening time limit
    if (req.user.planType === 'free') {
      const today = new Date().toISOString().split('T')[0];
      const [usageData] = await db.query(
        `SELECT COALESCE(listeningTimeUsed, 0) as used FROM user_usage
         WHERE user_id = ? AND date = ?`,
        [userId, today]
      );

      const dailyLimit = 20; // 20 minutes for free users
      const used = usageData[0]?.used || 0;

      if (used >= dailyLimit) {
        return res.status(429).json({
          success: false,
          error: 'Daily listening limit reached',
          code: 'LIMIT_EXCEEDED',
          plan: 'free',
          used: used,
          limit: dailyLimit,
          remaining: 0,
          message: 'Free users have a 20 minute per day listening limit. Upgrade to Premium for unlimited listening.'
        });
      }
    }

    // Verify document ownership
    const [docs] = await db.query(
      'SELECT id FROM documents WHERE id = ? AND user_id = ?',
      [documentId, userId]
    );

    if (docs.length === 0) {
      return res.status(404).json({ error: 'Document not found' });
    }

    // Create reading session
    const [result] = await db.query(
      `INSERT INTO reading_sessions (user_id, document_id, session_start, playback_speed, completion_status)
       VALUES (?, ?, CURRENT_TIMESTAMP, ?, 'started')`,
      [userId, documentId, playbackSpeed]
    );

    // Track activity
    await trackActivity(userId, 'reading_session_started', 'document', documentId, {
      playbackSpeed
    });

    res.status(201).json({
      success: true,
      sessionId: result.insertId,
      message: 'Reading session started'
    });

  } catch (error) {
    console.error('❌ Start reading session error:', error);
    res.status(500).json({ error: 'Failed to start reading session' });
  }
};

// Update reading session progress
const updateReadingProgress = async (req, res) => {
  try {
    const { sessionId } = req.params;
    const {
      readingTimeSeconds,
      wordsRead,
      charactersRead,  // 🔥 ADD THIS
      pagesRead,
      progressPercentage,
      completionStatus,
      currentParagraph,  // 🔥 ADD THIS
      currentCharacterPosition  // 🔥 ADD THIS
    } = req.body;

    // Verify session belongs to user
    const [sessions] = await db.query(
      'SELECT user_id FROM reading_sessions WHERE id = ?',
      [sessionId]
    );

    if (sessions.length === 0 || sessions[0].user_id !== req.user.id) {
      return res.status(404).json({ error: 'Reading session not found' });
    }

   await updateReadingSession(sessionId, {
      readingTimeSeconds,
      wordsRead,
      charactersRead,  // 🔥 ADD THIS
      pagesRead,
      progressPercentage,
      completionStatus
    });

    // 🔥 UPDATE USAGE TRACKING
    const today = new Date().toISOString().split('T')[0];

    // Track character usage for the session
    if (charactersRead > 0) {
      await db.query(
        `INSERT INTO user_usage (user_id, date, charactersUsed)
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE charactersUsed = charactersUsed + VALUES(charactersUsed)`,
        [req.user.id, today, charactersRead]
      );
    }

    // Track word count
    if (wordsRead > 0) {
      await db.query(
        `INSERT INTO user_usage (user_id, date, wordsRead)
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE wordsRead = wordsRead + VALUES(wordsRead)`,
        [req.user.id, today, wordsRead]
      );
    }

    // Check for achievements
    await checkAchievements(req.user.id);

    res.json({
      success: true,
      message: 'Reading session updated'
    });

  } catch (error) {
    console.error('❌ Update reading session error:', error);
    res.status(500).json({ error: 'Failed to update reading session' });
  }
};

// End reading session
const endReadingSessionHandler = async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { readingTimeSeconds, wordsRead, pagesRead, progressPercentage, completionStatus } = req.body;

    // Verify session belongs to user
    const [sessions] = await db.query(
      'SELECT user_id FROM reading_sessions WHERE id = ?',
      [sessionId]
    );

    if (sessions.length === 0 || sessions[0].user_id !== req.user.id) {
      return res.status(404).json({ error: 'Reading session not found' });
    }

    await endReadingSession(sessionId, {
      readingTimeSeconds,
      wordsRead,
      pagesRead,
      progressPercentage,
      completionStatus
    });

    // Check for achievements
    await checkAchievements(req.user.id);

    res.json({
      success: true,
      message: 'Reading session ended'
    });

  } catch (error) {
    console.error('❌ End reading session error:', error);
    res.status(500).json({ error: 'Failed to end reading session' });
  }
};

// Save reading position
const saveReadingPosition = async (req, res) => {
  try {
    const userId = req.user.id;
    const {
      documentId,
      paragraphIndex,
      characterPosition,  // Character within paragraph
      wordPosition,  // 🔥 ADD THIS - Word within paragraph
      totalParagraphs,
      progress,
      documentLength,
      totalWordsRead,  // 🔥 ADD THIS
      totalCharactersRead  // 🔥 ADD THIS
    } = req.body;

    // Validate required fields
    if (!documentId || paragraphIndex === undefined) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields'
      });
    }

    const query = `
      INSERT INTO reading_positions (
        user_id, document_id, paragraph_index, character_position, word_position,
        total_paragraphs, progress, document_length,
        total_words_read, total_characters_read, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
      ON DUPLICATE KEY UPDATE
        paragraph_index = VALUES(paragraph_index),
        character_position = VALUES(character_position),
        word_position = VALUES(word_position),
        total_paragraphs = VALUES(total_paragraphs),
        progress = VALUES(progress),
        document_length = VALUES(document_length),
        total_words_read = VALUES(total_words_read),
        total_characters_read = VALUES(total_characters_read),
        updated_at = NOW()
    `;

    await db.query(query, [
      userId,
      documentId,
      paragraphIndex,
      characterPosition || 0,
      wordPosition || 0,  // 🔥 ADD THIS
      totalParagraphs,
      progress,
      documentLength,
      totalWordsRead || 0,  // 🔥 ADD THIS
      totalCharactersRead || 0  // 🔥 ADD THIS
    ]);

    console.log('✅ Position saved:', {
      userId,
      documentId,
      paragraphIndex,
      characterPosition,
      wordPosition,
      totalWordsRead,
      totalCharactersRead
    });

    res.json({
      success: true,
      message: 'Position saved successfully'
    });

  } catch (error) {
    console.error('❌ Save position error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to save position'
    });
  }
};

// Load reading position
const loadReadingPosition = async (req, res) => {
  try {
    const userId = req.user.id;
    const { documentId } = req.params;

   const query = `
      SELECT
        paragraph_index,
        character_position,
        word_position,
        total_paragraphs,
        progress,
        document_length,
        total_words_read,
        total_characters_read,
        updated_at
      FROM reading_positions
      WHERE user_id = ? AND document_id = ?
    `;

    const [results] = await db.query(query, [userId, documentId]);

    if (results.length === 0) {
      return res.json({
        success: true,
        position: null
      });
    }

    res.json({
      success: true,
      position: {
        paragraphIndex: results[0].paragraph_index,
        characterPosition: results[0].character_position,
        wordPosition: results[0].word_position,  // 🔥 ADD THIS
        totalParagraphs: results[0].total_paragraphs,
        progress: results[0].progress,
        documentLength: results[0].document_length,
        totalWordsRead: results[0].total_words_read,  // 🔥 ADD THIS
        totalCharactersRead: results[0].total_characters_read,  // 🔥 ADD THIS
        timestamp: results[0].updated_at
      }
    });

  } catch (error) {
    console.error('❌ Load position error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to load position'
    });
  }
};

// Save document position
const saveDocumentPosition = async (req, res) => {
  try {
    const { documentId } = req.params;
    const userId = req.user.id;
    const {
      paragraphIndex,
      characterPosition,
      wordPosition,
      totalParagraphs,
      progress,
      timestamp,
      documentLength,
      totalWordsRead,
      totalCharactersRead
    } = req.body;

    // Verify document belongs to user
    const [docs] = await db.query(
      'SELECT id FROM documents WHERE id = ? AND user_id = ?',
      [documentId, userId]
    );

    if (docs.length === 0) {
      return res.status(404).json({ error: 'Document not found' });
    }

    // 🔥 FIX: Use correct column name 'progress' and add new columns
    await db.query(
      `INSERT INTO reading_positions (
        user_id,
        document_id,
        paragraph_index,
        character_position,
        word_position,
        total_paragraphs,
        progress,
        document_length,
        total_words_read,
        total_characters_read,
        updated_at
      )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
       ON DUPLICATE KEY UPDATE
       paragraph_index = VALUES(paragraph_index),
       character_position = VALUES(character_position),
       word_position = VALUES(word_position),
       total_paragraphs = VALUES(total_paragraphs),
       progress = VALUES(progress),
       document_length = VALUES(document_length),
       total_words_read = VALUES(total_words_read),
       total_characters_read = VALUES(total_characters_read),
       updated_at = NOW()`,
      [
        userId,
        documentId,
        paragraphIndex || 0,
        characterPosition || 0,
        wordPosition || 0,
        totalParagraphs || 0,
        progress || 0,
        documentLength || 0,
        totalWordsRead || 0,
        totalCharactersRead || 0
      ]
    );

    console.log('✅ Reading position saved for document:', documentId);
    res.json({
      success: true,
      message: 'Reading position saved'
    });

  } catch (error) {
    console.error('❌ Save reading position error:', error);
    res.status(500).json({ error: 'Failed to save reading position' });
  }
};

// Get document position
const getDocumentPosition = async (req, res) => {
  try {
    const { documentId } = req.params;
    const userId = req.user.id;

    // Verify document belongs to user
    const [docs] = await db.query(
      'SELECT id FROM documents WHERE id = ? AND user_id = ?',
      [documentId, userId]
    );

    if (docs.length === 0) {
      return res.status(404).json({ error: 'Document not found' });
    }

    // 🔥 FIX: Use correct column name 'progress' instead of 'progress_percentage'
    const [positions] = await db.query(
      `SELECT
        paragraph_index,
        character_position,
        word_position,
        total_paragraphs,
        progress,
        document_length,
        total_words_read,
        total_characters_read,
        updated_at as last_updated
       FROM reading_positions
       WHERE user_id = ? AND document_id = ?`,
      [userId, documentId]
    );

    if (positions.length === 0) {
      return res.json({
        success: false,
        message: 'No saved position found'
      });
    }

    const position = positions[0];
    console.log('✅ Reading position loaded for document:', documentId);

    res.json({
      success: true,
      position: {
        paragraphIndex: position.paragraph_index,
        characterPosition: position.character_position || 0,
        wordPosition: position.word_position || 0,
        totalParagraphs: position.total_paragraphs,
        progress: position.progress,
        timestamp: position.last_updated,
        documentLength: position.document_length,
        totalWordsRead: position.total_words_read || 0,
        totalCharactersRead: position.total_characters_read || 0
      }
    });

  } catch (error) {
    console.error('❌ Load reading position error:', error);
    res.status(500).json({ error: 'Failed to load reading position' });
  }
};

module.exports = {
  startReadingSession,
  updateReadingProgress,
  endReadingSession: endReadingSessionHandler,
  saveReadingPosition,
  loadReadingPosition,
  saveDocumentPosition,
  getDocumentPosition
};
