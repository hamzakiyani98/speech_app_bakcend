const { openai } = require('../config/services');
const fs = require('fs-extra');
const path = require('path');
const ffmpeg = require('fluent-ffmpeg');

// Whisper transcription function
const transcribeAudioWithWhisper = async (audioBuffer) => {
  try {
    console.log('🎤 Starting Whisper transcription...');

    // Create FormData for OpenAI Whisper API
    const formData = new FormData();

    // Convert buffer to blob for FormData
    const audioBlob = new Blob([audioBuffer], { type: 'audio/mp4' });
    formData.append('file', audioBlob, 'audio.mp4');
    formData.append('model', 'whisper-1');
    formData.append('language', 'en'); // Can be made configurable

    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: formData,
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(`Whisper API error: ${response.status} - ${errorData.error?.message || 'Unknown error'}`);
    }

    const result = await response.json();
    console.log('✅ Whisper transcription completed');

    return result;

  } catch (error) {
    console.error('❌ Whisper transcription error:', error);
    throw new Error('Audio transcription failed: ' + error.message);
  }
};

// OpenAI command processing function
const processVoiceCommandWithAI = async (transcribedText, totalChunks) => {
  try {
    console.log('🤖 Processing voice command with OpenAI...');

    const systemMessage = `You are a voice command processor for a document reading app.
    Users can give voice commands to control document playback and analysis.

    Available commands:
    1. SELECT commands: "select part 3", "choose section 2", "pick chunk 5"
    2. RANGE commands: "select from part 2 to 5", "choose sections 1 to 3"
    3. ANALYSIS commands: "summarize part 2", "analyze section 3", "review chunk 4"
    4. PLAYBACK commands: "play", "pause", "stop", "next", "previous", "faster", "slower"
    5. NAVIGATION commands: "go to part 3", "jump to section 5"
    6. CLEAR commands: "clear selection", "reset", "clear"

    The document has ${totalChunks} total chunks/parts/sections.

    Return a JSON response with this exact structure:
    {
      "success": true/false,
      "type": "single|range|analysis|playback|navigation|clear|unknown",
      "action": "select|summarize|analyze|play|pause|stop|next|previous|speed|goto|clear",
      "chunks": [array of chunk indices, 0-based],
      "analysisType": "summary|analysis|null",
      "message": "human readable description of what will happen",
      "error": "error message if success is false"
    }

    Examples:
    - "select part 3" → {"success": true, "type": "single", "action": "select", "chunks": [2], "analysisType": null, "message": "Selected part 3"}
    - "summarize section 2" → {"success": true, "type": "analysis", "action": "summarize", "chunks": [1], "analysisType": "summary", "message": "Will summarize section 2"}
    - "play" → {"success": true, "type": "playback", "action": "play", "chunks": [], "analysisType": null, "message": "Starting playback"}
    `;

    const prompt = `Process this voice command: "${transcribedText}"

    Convert it to the appropriate action for a document reader app. Be flexible with language - users might say "part", "section", "chunk", or "paragraph" interchangeably.`;

    const response = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [
        { role: 'system', content: systemMessage },
        { role: 'user', content: prompt }
      ],
      max_tokens: 300,
      temperature: 0.1, // Low temperature for consistent parsing
    });

    const aiResponse = response.choices[0].message.content.trim();
    console.log('🤖 OpenAI response:', aiResponse);

    try {
      const commandResult = JSON.parse(aiResponse);

      // Validate the response structure
      if (!commandResult.hasOwnProperty('success')) {
        throw new Error('Invalid response structure');
      }

      // Ensure chunks are within valid range
      if (commandResult.chunks && Array.isArray(commandResult.chunks)) {
        commandResult.chunks = commandResult.chunks.filter(chunk =>
          chunk >= 0 && chunk < totalChunks
        );
      }

      console.log('✅ Command processed successfully:', commandResult);
      return commandResult;

    } catch (parseError) {
      console.error('❌ Failed to parse OpenAI response:', parseError);

      // Fallback: try to extract basic commands manually
      return parseCommandFallback(transcribedText, totalChunks);
    }

  } catch (error) {
    console.error('❌ OpenAI command processing error:', error);

    // Fallback to manual parsing
    return parseCommandFallback(transcribedText, totalChunks);
  }
};

// Fallback command parser
const parseCommandFallback = (command, totalChunks) => {
  const lowerCommand = command.toLowerCase();

  // Play/Pause commands
  if (lowerCommand.includes('play') && !lowerCommand.includes('pause')) {
    return {
      success: true,
      type: 'playback',
      action: 'play',
      chunks: [],
      analysisType: null,
      message: 'Starting playback'
    };
  }

  if (lowerCommand.includes('pause')) {
    return {
      success: true,
      type: 'playback',
      action: 'pause',
      chunks: [],
      analysisType: null,
      message: 'Pausing playback'
    };
  }

  if (lowerCommand.includes('stop')) {
    return {
      success: true,
      type: 'playback',
      action: 'stop',
      chunks: [],
      analysisType: null,
      message: 'Stopping playback'
    };
  }

  // Next/Previous commands
  if (lowerCommand.includes('next')) {
    return {
      success: true,
      type: 'playback',
      action: 'next',
      chunks: [],
      analysisType: null,
      message: 'Going to next section'
    };
  }

  if (lowerCommand.includes('previous') || lowerCommand.includes('back')) {
    return {
      success: true,
      type: 'playback',
      action: 'previous',
      chunks: [],
      analysisType: null,
      message: 'Going to previous section'
    };
  }

  // Speed commands
  if (lowerCommand.includes('faster') || lowerCommand.includes('speed up')) {
    return {
      success: true,
      type: 'playback',
      action: 'speed',
      chunks: [],
      analysisType: null,
      speedChange: 'faster',
      message: 'Increasing playback speed'
    };
  }

  if (lowerCommand.includes('slower') || lowerCommand.includes('slow down')) {
    return {
      success: true,
      type: 'playback',
      action: 'speed',
      chunks: [],
      analysisType: null,
      speedChange: 'slower',
      message: 'Decreasing playback speed'
    };
  }

  // Selection commands
  const singleMatch = lowerCommand.match(/(?:select|choose|pick|go to).*?(?:part|section|chunk|paragraph)\s*(\d+)/i);
  if (singleMatch) {
    const index = parseInt(singleMatch[1]) - 1;
    if (index >= 0 && index < totalChunks) {
      return {
        success: true,
        type: 'single',
        action: 'select',
        chunks: [index],
        analysisType: null,
        message: `Selected part ${index + 1}`
      };
    }
  }

  // Range selection
  const rangeMatch = lowerCommand.match(/(?:select|choose).*?(?:from\s+)?(?:part|section|chunk)\s*(\d+)\s*(?:to|through)\s*(\d+)/i);
  if (rangeMatch) {
    const start = parseInt(rangeMatch[1]) - 1;
    const end = parseInt(rangeMatch[2]) - 1;
    if (start >= 0 && end < totalChunks && start <= end) {
      const chunks = Array.from({ length: end - start + 1 }, (_, i) => start + i);
      return {
        success: true,
        type: 'range',
        action: 'select',
        chunks: chunks,
        analysisType: null,
        message: `Selected parts ${start + 1} to ${end + 1}`
      };
    }
  }

  // Analysis commands
  const analyzeMatch = lowerCommand.match(/(summarize|analyze|review).*?(?:part|section|chunk)\s*(\d+)/i);
  if (analyzeMatch) {
    const index = parseInt(analyzeMatch[2]) - 1;
    const analysisType = analyzeMatch[1].toLowerCase() === 'summarize' ? 'summary' : 'analysis';
    if (index >= 0 && index < totalChunks) {
      return {
        success: true,
        type: 'analysis',
        action: analysisType === 'summary' ? 'summarize' : 'analyze',
        chunks: [index],
        analysisType: analysisType,
        message: `Will ${analysisType === 'summary' ? 'summarize' : 'analyze'} part ${index + 1}`
      };
    }
  }

  // Clear commands
  if (lowerCommand.includes('clear') || lowerCommand.includes('reset')) {
    return {
      success: true,
      type: 'clear',
      action: 'clear',
      chunks: [],
      analysisType: null,
      message: 'Cleared selection'
    };
  }

  // Unknown command
  return {
    success: false,
    type: 'unknown',
    action: '',
    chunks: [],
    analysisType: null,
    message: '',
    error: 'Command not recognized. Try saying "select part 2", "play", "pause", or "summarize section 3"'
  };
};

module.exports = {
  transcribeAudioWithWhisper,
  processVoiceCommandWithAI,
  parseCommandFallback
};
