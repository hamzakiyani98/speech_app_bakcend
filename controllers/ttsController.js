const { ttsClient } = require('../config/services');
const { getGenderFromVoice } = require('../utils/ttsHelpers');

// Test endpoint handler
const testTTS = (req, res) => {
  res.json({
    success: true,
    message: 'TTS Backend is running',
    timestamp: new Date().toISOString(),
    projectId: 'custom-point-463612-v5'
  });
};

// Synthesize speech handler
const synthesizeSpeech = async (req, res) => {
  try {
    console.log('🔍 BACKEND DEBUG - Full request body received:', JSON.stringify(req.body, null, 2));

    const { text, voice, speed, languageCode } = req.body;

    // Validate input
    if (!text || text.trim().length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Text is required for synthesis'
      });
    }

    console.log('🔍 BACKEND DEBUG - Extracted parameters:', {
      voice: voice,
      speed: speed,
      languageCode: languageCode,
      textLength: text?.length
    });

    // Handle voice parameter with detailed logging
    let voiceId = voice || 'en-US-Neural2-F';
    console.log('🔍 BACKEND DEBUG - voiceId after fallback:', voiceId);

    const extractedLanguageCode = languageCode || voiceId.split('-').slice(0, 2).join('-');

    console.log('🗣️ BACKEND DEBUG - TTS Synthesis Request:', {
      textLength: text.length,
      textPreview: text.substring(0, 50) + '...',
      voiceId,
      extractedLanguageCode,
      speed: speed || 1.0
    });

    // Validate voice name format
    if (!voiceId.match(/^[a-z]{2}-[A-Z]{2}-Neural2-[A-J]$/)) {
      console.warn('⚠️ BACKEND DEBUG - Invalid voice format, using default. Invalid:', voiceId);
      voiceId = 'en-US-Neural2-F';
    }

    console.log('🔍 BACKEND DEBUG - Final voiceId after validation:', voiceId);

    // Get gender for the voice
    const voiceGender = getGenderFromVoice(voiceId);
    console.log('🔍 BACKEND DEBUG - Voice gender determined:', voiceGender);

    // Construct request for Google Cloud TTS
    const request = {
      input: { text: text.trim() },
      voice: {
        languageCode: extractedLanguageCode,
        name: voiceId,
        ssmlGender: voiceGender,
      },
      audioConfig: {
        audioEncoding: 'MP3',
        speakingRate: Math.max(0.25, Math.min(4.0, speed || 1.0)),
        pitch: 0,
        volumeGainDb: 0,
      },
    };

    console.log('📤 BACKEND DEBUG - Sending to Google Cloud TTS:', JSON.stringify(request, null, 2));

    // Call Google Cloud TTS
    const [response] = await ttsClient.synthesizeSpeech(request);

    if (!response.audioContent) {
      throw new Error('No audio content received from Google Cloud TTS');
    }

    console.log('✅ BACKEND DEBUG - TTS synthesis successful:', {
      audioSize: response.audioContent.length,
      voiceRequested: voiceId,
      voiceUsed: voiceId, // This should match what we requested
      languageCode: extractedLanguageCode,
      gender: voiceGender
    });

    res.json({
      success: true,
      audioContent: response.audioContent.toString('base64'),
      voiceUsed: voiceId, // Return the voice we actually used
      voiceRequested: voice, // Return what was originally requested
      languageCode: extractedLanguageCode,
      audioSize: response.audioContent.length,
      gender: voiceGender,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ BACKEND DEBUG - Google TTS Error:', error);

    let errorMessage = error.message;
    let errorCode = 'UNKNOWN_ERROR';

    if (error.code === 3) {
      errorMessage = 'Invalid voice or language code';
      errorCode = 'INVALID_VOICE';
    } else if (error.code === 7) {
      errorMessage = 'Authentication failed - check credentials';
      errorCode = 'AUTH_ERROR';
    }

    res.status(500).json({
      success: false,
      error: errorMessage,
      errorCode: errorCode,
      timestamp: new Date().toISOString()
    });
  }
};

// Get available voices handler
const getVoices = async (req, res) => {
  try {
    console.log('🎤 Fetching available voices...');

    const [result] = await ttsClient.listVoices({});
    const voices = result.voices;

    // Filter for Neural2 voices
    const neural2Voices = voices.filter(voice =>
      voice.name.includes('Neural2') &&
      voice.languageCodes.includes('en-US')
    );

    console.log(`✅ Found ${neural2Voices.length} Neural2 voices`);

    res.json({
      success: true,
      voices: neural2Voices.map(voice => ({
        id: voice.name,
        name: voice.name.split('-').pop(),
        language: voice.languageCodes[0],
        languageCode: voice.languageCodes[0],
        gender: voice.ssmlGender
      })),
      total: neural2Voices.length
    });

  } catch (error) {
    console.error('❌ Error fetching voices:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

module.exports = {
  testTTS,
  synthesizeSpeech,
  getVoices
};
