const { db } = require('../config/database');
const { generateChatbotResponse } = require('../utils/chatbot');
const { trackActivity } = require('../utils/statistics');

// Get all chats for authenticated user
const getChats = async (req, res) => {
  try {
    const [chats] = await db.query(`
      SELECT
        cs.id,
        cs.title,
        cs.document_id,
        cs.created_at,
        cs.updated_at,
        d.title as document_title,
        d.file_type,
        (SELECT message FROM chat_messages WHERE chat_id = cs.id ORDER BY created_at DESC LIMIT 1) as last_message,
        (SELECT created_at FROM chat_messages WHERE chat_id = cs.id ORDER BY created_at DESC LIMIT 1) as last_message_time
      FROM chat_sessions cs
      LEFT JOIN documents d ON cs.document_id = d.id
      WHERE cs.user_id = ?
      ORDER BY cs.updated_at DESC
    `, [req.user.id]);

    res.json(chats);
  } catch (error) {
    console.error('❌ Get chats error:', error);
    res.status(500).json({ error: 'Failed to fetch chat sessions' });
  }
};

// Get chat by ID with messages
const getChatById = async (req, res) => {
  try {
    const [chats] = await db.query(`
      SELECT
        cs.*,
        d.title as document_title,
        d.content as document_content,
        d.file_type
      FROM chat_sessions cs
      LEFT JOIN documents d ON cs.document_id = d.id
      WHERE cs.id = ? AND cs.user_id = ?
    `, [req.params.id, req.user.id]);

    if (chats.length === 0) {
      return res.status(404).json({ error: 'Chat session not found' });
    }

    const [messages] = await db.query(`
      SELECT id, sender, message, message_type, metadata, created_at
      FROM chat_messages
      WHERE chat_id = ?
      ORDER BY created_at ASC
    `, [req.params.id]);

    const chat = chats[0];
    res.json({
      ...chat,
      messages: messages.map(msg => ({
        ...msg,
        metadata: msg.metadata ? JSON.parse(msg.metadata) : null
      }))
    });

  } catch (error) {
    console.error('❌ Get chat error:', error);
    res.status(500).json({ error: 'Failed to fetch chat session' });
  }
};

// Create new chat session
const createChat = async (req, res) => {
  try {
    const { document_id, title } = req.body;
    const userId = req.user.id;

    // Verify document ownership
    const [documents] = await db.query(
      'SELECT id, title FROM documents WHERE id = ? AND user_id = ?',
      [document_id, userId]
    );

    if (documents.length === 0) {
      return res.status(404).json({ error: 'Document not found' });
    }

    const document = documents[0];
    const chatTitle = title || `Chat about "${document.title}"`;

    const [result] = await db.query(
      'INSERT INTO chat_sessions (user_id, document_id, title) VALUES (?, ?, ?)',
      [userId, document_id, chatTitle]
    );

    const welcomeMessage = `Hi! I'm here to help you with your document "${document.title}". You can ask me questions about its content, request summaries, translations, or any analysis you need. What would you like to know?`;

    await db.query(
      'INSERT INTO chat_messages (chat_id, sender, message, message_type) VALUES (?, ?, ?, ?)',
      [result.insertId, 'bot', welcomeMessage, 'text']
    );

    // Track activity
    await trackActivity(userId, 'chat_created', 'chat', result.insertId, {
      documentId: document_id
    });

    res.status(201).json({
      success: true,
      id: result.insertId,
      title: chatTitle,
      document_id: document_id,
      document_title: document.title,
      created_at: new Date().toISOString()
    });

  } catch (error) {
    console.error('Create chat error:', error);
    res.status(500).json({ error: 'Failed to create chat session' });
  }
};

// Send message in chat
const sendMessage = async (req, res) => {
  try {
    const { message, message_type = 'text' } = req.body;
    const chatId = req.params.id;
    const userId = req.user.id;

    if (!message || !message.trim()) {
      return res.status(400).json({ error: 'Message is required' });
    }

    // Check daily usage limit
    const today = new Date().toISOString().split('T')[0];
    const [usageData] = await db.query(
      `SELECT COALESCE(chatbotQuestionsUsed, 0) as used FROM user_usage
       WHERE user_id = ? AND date = ?`,
      [userId, today]
    );

    const [limits] = await db.query(
      `SELECT daily_limit FROM feature_limits
       WHERE plan_type = ? AND feature_key = 'chatbot_questions'`,
      [req.user.planType]
    );

    const dailyLimit = limits[0]?.daily_limit || 0;
    const used = usageData[0]?.used || 0;

    if (used >= dailyLimit && !limits[0]?.is_unlimited) {
      return res.status(429).json({
        error: 'Daily chatbot question limit reached',
        code: 'LIMIT_EXCEEDED'
      });
    }

    // Verify chat ownership
    const [chats] = await db.query(
      `SELECT cs.*, d.content FROM chat_sessions cs
       LEFT JOIN documents d ON cs.document_id = d.id
       WHERE cs.id = ? AND cs.user_id = ?`,
      [chatId, userId]
    );

    if (chats.length === 0) {
      return res.status(404).json({ error: 'Chat session not found' });
    }

    const chat = chats[0];

    // Save user message
    const [userMessageResult] = await db.query(
      'INSERT INTO chat_messages (chat_id, sender, message, message_type) VALUES (?, ?, ?, ?)',
      [chatId, 'user', message.trim(), message_type]
    );

    // Get chat history for context
    const [recentMessages] = await db.query(
      `SELECT sender, message FROM chat_messages
       WHERE chat_id = ?
       ORDER BY created_at DESC
       LIMIT 10`,
      [chatId]
    );

    const chatHistory = recentMessages.reverse();

    console.log('🤖 Generating chatbot response...');

    // Generate AI response
    const aiResponse = await generateChatbotResponse(
      message.trim(),
      chat.content || '',
      chat.document_id ? `Document #${chat.document_id}` : 'Document',
      chatHistory
    );

    // Save bot message
    const [botMessageResult] = await db.query(
      'INSERT INTO chat_messages (chat_id, sender, message, message_type, metadata) VALUES (?, ?, ?, ?, ?)',
      [chatId, 'bot', aiResponse.message, aiResponse.type, JSON.stringify(aiResponse.metadata || {})]
    );

    // Update chat session timestamp
    await db.query(
      'UPDATE chat_sessions SET updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [chatId]
    );

    // Increment usage
    await db.query(
      `INSERT INTO user_usage (user_id, date, chatbotQuestionsUsed)
       VALUES (?, ?, 1)
       ON DUPLICATE KEY UPDATE chatbotQuestionsUsed = chatbotQuestionsUsed + 1`,
      [userId, today]
    );

    // Track activity
    await trackActivity(userId, 'chat_message', 'chat', chatId, {
      messageLength: message.length
    });

    res.json({
      success: true,
      user_message: {
        id: userMessageResult.insertId,
        sender: 'user',
        message: message.trim(),
        message_type: message_type,
        created_at: new Date().toISOString()
      },
      bot_response: {
        id: botMessageResult.insertId,
        sender: 'bot',
        message: aiResponse.message,
        message_type: aiResponse.type,
        metadata: aiResponse.metadata || {},
        created_at: new Date().toISOString()
      }
    });

  } catch (error) {
    console.error('Send message error:', error);
    res.status(500).json({ error: 'Failed to send message: ' + error.message });
  }
};

// Delete chat session
const deleteChat = async (req, res) => {
  try {
    const [chats] = await db.query(
      'SELECT id FROM chat_sessions WHERE id = ? AND user_id = ?',
      [req.params.id, req.user.id]
    );

    if (chats.length === 0) {
      return res.status(404).json({ error: 'Chat session not found' });
    }

    await db.query('DELETE FROMagers chat_messages WHERE chat_id = ?', [req.params.id]);

    await db.query('DELETE FROM chat_sessions WHERE id = ?', [req.params.id]);

    res.json({ message: 'Chat session deleted successfully' });

  } catch (error) {
    console.error('❌ Delete chat error:', error);
    res.status(500).json({ error: 'Failed to delete chat session' });
  }
};

module.exports = {
  getChats,
  getChatById,
  createChat,
  sendMessage,
  deleteChat
};
