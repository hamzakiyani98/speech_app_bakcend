const express = require('express');
const router = express.Router();
const { test, health } = require('../controllers/healthController');

// Health check routes
router.get('/test', test);
router.get('/health', health);

module.exports = router;
