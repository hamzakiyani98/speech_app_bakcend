const express = require('express');
const router = express.Router();

// Import middleware
const { authenticateToken } = require('../middleware/auth');
const { checkFeatureAccess, requirePremiumOrTrial } = require('../middleware/featureAccess');

// Import controllers
const {
  getChats,
  getChatById,
  createChat,
  sendMessage,
  deleteChat
} = require('../controllers/chatController');

// Get all chats
router.get('/', authenticateToken, getChats);

// Get chat by ID
router.get('/:id', authenticateToken, getChatById);

// Create new chat
router.post('/', authenticateToken, checkFeatureAccess, requirePremiumOrTrial, createChat);

// Send message in chat
router.post('/:id/messages', authenticateToken, checkFeatureAccess, requirePremiumOrTrial, sendMessage);

// Delete chat
router.delete('/:id', authenticateToken, deleteChat);

module.exports = router;
