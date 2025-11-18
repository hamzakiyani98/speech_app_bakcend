const express = require('express');
const router = express.Router();
const { testTTS, synthesizeSpeech, getVoices } = require('../controllers/ttsController');

// TTS Routes
router.get('/test', testTTS);
router.post('/synthesize', synthesizeSpeech);
router.get('/voices', getVoices);

module.exports = router;
