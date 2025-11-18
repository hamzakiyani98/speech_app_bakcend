const express = require('express');
const mysql = require('mysql2/promise');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const cors = require('cors');
const multer = require('multer');
const pdf = require('pdf-parse');
const mammoth = require('mammoth');
const os = require('os');
const OpenAI = require('openai');
const Tesseract = require('tesseract.js');
const sharp = require('sharp');
const path = require('path');
const fs = require('fs-extra');
require('dotenv').config();
const cheerio = require('cheerio');
const axios = require('axios');
const UserAgent = require('user-agents');
const admin = require('firebase-admin');
const cron = require('node-cron');
const { TextToSpeechClient } = require('@google-cloud/text-to-speech');
const nodemailer = require('nodemailer');

// Add these new dependencies at the top of server.js
const ffmpeg = require('fluent-ffmpeg'); // Add this for audio conversion

// Create Express app
const app = express();
app.use(express.json());

// Initialize OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// CORS configuration
app.use(cors({
  origin: true,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
}));

// Body parsing middleware
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Request logging
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
  next();
});



// Database configuration
const db = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'document_play_app',
  connectionLimit: 10,
  waitForConnections: true,
  queueLimit: 0
});

// Test database connection
async function testDatabase() {
  try {
    const connection = await db.getConnection();
    console.log('✅ Database connected');
    connection.release();
    return true;
  } catch (error) {
    console.error('❌ Database error:', error.message);
    return false;
  }
}

// JWT configuration
const JWT_SECRET = process.env.JWT_SECRET || 'your_jwt_secret_change_in_production';

const emailTransporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_APP_PASSWORD
  }
});

// Test email configuration on startup
emailTransporter.verify((error, success) => {
  if (error) {
    console.error('❌ Email configuration error:', error);
  } else {
    console.log('✅ Email service ready to send messages');
  }
});

const generateOTP = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

// Send OTP email
const sendOTPEmail = async (email, otp, type = 'signup') => {
  try {
    const subject = type === 'signup' 
      ? 'Verify Your Email - OTP Code'
      : 'Login Verification - OTP Code';
    
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: linear-gradient(135deg, #4664D5 0%, #5a7de8 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
          .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
          .otp-box { background: white; border: 2px dashed #4664D5; border-radius: 8px; padding: 20px; text-align: center; margin: 20px 0; }
          .otp-code { font-size: 32px; font-weight: bold; color: #4664D5; letter-spacing: 5px; }
          .footer { text-align: center; margin-top: 20px; font-size: 12px; color: #666; }
          .warning { background: #fff3cd; border-left: 4px solid #ffc107; padding: 12px; margin: 20px 0; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>Email Verification</h1>
          </div>
          <div class="content">
            <h2>Hello!</h2>
            <p>We received a request to ${type === 'signup' ? 'create an account' : 'log in to your account'}. Please use the following OTP code to verify your email address:</p>
            
            <div class="otp-box">
              <p style="margin: 0; font-size: 14px; color: #666;">Your OTP Code</p>
              <div class="otp-code">${otp}</div>
              <p style="margin: 10px 0 0 0; font-size: 12px; color: #999;">Valid for 15 minutes</p>
            </div>
            
            <div class="warning">
              <strong>⚠️ Security Notice:</strong> Never share this code with anyone. Our team will never ask for your OTP code.
            </div>
            
            <p>If you didn't request this code, please ignore this email or contact support if you have concerns.</p>
            
            <p>Best regards,<br>Your App Team</p>
          </div>
          <div class="footer">
            <p>This is an automated message, please do not reply to this email.</p>
            <p>&copy; ${new Date().getFullYear()} Your App. All rights reserved.</p>
          </div>
        </div>
      </body>
      </html>
    `;

    const mailOptions = {
      from: `"Your App" <${process.env.GMAIL_USER}>`,
      to: email,
      subject: subject,
      html: html
    };

    const info = await emailTransporter.sendMail(mailOptions);
    console.log('✅ OTP email sent:', info.messageId);
    return { success: true, messageId: info.messageId };
    
  } catch (error) {
    console.error('❌ Email sending error:', error);
    return { success: false, error: error.message };
  }
};

// Auth middleware
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid token' });
    }
    req.user = user;
    next();
  });
};

// Multer configuration
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    const allowedTypes = [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'text/plain',
      'image/jpeg',
      'image/png',
      'image/gif',
      'audio/mp4',
      'audio/mpeg',
      'audio/wav',
      'audio/m4a',
      'audio/webm',
      'audio/ogg',
      'audio/3gpp',
      'audio/amr',
      'audio/aac',
      'video/mp4', // Sometimes mobile sends as video/mp4
    ];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type'));
    }
  }
});

// Multer configuration for advertisement images
const uploadAdImage = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only JPEG, PNG, GIF, and WebP are allowed.'));
    }
  }
});


// Check if service account file exists
const serviceAccountPath = path.join(__dirname, 'service-account-key.json');
const ADS_IMAGES_DIR = path.join(__dirname, 'public', 'ads-images');

const ensureAdsImagesDir = async () => {
  try {
    await fs.ensureDir(ADS_IMAGES_DIR);
    console.log('✅ Ads images directory ready:', ADS_IMAGES_DIR);
  } catch (error) {
    console.error('❌ Failed to create ads images directory:', error);
  }
};

// Add this with your other static file serving
app.use('/ads-images', express.static(path.join(__dirname, 'public', 'ads-images')));

console.log('🔍 Checking service account file at:', serviceAccountPath);

if (!fs.existsSync(serviceAccountPath)) {
  console.error('❌ Service account key file not found at:', serviceAccountPath);
  console.error('📋 Please ensure your service-account-key.json file is in the root directory');
  process.exit(1);
}

// Initialize Google TTS client with explicit credentials
let ttsClient;
try {
  ttsClient = new TextToSpeechClient({
    keyFilename: serviceAccountPath,
    projectId: 'custom-point-463612-v5', // Your project ID
  });
  console.log('✅ Google TTS Client initialized successfully');
} catch (error) {
  console.error('❌ Failed to initialize Google TTS Client:', error);
  process.exit(1);
}

// Test endpoint
app.get('/api/tts/test', (req, res) => {
  res.json({
    success: true,
    message: 'TTS Backend is running',
    timestamp: new Date().toISOString(),
    projectId: 'custom-point-463612-v5'
  });
});

app.post('/api/tts/synthesize', async (req, res) => {
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
});



function getGenderFromVoice(voiceName) {
  console.log('🔍 BACKEND DEBUG - Determining gender for voice:', voiceName);

  // Extract the voice type (last part after last dash)
  const parts = voiceName.split('-');
  const voiceType = parts[parts.length - 1]; // Gets 'A', 'F', 'J', etc.

  console.log('🔍 BACKEND DEBUG - Voice parts:', parts);
  console.log('🔍 BACKEND DEBUG - Voice type extracted:', voiceType);

  // Google Neural2 voice gender mapping
  const maleVoices = ['A', 'D', 'I', 'J'];
  const femaleVoices = ['C', 'F', 'G', 'H'];

  let gender = 'NEUTRAL';

  if (maleVoices.includes(voiceType)) {
    gender = 'MALE';
    console.log('✅ BACKEND DEBUG - Voice identified as MALE:', voiceType);
  } else if (femaleVoices.includes(voiceType)) {
    gender = 'FEMALE';
    console.log('✅ BACKEND DEBUG - Voice identified as FEMALE:', voiceType);
  } else {
    console.warn('⚠️ BACKEND DEBUG - Unknown voice type, defaulting to NEUTRAL:', voiceType);
  }

  return gender;
}
// Get available voices endpoint
app.get('/api/tts/voices', async (req, res) => {
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
});

// File extraction functions
const extractTextFromPDF = async (buffer) => {
  try {
    const data = await pdf(buffer);
    const pageContent = data.text.split('\n\n').filter(page => page.trim().length > 0);
    return {
      text: data.text,
      pages: data.numpages,
      pageContent: pageContent
    };
  } catch (error) {
    throw new Error('PDF extraction failed: ' + error.message);
  }
};

const extractTextFromDOCX = async (buffer) => {
  try {
    const result = await mammoth.extractRawText({ buffer });
    const text = result.value;
    const pageContent = text.split('\n\n').filter(page => page.trim().length > 0);
    return {
      text: text,
      pages: pageContent.length,
      pageContent: pageContent
    };
  } catch (error) {
    throw new Error('DOCX extraction failed: ' + error.message);
  }
};

const extractTextFromTXT = async (buffer) => {
  try {
    const text = buffer.toString('utf-8');
    const pageContent = text.split('\n\n').filter(page => page.trim().length > 0);
    return {
      text: text,
      pages: pageContent.length,
      pageContent: pageContent
    };
  } catch (error) {
    throw new Error('TXT extraction failed: ' + error.message);
  }
};

const extractFileContent = async (file) => {
  const { buffer, mimetype } = file;

  switch (mimetype) {
    case 'application/pdf':
      return await extractTextFromPDF(buffer);
    case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
    case 'application/msword':
      return await extractTextFromDOCX(buffer);
    case 'text/plain':
      return await extractTextFromTXT(buffer);
    default:
      throw new Error('Unsupported file type');
  }
};

// Enhanced image preprocessing for better OCR results
const preprocessImage = async (buffer) => {
  try {
    console.log('📸 Preprocessing image for OCR...');

    // Validate buffer
    if (!buffer || buffer.length === 0) {
      throw new Error('Invalid image buffer');
    }

    // Get image metadata
    const metadata = await sharp(buffer).metadata();
    console.log('Image metadata:', {
      width: metadata.width,
      height: metadata.height,
      format: metadata.format,
      size: Math.round(buffer.length / 1024) + 'KB'
    });

    // Process image for better OCR results
    const processedBuffer = await sharp(buffer)
      .resize({
        width: Math.min(metadata.width || 2000, 2000),
        height: Math.min(metadata.height || 2000, 2000),
        fit: 'inside',
        withoutEnlargement: true
      })
      .grayscale()
      .normalize()
      .sharpen()
      .jpeg({ quality: 95 })
      .toBuffer();

    console.log('✅ Image preprocessed successfully');
    return processedBuffer;

  } catch (error) {
    console.error('❌ Image preprocessing error:', error);
    throw new Error('Failed to preprocess image: ' + error.message);
  }
};

// Enhanced OCR function with better text extraction
const performOCR = async (imageBuffer, options = {}) => {
  try {
    console.log('🔍 Starting OCR process...');

    // Validate input
    if (!imageBuffer || imageBuffer.length === 0) {
      throw new Error('Invalid image buffer provided');
    }

    const startTime = Date.now();

    // Preprocess image for better OCR results
    const processedBuffer = await preprocessImage(imageBuffer);

    // OCR configuration for better accuracy
    const ocrOptions = {
      lang: options.language || 'eng',
      logger: m => {
        if (m.status === 'recognizing text') {
          console.log(`OCR Progress: ${Math.round(m.progress * 100)}%`);
        }
      }
    };

    console.log(`Starting Tesseract OCR with language: ${ocrOptions.lang}`);

    // Perform OCR with proper error handling
    let ocrResult;
    try {
      ocrResult = await Tesseract.recognize(processedBuffer, ocrOptions.lang, {
        logger: ocrOptions.logger,
      });
    } catch (tesseractError) {
      console.error('Tesseract OCR error:', tesseractError);
      throw new Error('OCR engine failed: ' + tesseractError.message);
    }

    const processingTime = Date.now() - startTime;

    // Extract and clean text
    const extractedText = ocrResult.data.text ? ocrResult.data.text.trim() : '';

    if (!extractedText) {
      console.warn('⚠️ No text extracted from image');
    }

    // Get confidence score
    const confidence = ocrResult.data.confidence || 0;

    // Extract additional data
    const words = ocrResult.data.words || [];
    const lines = ocrResult.data.lines || [];
    const paragraphs = ocrResult.data.paragraphs || [];

    // Process text into readable format
    const processedText = cleanExtractedText(extractedText);
    const pageContent = processTextIntoPages(processedText);

    console.log('✅ OCR completed successfully:', {
      processingTime: processingTime + 'ms',
      confidence: Math.round(confidence) + '%',
      textLength: processedText.length,
      wordsFound: words.length,
      linesFound: lines.length
    });

    return {
      text: processedText,
      pageContent: pageContent,
      totalPages: pageContent.length,
      confidence: confidence,
      metadata: {
        processingTime,
        wordsFound: words.length,
        linesFound: lines.length,
        paragraphsFound: paragraphs.length,
        ocrEngine: 'Tesseract.js',
        language: ocrOptions.lang
      },
      rawData: {
        words: words.map(word => ({
          text: word.text,
          confidence: word.confidence,
          bbox: word.bbox
        })),
        lines: lines.map(line => ({
          text: line.text,
          confidence: line.confidence,
          bbox: line.bbox
        }))
      }
    };

  } catch (error) {
    console.error('❌ OCR processing error:', error);
    throw new Error('OCR processing failed: ' + error.message);
  }
};


// Clean and format extracted text
const cleanExtractedText = (text) => {
  if (!text) return '';

  return text
    .replace(/\s+/g, ' ')
    .replace(/\n\s*\n\s*\n/g, '\n\n')
    .replace(/[|]/g, 'I')
    .replace(/(\w)([A-Z])/g, '$1 $2')
    .replace(/\s+([.,!?;:])/g, '$1')
    .replace(/([.,!?;:])\s*/g, '$1 ')
    .trim();
};

// Process text into logical pages/sections
const processTextIntoPages = (text) => {
  if (!text) return [''];

  const paragraphs = text.split('\n\n').filter(p => p.trim().length > 0);

  if (paragraphs.length === 0) {
    return [text];
  }

  const pages = [];
  let currentPage = '';
  let currentWordCount = 0;

  for (const paragraph of paragraphs) {
    const paragraphWords = paragraph.split(' ').length;

    if (currentWordCount + paragraphWords > 500 && currentPage.length > 0) {
      pages.push(currentPage.trim());
      currentPage = paragraph;
      currentWordCount = paragraphWords;
    } else {
      currentPage += (currentPage ? '\n\n' : '') + paragraph;
      currentWordCount += paragraphWords;
    }
  }

  if (currentPage.trim().length > 0) {
    pages.push(currentPage.trim());
  }

  return pages.length > 0 ? pages : [text];
};

// OpenAI Helper Functions
const callOpenAI = async (prompt, systemMessage = null, maxTokens = 1000) => {
  try {
    const messages = [];

    if (systemMessage) {
      messages.push({ role: 'system', content: systemMessage });
    }

    messages.push({ role: 'user', content: prompt });

    const response = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: messages,
      max_tokens: maxTokens,
      temperature: 0.7,
    });

    return response.choices[0].message.content.trim();
  } catch (error) {
    console.error('OpenAI API Error:', error);
    throw new Error('AI processing failed: ' + error.message);
  }
};

// AI Processing Functions
const summarizeText = async (text, selectedText = null) => {
  const textToSummarize = selectedText || text;
  const systemMessage = "You are a helpful assistant that creates concise, accurate summaries. Focus on the main points and key information.";

  const prompt = `Please provide a comprehensive summary of the following text. Include the main points, key insights, and important details:

${textToSummarize}

Summary:`;

  return await callOpenAI(prompt, systemMessage, 500);
};

const extractActionPoints = async (text, selectedText = null) => {
  const textToAnalyze = selectedText || text;
  const systemMessage = "You are a business analyst that extracts actionable items and tasks from documents. Focus on specific, measurable actions.";

  const prompt = `Analyze the following text and extract specific action points, tasks, and next steps. Format them as a numbered list:

${textToAnalyze}

Action Points:`;

  return await callOpenAI(prompt, systemMessage, 600);
};

const getDecisionSupport = async (text, selectedText = null, context = '') => {
  const textToAnalyze = selectedText || text;
  const systemMessage = "You are a strategic advisor that helps with decision-making by analyzing information and providing insights.";

  const prompt = `Based on the following document content, provide decision support and recommendations. Consider the context: ${context}

Document content:
${textToAnalyze}

Please provide:
1. Key considerations
2. Potential risks and opportunities
3. Recommended actions
4. Alternative approaches

Decision Support:`;

  return await callOpenAI(prompt, systemMessage, 800);
};

const translateText = async (text, targetLanguage, selectedText = null) => {
  const textToTranslate = selectedText || text;
  const systemMessage = `You are a professional translator. Translate the following text to ${targetLanguage} while maintaining the original meaning and context.`;

  const prompt = `Translate the following text to ${targetLanguage}:

${textToTranslate}

Translation:`;

  return await callOpenAI(prompt, systemMessage, Math.min(textToTranslate.length * 2, 2000));
};

// Network interface helper
function getNetworkInterfaces() {
  const interfaces = os.networkInterfaces();
  const addresses = [];

  for (const name of Object.keys(interfaces)) {
    for (const interface of interfaces[name]) {
      if (interface.family === 'IPv4' && !interface.internal) {
        addresses.push({
          name: name,
          address: interface.address
        });
      }
    }
  }
  return addresses;
}

// Get image dimensions
const getImageDimensions = async (buffer) => {
  try {
    const metadata = await sharp(buffer).metadata();
    return {
      width: metadata.width,
      height: metadata.height,
      format: metadata.format
    };
  } catch (error) {
    console.error('Error getting image dimensions:', error);
    return null;
  }
};

// ==================== ROUTES ====================

// Test endpoint
app.get('/api/test', (req, res) => {
  res.json({
    message: 'Server is running successfully!',
    timestamp: new Date().toISOString(),
    status: 'healthy',
    openai: !!process.env.OPENAI_API_KEY ? 'configured' : 'not configured',
    ocr: 'tesseract.js configured'
  });
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'healthy',
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
});

app.post('/api/signup', async (req, res) => {
  const { username, email, password } = req.body;

  try {
    const [existingUser] = await db.query('SELECT * FROM users WHERE email = ?', [email]);
    if (existingUser.length > 0) {
      return res.status(400).json({ error: 'Email already exists' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    
    // Calculate 3-day trial end date
    const trialEndDate = new Date();
    trialEndDate.setDate(trialEndDate.getDate() + 3);

    const [result] = await db.query(
      `INSERT INTO users (username, email, password, is_trial, trial_end_date, subscription_status) 
       VALUES (?, ?, ?, TRUE, ?, 'trial')`,
      [username, email, hashedPassword, trialEndDate]
    );

    // Create notification for trial start
    await createNotification(
      result.insertId,
      'Welcome to Your 3-Day Trial!',
      'Enjoy full access to all premium features for 3 days. Upgrade anytime to continue.',
      'trial_started',
      { trial_days: 3, trial_end: trialEndDate.toISOString() }
    );

    console.log('✅ User registered with 3-day trial:', email);

    res.json({
      success: true,
      message: 'Account created successfully with 3-day trial',
      user: {
        id: result.insertId,
        username,
        email,
        is_trial: true,
        trial_end_date: trialEndDate
      }
    });

  } catch (error) {
    console.error('❌ Signup error:', error);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// Login
app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;

  try {
    const [users] = await db.query('SELECT * FROM users WHERE email = ?', [email]);
    if (users.length === 0) {
      return res.status(400).json({ error: 'Invalid credentials' });
    }

    const user = users[0];
    const isValidPassword = await bcrypt.compare(password, user.password);
    if (!isValidPassword) {
      return res.status(400).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign(
      { id: user.id, email: user.email, username: user.username, role: user.role || 'user' },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    console.log('✅ Login successful:', email);
    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        role: user.role || 'user',
        status: user.status || 'active',
        created_at: user.created_at,
        last_login: user.last_login
      }
    });
  } catch (error) {
    console.error('❌ Login error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

const checkFeatureAccess = async (req, res, next) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'User not authenticated' });
    }

    // Get user subscription plan
    const [users] = await db.query(
      'SELECT subscription_plan, is_trial, trial_end_date FROM users WHERE id = ?',
      [userId]
    );

    if (users.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = users[0];
    
    // ✅ FIX: Normalize plan to base type for limits lookup
    let planType = 'free';
    
    if (user.is_trial && user.trial_end_date && new Date(user.trial_end_date) > new Date()) {
      planType = 'trial';
    } else if (user.subscription_plan && user.subscription_plan !== 'free') {
      // ✅ Extract base plan from variants like "premium-yearly"
      planType = user.subscription_plan.includes('premium') ? 'premium' : 'free';
    }

    console.log('🔍 Feature access check:', {
      userId,
      rawPlan: user.subscription_plan,
      normalizedPlanType: planType
    });

    // Attach to request for use in route
    req.user.planType = planType;
    req.user.subscription_plan = user.subscription_plan;
    req.user.is_trial = user.is_trial;
    req.user.trial_end_date = user.trial_end_date;

    next();
  } catch (error) {
    console.error('Feature access check error:', error);
    res.status(500).json({ error: 'Failed to verify access' });
  }
};

app.post(
  '/api/documents',
  authenticateToken,
  checkFeatureAccess,
  upload.single('file'),
  async (req, res) => {
    console.log('📤 Document upload request');

    const { title, description, category, documentType, capturedImageData, ocrLanguage } = req.body;

    try {
      // ========== QUOTA CHECKS ==========
      const userId = req.user.id;

      // Check OCR quota for camera uploads
      if (documentType === 'camera') {
        if (req.user.planType === 'free') {
          return res.status(403).json({
            success: false,
            error: 'OCR feature is not available in the free plan',
            code: 'OCR_NOT_AVAILABLE',
            plan: 'free',
            message: 'Upgrade to Premium to use OCR feature'
          });
        }

        const quotaCheck = await checkOCRQuota(userId, req.user.planType);
        if (!quotaCheck.canProcess) {
          return res.status(429).json({
            success: false,
            error: 'OCR quota exceeded',
            code: 'QUOTA_EXCEEDED',
            used: quotaCheck.used,
            limit: quotaCheck.limit,
            remaining: quotaCheck.remaining
          });
        }
      }

      // Check document storage limits for free users
      if (req.user.planType === 'free') {
        const [docCount] = await db.query(
          'SELECT COUNT(*) as count FROM documents WHERE user_id = ?',
          [userId]
        );

        const MAX_FREE_DOCUMENTS = 5;
        if (docCount[0].count >= MAX_FREE_DOCUMENTS) {
          return res.status(403).json({
            success: false,
            error: 'Free users can only have 5 documents',
            code: 'STORAGE_LIMIT_EXCEEDED',
            current: docCount[0].count,
            limit: MAX_FREE_DOCUMENTS
          });
        }
      }

      // ========== DOCUMENT PROCESSING ==========
      let content = '';
      let pageContent = [];
      let totalPages = 0;
      let fileType = documentType || 'text';
      let ocrConfidence = null;
      let ocrMetadata = null;
      let imageData = null;
      let processingStatus = 'completed';

      // Handle camera upload with OCR
      if (documentType === 'camera' && (req.file || capturedImageData)) {
        console.log('📸 Processing camera upload with OCR...');
        processingStatus = 'processing';

        let imageBuffer;

        if (req.file) {
          imageBuffer = req.file.buffer;
          console.log('Using uploaded file for OCR, size:', imageBuffer.length);
        } else if (capturedImageData) {
          try {
            const base64Data = capturedImageData.replace(/^data:image\/[a-z]+;base64,/, '');
            imageBuffer = Buffer.from(base64Data, 'base64');
            console.log('Using captured image data for OCR, size:', imageBuffer.length);
          } catch (base64Error) {
            console.error('Base64 decode error:', base64Error);
            return res.status(400).json({ error: 'Invalid image data format' });
          }
        }

        if (!imageBuffer || imageBuffer.length === 0) {
          return res.status(400).json({ error: 'No valid image data provided for camera upload' });
        }

        try {
          // ✅ FIX: Determine OCR engine based on user's plan
          const ocrEngine = await getOCREngine(userId);
          console.log(`🔍 Using OCR engine: ${ocrEngine} for user ${userId}`);
          
          let ocrResult;
          
          if (ocrEngine === 'google') {
            // Premium users get Google Cloud Vision OCR
            console.log('📸 Processing with Google Cloud Vision OCR...');
            ocrResult = await performGoogleOCR(imageBuffer, {
              language: ocrLanguage || 'eng'
            });
          } else {
            // Free/Trial users get Tesseract OCR
            console.log('📸 Processing with Tesseract OCR...');
            ocrResult = await performOCR(imageBuffer, {
              language: ocrLanguage || 'eng'
            });
          }

          content = ocrResult.text;
          pageContent = ocrResult.pageContent;
          totalPages = ocrResult.totalPages || ocrResult.pages;
          ocrConfidence = ocrResult.confidence;
          ocrMetadata = ocrResult.metadata;
          fileType = 'image_ocr';
          processingStatus = 'completed';

          imageData = {
            originalSize: imageBuffer.length,
            processedAt: new Date().toISOString(),
            dimensions: await getImageDimensions(imageBuffer),
            ocrEngine: ocrEngine
          };

          console.log(`✅ OCR completed: ${content.length} characters extracted with ${Math.round(ocrConfidence)}% confidence using ${ocrEngine}`);

        } catch (ocrError) {
          console.error('❌ OCR processing failed:', ocrError);
          processingStatus = 'failed';
          content = `OCR processing failed: ${ocrError.message}. Please try again with a clearer image.`;
          pageContent = [content];
          totalPages = 1;
          ocrConfidence = 0;

          imageData = {
            originalSize: imageBuffer.length,
            processedAt: new Date().toISOString(),
            error: ocrError.message
          };
        }
      }
      // Handle file upload
      else if (req.file) {
        console.log('📎 Processing file:', req.file.originalname);
        const extractedData = await extractFileContent(req.file);
        content = extractedData.text;
        pageContent = extractedData.pageContent;
        totalPages = extractedData.pages;
        fileType = req.file.mimetype.split('/')[1];
        console.log(`✅ Extracted ${content.length} characters`);
      }
      // Handle text input
      else if (documentType === 'text' || documentType === 'voice') {
        content = req.body.content || '';
        pageContent = content.split('\n\n').filter(page => page.trim().length > 0);
        totalPages = pageContent.length;
        console.log(`📝 Processing text: ${content.length} characters`);
      }
      // Handle URL content
      else if (documentType === 'url') {
        content = req.body.content || '';
        pageContent = content.split('\n\n').filter(page => page.trim().length > 0);
        totalPages = pageContent.length;
        fileType = 'url';
        console.log(`🌐 Processing URL content: ${content.length} characters`);
      }

      if (!content.trim() && processingStatus !== 'failed') {
        return res.status(400).json({ error: 'No content found' });
      }

      // ========== SAVE TO DATABASE ==========
      const [result] = await db.query(
        `INSERT INTO documents (
          user_id, title, description, content, page_content, total_pages, 
          file_type, category, file_size, ocr_confidence, ocr_metadata, 
          image_data, processing_status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          userId,
          title,
          description || '',
          content,
          JSON.stringify(pageContent),
          totalPages,
          fileType,
          category || 'uncategorized',
          req.file ? req.file.size : content.length,
          ocrConfidence,
          ocrMetadata ? JSON.stringify(ocrMetadata) : null,
          imageData ? JSON.stringify(imageData) : null,
          processingStatus
        ]
      );

      console.log('✅ Document saved with ID:', result.insertId);

      // Track OCR usage for camera uploads
      if (documentType === 'camera' && processingStatus === 'completed') {
        const today = new Date().toISOString().split('T')[0];
        await db.query(
          `INSERT INTO user_usage (user_id, date, ocrPagesUsed) 
           VALUES (?, ?, 1)
           ON DUPLICATE KEY UPDATE ocrPagesUsed = ocrPagesUsed + 1`,
          [userId, today]
        );
      }

      // Send document upload notification
      if (processingStatus === 'completed') {
        await sendDocumentUploadNotification(userId, title, result.insertId, processingStatus);
      }

      // For OCR documents, send OCR completion notification
      if (documentType === 'camera' && processingStatus === 'completed' && ocrConfidence) {
        await sendOCRCompletionNotification(userId, title, ocrConfidence, result.insertId);
      }

      // Track activity
      await trackActivity(userId, 'document_uploaded', 'document', result.insertId, {
        documentType: documentType,
        hasOCR: documentType === 'camera',
        ocrEngine: imageData?.ocrEngine || 'none',
        processingStatus: processingStatus
      });

      // ========== RESPONSE ==========
      const responseData = {
        success: true,
        id: result.insertId,
        title,
        description,
        content,
        pageContent,
        totalPages,
        fileType,
        category,
        processingStatus,
        message: 'Document uploaded successfully'
      };

      if (documentType === 'camera') {
        responseData.ocrConfidence = ocrConfidence;
        responseData.ocrMetadata = ocrMetadata;
        responseData.extractedText = content;
        responseData.imageData = imageData;
        responseData.ocrEngine = imageData?.ocrEngine || 'unknown';
      }

      res.status(201).json(responseData);

    } catch (error) {
      console.error('❌ Upload error:', error);
      res.status(500).json({
        success: false,
        error: 'Upload failed: ' + error.message
      });
    }
  }
);


const getBasePlanType = (subscriptionPlan) => {
  if (!subscriptionPlan || subscriptionPlan === 'free') return 'free';
  
  // Extract base plan from formats like "premium-monthly", "premium-yearly"
  if (subscriptionPlan.includes('premium')) return 'premium';
  if (subscriptionPlan.includes('trial')) return 'trial';
  
  return 'free'; // Safe fallback
};



const getOCREngine = async (userId) => {
  try {
    const [users] = await db.query(
      'SELECT subscription_plan, is_trial, trial_end_date FROM users WHERE id = ?',
      [userId]
    );

    if (users.length === 0) {
      console.warn('User not found, defaulting to tesseract');
      return 'tesseract';
    }

    const user = users[0];
    let planType = 'free';

    // Determine user's plan
    if (user.is_trial && user.trial_end_date && new Date(user.trial_end_date) > new Date()) {
      planType = 'trial';
      console.log(`User ${userId} is on trial plan`);
    } else if (user.subscription_plan && user.subscription_plan !== 'free') {
      planType = getBasePlanType(user.subscription_plan);
      console.log(`User ${userId} is on ${planType} plan: ${user.subscription_plan}`);
    } else {
      console.log(`User ${userId} is on free plan`);
    }

    // Premium users use Google Cloud Vision (high accuracy, counted toward quota)
    // Free & Trial users use Tesseract.js (free, local)
    const engine = planType === 'premium' ? 'google' : 'tesseract';
    console.log(`Selected OCR engine for user ${userId}: ${engine}`);
    return engine;

  } catch (error) {
    console.error('Error determining OCR engine:', error);
    return 'tesseract'; // Safe fallback
  }
};

async function checkOCRQuota(userId, userPlan) {
  try {
    // Normalize the plan type to base plan
    const basePlan = getBasePlanType(userPlan);
    const today = new Date().toISOString().split('T')[0];

    console.log('Checking OCR quota:', {
      userId,
      providedPlan: userPlan,
      basePlan: basePlan,
      today
    });

    // Get the daily limit from feature_limits table using base plan type
    const [limitData] = await db.query(
      `SELECT daily_limit, monthly_limit, is_unlimited 
       FROM feature_limits 
       WHERE plan_type = ? AND feature_key = 'ocr_pages'`,
      [basePlan]
    );

    if (!limitData || limitData.length === 0) {
      console.error('❌ No feature limits found for plan:', basePlan);
      return {
        canProcess: false,
        used: 0,
        limit: 0,
        remaining: 0,
        engine: 'tesseract',
        error: 'Plan not found in feature limits'
      };
    }

    const limit = limitData[0];
    const dailyLimit = limit.is_unlimited ? 999999 : limit.daily_limit;
    const monthlyLimit = limit.is_unlimited ? 999999 : (limit.monthly_limit || 0);

    console.log('Feature limits retrieved:', {
      dailyLimit,
      monthlyLimit,
      isUnlimited: limit.is_unlimited
    });

    // Get today's usage from user_usage table
    const [usageData] = await db.query(
      `SELECT COALESCE(ocrPagesUsed, 0) as ocrPagesUsed 
       FROM user_usage 
       WHERE user_id = ? AND date = ?`,
      [userId, today]
    );

    const dailyUsage = usageData && usageData.length > 0 ? usageData[0].ocrPagesUsed : 0;

    // Get this month's usage
    const currentMonth = new Date().toISOString().slice(0, 7); // YYYY-MM
    const [monthUsageData] = await db.query(`
      SELECT COALESCE(SUM(ocrPagesUsed), 0) as totalUsed 
      FROM user_usage 
      WHERE user_id = ? AND DATE_FORMAT(date, '%Y-%m') = ?
    `, [userId, currentMonth]);

    const monthlyUsage = monthUsageData && monthUsageData.length > 0 ? monthUsageData[0].totalUsed : 0;

    // Determine OCR engine based on plan
    let engine = 'tesseract'; // default
    if (basePlan === 'premium') {
      engine = 'google';
    } else if (basePlan === 'trial') {
      engine = 'tesseract';
    }

    const canProcess = dailyUsage < dailyLimit;
    const remaining = Math.max(0, dailyLimit - dailyUsage);

    console.log('OCR Quota Check:', {
      userId,
      plan: basePlan,
      today,
      dailyUsage,
      dailyLimit,
      monthlyUsage,
      monthlyLimit,
      remaining,
      canProcess,
      engine
    });

    return {
      canProcess: canProcess,
      used: dailyUsage,
      limit: dailyLimit,
      remaining: remaining,
      monthlyUsed: monthlyUsage,
      monthlyLimit: monthlyLimit,
      engine: engine,
      planType: basePlan,
      resetType: 'daily',
      nextReset: new Date(new Date(today).getTime() + 24 * 60 * 60 * 1000)
    };

  } catch (error) {
    console.error('❌ OCR quota check error:', error);
    return {
      canProcess: false,
      used: 0,
      limit: 0,
      remaining: 0,
      error: error.message
    };
  }
}

async function processOCRWithTesseract(filePath, language = 'eng') {
  try {
    if (!filePath) {
      throw new Error('File path required for Tesseract OCR');
    }

    console.log('🔍 Processing with Tesseract:', { filePath, language });

    const { createWorker } = require('tesseract.js');
    const worker = await createWorker(language);

    const result = await worker.recognize(filePath);
    await worker.terminate();

    const text = result.data.text || '';
    const confidence = result.data.confidence || 0;

    console.log('✅ Tesseract OCR complete:', { textLength: text.length, confidence });

    return {
      success: true,
      text: text,
      confidence: confidence,
      engine: 'tesseract'
    };
  } catch (error) {
    console.error('❌ Tesseract OCR error:', error.message);
    return {
      success: false,
      error: error.message,
      engine: 'tesseract'
    };
  }
}

// Process OCR with Google Vision (premium)
async function processOCRWithGoogleVision(filePath, language = 'eng') {
  try {
    if (!filePath) {
      throw new Error('File path required for Google Vision OCR');
    }

    console.log('🔍 Processing with Google Vision:', { filePath, language });

    const vision = require('@google-cloud/vision');
    const client = new vision.ImageAnnotatorClient({
      keyFilename: process.env.GOOGLE_VISION_KEY_FILE
    });

    const request = {
      image: { source: { imageUri: `file://${filePath}` } },
      features: [
        { type: 'TEXT_DETECTION' },
        { type: 'DOCUMENT_TEXT_DETECTION' }
      ],
      imageContext: {
        languageHints: [language]
      }
    };

    const [result] = await client.annotateImage(request);
    const fullTextAnnotation = result.fullTextAnnotation;

    const text = fullTextAnnotation?.text || '';
    const confidence = result.textAnnotations?.[0]?.confidence || 0.8;

    console.log('✅ Google Vision OCR complete:', { textLength: text.length, confidence });

    return {
      success: true,
      text: text,
      confidence: confidence * 100,
      engine: 'google'
    };
  } catch (error) {
    console.error('❌ Google Vision OCR error:', error.message);
    return {
      success: false,
      error: error.message,
      engine: 'google'
    };
  }
}

async function updateUserStats(userId, stats) {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const dailyStats = await DailyStats.findOneAndUpdate(
      { userId: userId, date: today },
      {
        $inc: {
          'stats.documents_uploaded': 1,
          'stats.content_length': stats.contentLength || 0,
          'stats.total_pages': stats.totalPages || 1
        },
        $set: {
          'stats.last_file_type': stats.fileType,
          'stats.ocr_engine': stats.ocrEngine,
          'stats.processing_status': stats.processingStatus
        }
      },
      { upsert: true, new: true }
    );

    console.log('📈 Updated daily stats for user:', userId);
    return dailyStats;
  } catch (error) {
    console.error('❌ Update stats error:', error.message);
    return null;
  }
}


async function getOCRQuotaInfo(userId, userPlan) {
  try {
    const quotaCheck = await checkOCRQuota(userId, userPlan);
    return {
      planType: userPlan,
      used: quotaCheck.used,
      limit: quotaCheck.limit,
      remaining: quotaCheck.remaining,
      canProcess: quotaCheck.canProcess,
      engine: quotaCheck.engine,
      nextReset: quotaCheck.nextReset
    };
  } catch (error) {
    console.error('❌ Get quota info error:', error.message);
    return null;
  }
}



async function checkOCRQuota(userId, userPlan) {
  try {
    const today = new Date().toISOString().split('T')[0];

    // Get the daily limit from feature_limits table
    const [limitData] = await db.query(
      `SELECT daily_limit, monthly_limit, is_unlimited 
       FROM feature_limits 
       WHERE plan_type = ? AND feature_key = 'ocr_pages'`,
      [userPlan || 'free']
    );

    if (!limitData || limitData.length === 0) {
      console.error('❌ No feature limits found for plan:', userPlan);
      return {
        canProcess: false,
        error: 'Plan not found in feature limits'
      };
    }

    const limit = limitData[0];
    let dailyLimit = limit.is_unlimited ? 999999 : limit.daily_limit;

    // Get today's usage from user_usage table
    const [usageData] = await db.query(
      `SELECT ocrPagesUsed FROM user_usage 
       WHERE user_id = ? AND date = ?`,
      [userId, today]
    );

    const dailyUsage = usageData && usageData.length > 0 ? usageData[0].ocrPagesUsed || 0 : 0;

    // Determine OCR engine based on plan
    let engine = 'tesseract'; // default
    if (userPlan === 'premium') {
      engine = 'google';
    } else if (userPlan === 'trial') {
      engine = 'tesseract';
    }

    const canProcess = dailyUsage < dailyLimit;
    const remaining = Math.max(0, dailyLimit - dailyUsage);

    console.log('✅ OCR Quota Check:', {
      userId,
      plan: userPlan,
      today,
      dailyUsage,
      dailyLimit,
      remaining,
      canProcess,
      engine
    });

    return {
      canProcess: canProcess,
      used: dailyUsage,
      limit: dailyLimit,
      remaining: remaining,
      engine: engine,
      planType: userPlan,
      resetType: 'daily',
      nextReset: new Date(new Date(today).getTime() + 24 * 60 * 60 * 1000)
    };

  } catch (error) {
    console.error('❌ OCR quota check error:', error.message);
    return {
      canProcess: false,
      error: error.message
    };
  }
}

async function trackOCRUsage(userId, pages, userPlan) {
  try {
    const today = new Date().toISOString().split('T')[0];

    // Insert or update today's usage
    await db.query(
      `INSERT INTO user_usage (user_id, date, ocrPagesUsed, created_at, updated_at)
       VALUES (?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       ON DUPLICATE KEY UPDATE 
       ocrPagesUsed = ocrPagesUsed + ?,
       updated_at = CURRENT_TIMESTAMP`,
      [userId, today, pages, pages]
    );

    console.log('✅ Tracked OCR usage for user', userId, ':', pages, 'pages on', today);
    return { success: true };

  } catch (error) {
    console.error('❌ Track OCR usage error:', error.message);
    return null;
  }
}

// ==================== GOOGLE CLOUD VISION OCR ====================

const performGoogleOCR = async (imageBuffer, options = {}) => {
  try {
    console.log('Starting Google Cloud Vision OCR...');

    const vision = require('@google-cloud/vision');
    const client = new vision.ImageAnnotatorClient({
      keyFilename: process.env.GOOGLE_VISION_KEY_PATH || path.join(__dirname, 'service-account-key.json')
    });

    const request = {
      image: { content: imageBuffer },
      features: [
        { type: 'DOCUMENT_TEXT_DETECTION' },
      ],
      imageContext: {
        languageHints: [options.language || 'en']
      }
    };

    const [result] = await client.annotateImage(request);
    const textAnnotations = result.textAnnotations;

    if (!textAnnotations || textAnnotations.length === 0) {
      console.warn('No text detected by Google Vision');
      return {
        text: '',
        confidence: 0,
        pages: 1,
        pageContent: [],
        engine: 'google-vision'
      };
    }

    // Extract full text (first annotation contains all detected text)
    const fullText = textAnnotations[0].description || '';
    const processedText = cleanExtractedText(fullText);
    const pageContent = processTextIntoPages(processedText);

    // Google Vision doesn't provide per-document confidence
    // Confidence is estimated based on detection completeness
    const confidence = textAnnotations.length > 0 ? 95 : 0;

    console.log(`Google OCR completed: ${processedText.length} characters, ${pageContent.length} pages, ${confidence}% confidence`);

    return {
      text: processedText,
      confidence: confidence,
      pages: pageContent.length,
      pageContent: pageContent,
      engine: 'google-vision',
      metadata: {
        detectedBlocks: textAnnotations.length,
        language: options.language || 'en'
      }
    };

  } catch (error) {
    console.error('Google Cloud Vision OCR error:', error);
    throw new Error(`Google OCR failed: ${error.message}`);
  }
};



app.get('/api/ocr/quota-info', authenticateToken, async (req, res) => {
  try {
    console.log('Getting OCR quota info for user:', req.user.id);

    // Get user's plan
    const [users] = await db.query(
      'SELECT subscription_plan, is_trial, trial_end_date FROM users WHERE id = ?',
      [req.user.id]
    );

    if (users.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = users[0];
    console.log('User subscription info:', {
      userId: req.user.id,
      subscription_plan: user.subscription_plan,
      is_trial: user.is_trial,
      trial_end_date: user.trial_end_date
    });

    // Determine the plan type (free, trial, or premium)
    let planType = 'free';
    if (user.is_trial && user.trial_end_date && new Date(user.trial_end_date) > new Date()) {
      planType = 'trial';
      console.log(`User is on trial plan, expires: ${user.trial_end_date}`);
    } else if (user.subscription_plan && user.subscription_plan !== 'free') {
      planType = getBasePlanType(user.subscription_plan);
      console.log(`User is on ${planType} plan`);
    } else {
      console.log('User is on free plan');
    }

    // Check quota using the normalized plan type
    const quotaInfo = await checkOCRQuota(req.user.id, planType);
    const ocrEngine = await getOCREngine(req.user.id);

    console.log('Sending quota info response:', {
      canProcess: quotaInfo.canProcess,
      used: quotaInfo.used,
      limit: quotaInfo.limit,
      remaining: quotaInfo.remaining,
      engine: ocrEngine
    });

    res.json({
      success: true,
      quotaInfo: {
        planType: planType,
        used: quotaInfo.used,
        limit: quotaInfo.limit,
        remaining: quotaInfo.remaining,
        monthlyUsed: quotaInfo.monthlyUsed || 0,
        monthlyLimit: quotaInfo.monthlyLimit || 0,
        canProcess: quotaInfo.canProcess,
        engine: ocrEngine,
        nextReset: quotaInfo.nextReset,
        error: quotaInfo.error || null
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Quota info error:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to get quota information',
      details: error.message
    });
  }
});

app.get('/api/ocr/usage', authenticateToken, async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    const currentMonth = new Date().toISOString().slice(0, 7);

    // Get today's usage
    const [todayUsage] = await db.query(
      'SELECT COALESCE(SUM(ocrPagesUsed), 0) as used FROM user_usage WHERE user_id = ? AND date = ?',
      [req.user.id, today]
    );

    // Get this month's usage
    const [monthUsage] = await db.query(`
      SELECT COALESCE(SUM(ocrPagesUsed), 0) as used 
      FROM user_usage 
      WHERE user_id = ? AND DATE_FORMAT(date, '%Y-%m') = ?
    `, [req.user.id, currentMonth]);

    const [users] = await db.query(
      'SELECT subscription_plan, is_trial, trial_end_date FROM users WHERE id = ?',
      [req.user.id]
    );

    let planType = 'free';
    if (users[0].is_trial && new Date(users[0].trial_end_date) > new Date()) {
      planType = 'trial';
    } else if (users[0].subscription_plan && users[0].subscription_plan !== 'free') {
      planType = getBasePlanType(users[0].subscription_plan);
    }

    // Get the limits for this plan
    const [limits] = await db.query(
      'SELECT daily_limit, monthly_limit, is_unlimited FROM feature_limits WHERE plan_type = ? AND feature_key = ?',
      [planType, 'ocr_pages']
    );

    const dailyLimit = limits.length > 0 ? (limits[0].is_unlimited ? 999999 : limits[0].daily_limit) : 0;
    const monthlyLimit = limits.length > 0 ? (limits[0].is_unlimited ? 999999 : limits[0].monthly_limit || 0) : 0;

    res.json({
      success: true,
      planType,
      todayUsage: todayUsage[0].used || 0,
      monthlyUsage: monthUsage[0].used || 0,
      dailyLimit: dailyLimit,
      monthlyLimit: monthlyLimit,
      todayRemaining: Math.max(0, dailyLimit - (todayUsage[0].used || 0)),
      monthlyRemaining: Math.max(0, monthlyLimit - (monthUsage[0].used || 0))
    });

  } catch (error) {
    console.error('❌ Usage endpoint error:', error);
    res.status(500).json({ error: 'Failed to get OCR usage' });
  }
});



// Verify premium access
const requirePremium = (req, res, next) => {
  if (req.user.planType !== 'premium') {
    return res.status(403).json({
      error: 'Premium subscription required',
      code: 'PREMIUM_REQUIRED',
      plan: req.user.planType,
      message: `This feature is only available for Premium users. Your current plan: ${req.user.planType}`
    });
  }
  next();
};

// Verify premium or trial access
const requirePremiumOrTrial = (req, res, next) => {
  if (req.user.planType !== 'premium' && req.user.planType !== 'trial') {
    return res.status(403).json({
      error: 'Premium or Trial subscription required',
      code: 'PREMIUM_REQUIRED',
      plan: req.user.planType,
      message: 'This feature is not available in the free plan'
    });
  }
  next();
};


// Get all documents
app.get('/api/documents', authenticateToken, async (req, res) => {
  try {
    const [documents] = await db.query(
      'SELECT id, title, description, file_type, category, total_pages, file_size, created_at, ocr_confidence, processing_status FROM documents WHERE user_id = ? ORDER BY created_at DESC',
      [req.user.id]
    );
    res.json(documents);
  } catch (error) {
    console.error('❌ Get documents error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Enhanced document retrieval with OCR metadata
app.get('/api/documents/:id', authenticateToken, async (req, res) => {
  try {
    const [documents] = await db.query(
      `SELECT *, 
       ocr_confidence, 
       ocr_metadata, 
       image_data, 
       processing_status 
       FROM documents 
       WHERE id = ? AND user_id = ?`,
      [req.params.id, req.user.id]
    );

    if (documents.length === 0) {
      return res.status(404).json({ error: 'Document not found' });
    }

    const document = documents[0];

    let pageContent = [];
    let ocrMetadata = null;
    let imageData = null;

    try {
      pageContent = document.page_content ? JSON.parse(document.page_content) : [];
    } catch (parseError) {
      pageContent = document.content.split('\n\n').filter(page => page.trim().length > 0);
    }

    try {
      ocrMetadata = document.ocr_metadata ? JSON.parse(document.ocr_metadata) : null;
    } catch (parseError) {
      console.warn('Failed to parse OCR metadata');
    }

    try {
      imageData = document.image_data ? JSON.parse(document.image_data) : null;
    } catch (parseError) {
      console.warn('Failed to parse image data');
    }

    res.json({
      ...document,
      pageContent,
      ocrMetadata,
      imageData
    });

  } catch (error) {
    console.error('❌ Get document error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get OCR processing status
app.get('/api/documents/:id/ocr-status', authenticateToken, async (req, res) => {
  try {
    const [documents] = await db.query(
      'SELECT processing_status, ocr_confidence, ocr_metadata FROM documents WHERE id = ? AND user_id = ?',
      [req.params.id, req.user.id]
    );

    if (documents.length === 0) {
      return res.status(404).json({ error: 'Document not found' });
    }

    const document = documents[0];

    res.json({
      status: document.processing_status,
      confidence: document.ocr_confidence,
      metadata: document.ocr_metadata ? JSON.parse(document.ocr_metadata) : null
    });

  } catch (error) {
    console.error('❌ OCR status error:', error);
    res.status(500).json({ error: 'Failed to get OCR status' });
  }
});

// Reprocess OCR for a document
app.post('/api/documents/:id/reprocess-ocr', authenticateToken, upload.single('image'), async (req, res) => {
  try {
    const { ocrLanguage = 'eng' } = req.body;

    if (!req.file) {
      return res.status(400).json({ error: 'No image file provided' });
    }

    const [documents] = await db.query(
      'SELECT id, title FROM documents WHERE id = ? AND user_id = ?',
      [req.params.id, req.user.id]
    );

    if (documents.length === 0) {
      return res.status(404).json({ error: 'Document not found' });
    }

    console.log('🔄 Reprocessing OCR for document:', req.params.id);

    await db.query(
      'UPDATE documents SET processing_status = ? WHERE id = ?',
      ['processing', req.params.id]
    );

    try {
      const ocrResult = await performOCR(req.file.buffer, {
        language: ocrLanguage
      });

      const imageData = {
        originalSize: req.file.size,
        processedAt: new Date().toISOString(),
        dimensions: await getImageDimensions(req.file.buffer)
      };

      await db.query(
        `UPDATE documents SET 
         content = ?, 
         page_content = ?, 
         total_pages = ?,
         ocr_confidence = ?,
         ocr_metadata = ?,
         image_data = ?,
         processing_status = ?,
         updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [
          ocrResult.text,
          JSON.stringify(ocrResult.pageContent),
          ocrResult.totalPages,
          ocrResult.confidence,
          JSON.stringify(ocrResult.metadata),
          JSON.stringify(imageData),
          'completed',
          req.params.id
        ]
      );

      console.log('✅ OCR reprocessing completed');

      res.json({
        message: 'OCR reprocessing completed successfully',
        content: ocrResult.text,
        pageContent: ocrResult.pageContent,
        totalPages: ocrResult.totalPages,
        confidence: ocrResult.confidence,
        metadata: ocrResult.metadata
      });

    } catch (ocrError) {
      console.error('❌ OCR reprocessing failed:', ocrError);

      await db.query(
        'UPDATE documents SET processing_status = ? WHERE id = ?',
        ['failed', req.params.id]
      );

      res.status(500).json({
        error: 'OCR reprocessing failed: ' + ocrError.message
      });
    }

  } catch (error) {
    console.error('❌ OCR reprocess error:', error);
    res.status(500).json({ error: 'Failed to reprocess OCR' });
  }
});

// Get OCR statistics for user
app.get('/api/user/ocr-stats', authenticateToken, async (req, res) => {
  try {
    const [stats] = await db.query(`
      SELECT 
        COUNT(*) as total_ocr_documents,
        AVG(ocr_confidence) as average_confidence,
        SUM(CASE WHEN processing_status = 'completed' THEN 1 ELSE 0 END) as successful_ocr,
        SUM(CASE WHEN processing_status = 'failed' THEN 1 ELSE 0 END) as failed_ocr
      FROM documents 
      WHERE user_id = ? AND file_type = 'image_ocr'
    `, [req.user.id]);

    res.json(stats[0]);

  } catch (error) {
    console.error('❌ OCR stats error:', error);
    res.status(500).json({ error: 'Failed to get OCR statistics' });
  }
});

// AI Endpoints
app.post(
  '/api/documents/:id/summarize',
  authenticateToken,
  checkFeatureAccess,
  requirePremiumOrTrial,
  async (req, res) => {
    try {
      const { selected_text } = req.body;
      const userId = req.user.id;
      const documentId = req.params.id;

      // Verify document ownership
      const [docs] = await db.query(
        'SELECT id FROM documents WHERE id = ? AND user_id = ?',
        [documentId, userId]
      );

      if (docs.length === 0) {
        return res.status(404).json({ error: 'Document not found' });
      }

      // Check daily usage limit
      const today = new Date().toISOString().split('T')[0];
      const [usageData] = await db.query(
        `SELECT COALESCE(summariesUsed, 0) as used FROM user_usage 
         WHERE user_id = ? AND date = ?`,
        [userId, today]
      );

      const [limits] = await db.query(
        `SELECT daily_limit FROM feature_limits 
         WHERE plan_type = ? AND feature_key = 'summaries'`,
        [req.user.planType]
      );

      const dailyLimit = limits[0]?.daily_limit || 0;
      const used = usageData[0]?.used || 0;

      if (used >= dailyLimit && !limits[0]?.is_unlimited) {
        return res.status(429).json({
          error: 'Daily limit reached',
          code: 'LIMIT_EXCEEDED',
          used,
          limit: dailyLimit,
          remaining: 0
        });
      }

      // Get document content
      const [document] = await db.query(
        'SELECT content FROM documents WHERE id = ? AND user_id = ?',
        [documentId, userId]
      );

      if (!document[0] || !document[0].content) {
        return res.status(400).json({ error: 'No content available for summarization' });
      }

      console.log('🤖 Generating summary...');

      const systemMessage = "You are a helpful assistant that creates concise, accurate summaries. Focus on the main points and key information.";
      const prompt = `Please provide a comprehensive summary of the following text. Include the main points, key insights, and important details:\n\n${selected_text || document[0].content}\n\nSummary:`;

      const summary = await callOpenAI(prompt, systemMessage, 500);

      // Increment usage
      await db.query(
        `INSERT INTO user_usage (user_id, date, summariesUsed) 
         VALUES (?, ?, 1)
         ON DUPLICATE KEY UPDATE summariesUsed = summariesUsed + 1`,
        [userId, today]
      );

      // Log activity
      await trackActivity(userId, 'ai_action', 'document', documentId, {
        actionType: 'summarize',
        selectedText: !!selected_text
      });

      res.json({
        success: true,
        result: summary,
        action: 'summarize',
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      console.error('Summarize error:', error);
      res.status(500).json({ error: 'Summarization failed: ' + error.message });
    }
  }
);

// Extract action points - PREMIUM/TRIAL ONLY
app.post(
  '/api/documents/:id/action-points',
  authenticateToken,
  checkFeatureAccess,
  requirePremiumOrTrial,
  async (req, res) => {
    try {
      const { selected_text } = req.body;
      const userId = req.user.id;
      const documentId = req.params.id;

      // Verify document ownership
      const [docs] = await db.query(
        'SELECT id FROM documents WHERE id = ? AND user_id = ?',
        [documentId, userId]
      );

      if (docs.length === 0) {
        return res.status(404).json({ error: 'Document not found' });
      }

      // Check daily usage limit
      const today = new Date().toISOString().split('T')[0];
      const [usageData] = await db.query(
        `SELECT COALESCE(actionPointsUsed, 0) as used FROM user_usage 
         WHERE user_id = ? AND date = ?`,
        [userId, today]
      );

      const [limits] = await db.query(
        `SELECT daily_limit FROM feature_limits 
         WHERE plan_type = ? AND feature_key = 'action_points'`,
        [req.user.planType]
      );

      const dailyLimit = limits[0]?.daily_limit || 0;
      const used = usageData[0]?.used || 0;

      if (used >= dailyLimit && !limits[0]?.is_unlimited) {
        return res.status(429).json({
          error: 'Daily limit reached',
          code: 'LIMIT_EXCEEDED',
          used,
          limit: dailyLimit,
          remaining: 0
        });
      }

      // Get document content
      const [document] = await db.query(
        'SELECT content FROM documents WHERE id = ? AND user_id = ?',
        [documentId, userId]
      );

      if (!document[0] || !document[0].content) {
        return res.status(400).json({ error: 'No content available' });
      }

      console.log('🤖 Extracting action points...');

      const systemMessage = "You are a business analyst that extracts actionable items and tasks from documents. Focus on specific, measurable actions.";
      const prompt = `Analyze the following text and extract specific action points, tasks, and next steps. Format them as a numbered list:\n\n${selected_text || document[0].content}\n\nAction Points:`;

      const actionPoints = await callOpenAI(prompt, systemMessage, 600);

      // Increment usage
      await db.query(
        `INSERT INTO user_usage (user_id, date, actionPointsUsed) 
         VALUES (?, ?, 1)
         ON DUPLICATE KEY UPDATE actionPointsUsed = actionPointsUsed + 1`,
        [userId, today]
      );

      // Log activity
      await trackActivity(userId, 'ai_action', 'document', documentId, {
        actionType: 'action_points'
      });

      res.json({
        success: true,
        result: actionPoints,
        action: 'action-points',
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      console.error('Action points error:', error);
      res.status(500).json({ error: 'Action points extraction failed: ' + error.message });
    }
  }
);

// Decision making - PREMIUM/TRIAL ONLY
app.post(
  '/api/documents/:id/decision-making',
  authenticateToken,
  checkFeatureAccess,
  requirePremiumOrTrial,
  async (req, res) => {
    try {
      const { selected_text, context } = req.body;
      const userId = req.user.id;
      const documentId = req.params.id;

      // Verify document ownership
      const [docs] = await db.query(
        'SELECT id FROM documents WHERE id = ? AND user_id = ?',
        [documentId, userId]
      );

      if (docs.length === 0) {
        return res.status(404).json({ error: 'Document not found' });
      }

      // Check daily usage limit
      const today = new Date().toISOString().split('T')[0];
      const [usageData] = await db.query(
        `SELECT COALESCE(actionPointsUsed, 0) as used FROM user_usage 
         WHERE user_id = ? AND date = ?`,
        [userId, today]
      );

      const [limits] = await db.query(
        `SELECT daily_limit FROM feature_limits 
         WHERE plan_type = ? AND feature_key = 'action_points'`,
        [req.user.planType]
      );

      const dailyLimit = limits[0]?.daily_limit || 0;
      const used = usageData[0]?.used || 0;

      if (used >= dailyLimit && !limits[0]?.is_unlimited) {
        return res.status(429).json({
          error: 'Daily limit reached',
          code: 'LIMIT_EXCEEDED'
        });
      }

      // Get document content
      const [document] = await db.query(
        'SELECT content FROM documents WHERE id = ? AND user_id = ?',
        [documentId, userId]
      );

      if (!document[0] || !document[0].content) {
        return res.status(400).json({ error: 'No content available' });
      }

      console.log('🤖 Generating decision support...');

      const systemMessage = "You are a strategic advisor that helps with decision-making by analyzing information and providing insights.";
      const prompt = `Based on the following document content, provide decision support and recommendations. Consider the context: ${context || 'general analysis'}\n\nDocument content:\n${selected_text || document[0].content}\n\nPlease provide:\n1. Key considerations\n2. Potential risks and opportunities\n3. Recommended actions\n4. Alternative approaches\n\nDecision Support:`;

      const decisionSupport = await callOpenAI(prompt, systemMessage, 800);

      // Increment usage
      await db.query(
        `INSERT INTO user_usage (user_id, date, actionPointsUsed) 
         VALUES (?, ?, 1)
         ON DUPLICATE KEY UPDATE actionPointsUsed = actionPointsUsed + 1`,
        [userId, today]
      );

      // Log activity
      await trackActivity(userId, 'ai_action', 'document', documentId, {
        actionType: 'decision_making'
      });

      res.json({
        success: true,
        result: decisionSupport,
        action: 'decision-making',
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      console.error('Decision support error:', error);
      res.status(500).json({ error: 'Decision support generation failed: ' + error.message });
    }
  }
);

// Translate - PREMIUM/TRIAL ONLY
app.post(
  '/api/documents/:id/translate',
  authenticateToken,
  checkFeatureAccess,
  requirePremiumOrTrial,
  async (req, res) => {
    try {
      const { target_language, selected_text } = req.body;
      const userId = req.user.id;
      const documentId = req.params.id;

      if (!target_language) {
        return res.status(400).json({ error: 'Target language is required' });
      }

      // Verify document ownership
      const [docs] = await db.query(
        'SELECT id FROM documents WHERE id = ? AND user_id = ?',
        [documentId, userId]
      );

      if (docs.length === 0) {
        return res.status(404).json({ error: 'Document not found' });
      }

      // Check daily usage limit
      const today = new Date().toISOString().split('T')[0];
      const [usageData] = await db.query(
        `SELECT COALESCE(translationsUsed, 0) as used FROM user_usage 
         WHERE user_id = ? AND date = ?`,
        [userId, today]
      );

      const [limits] = await db.query(
        `SELECT daily_limit FROM feature_limits 
         WHERE plan_type = ? AND feature_key = 'translations'`,
        [req.user.planType]
      );

      const dailyLimit = limits[0]?.daily_limit || 0;
      const used = usageData[0]?.used || 0;

      if (used >= dailyLimit && !limits[0]?.is_unlimited) {
        return res.status(429).json({
          error: 'Daily limit reached',
          code: 'LIMIT_EXCEEDED'
        });
      }

      // Get document content
      const [document] = await db.query(
        'SELECT content FROM documents WHERE id = ? AND user_id = ?',
        [documentId, userId]
      );

      if (!document[0] || !document[0].content) {
        return res.status(400).json({ error: 'No content available' });
      }

      console.log(`🤖 Translating to ${target_language}...`);

      const systemMessage = `You are a professional translator. Translate the following text to ${target_language} while maintaining the original meaning and context.`;
      const prompt = `Translate the following text to ${target_language}:\n\n${selected_text || document[0].content}\n\nTranslation:`;

      const translation = await callOpenAI(
        prompt,
        systemMessage,
        Math.min((selected_text || document[0].content).length * 2, 2000)
      );

      // Increment usage
      await db.query(
        `INSERT INTO user_usage (user_id, date, translationsUsed) 
         VALUES (?, ?, 1)
         ON DUPLICATE KEY UPDATE translationsUsed = translationsUsed + 1`,
        [userId, today]
      );

      // Log activity
      await trackActivity(userId, 'ai_action', 'document', documentId, {
        actionType: 'translate',
        targetLanguage: target_language
      });

      res.json({
        success: true,
        result: translation,
        action: 'translate',
        target_language: target_language,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      console.error('Translation error:', error);
      res.status(500).json({ error: 'Translation failed: ' + error.message });
    }
  }
);

app.post('/api/documents/:id/voice-command', async (req, res) => {
  try {
    const { command } = req.body;

    if (!command) {
      return res.status(400).json({ error: 'Voice command is required' });
    }

    console.log('🎤 Processing voice command:', command);

    const lowerCommand = command.toLowerCase();
    let response = '';

    if (lowerCommand.includes('summarize')) {
      response = 'Starting document summarization...';
    } else if (lowerCommand.includes('translate')) {
      response = 'What language would you like to translate to?';
    } else if (lowerCommand.includes('action') || lowerCommand.includes('task')) {
      response = 'Extracting action points from the document...';
    } else {
      response = 'Command processed. What would you like me to do with this document?';
    }

    res.json({
      action: 'voice-command',
      command: command,
      response: response,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Voice command error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/chats', authenticateToken, async (req, res) => {
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
});

app.get('/api/chats/:id', authenticateToken, async (req, res) => {
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
});

app.post(
  '/api/chats',
  authenticateToken,
  checkFeatureAccess,
  requirePremiumOrTrial,
  async (req, res) => {
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
  }
);

// Send chat message - PREMIUM/TRIAL ONLY
app.post(
  '/api/chats/:id/messages',
  authenticateToken,
  checkFeatureAccess,
  requirePremiumOrTrial,
  async (req, res) => {
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
  }
);
// Get user's feature limits based on their plan
app.get('/api/users/feature-limits', authenticateToken, async (req, res) => {
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
});


app.get('/api/users/usage', authenticateToken, async (req, res) => {
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
});

// Chatbot AI Functions
const generateChatbotResponse = async (userMessage, documentContent, documentTitle, chatHistory) => {
  try {
    const intent = analyzeUserIntent(userMessage);

    const historyContext = chatHistory.slice(-6).map(msg =>
      `${msg.sender}: ${msg.message}`
    ).join('\n');

    let systemMessage = '';
    let prompt = '';
    let responseType = 'text';
    let metadata = {};

    switch (intent.type) {
      case 'summary':
        systemMessage = `You are a helpful document assistant. You provide clear, concise summaries of document content. Focus on the main points and key information.`;

        prompt = `Document Title: "${documentTitle}"
        
Chat History:
${historyContext}

User's Request: ${userMessage}

Document Content:
${documentContent.substring(0, 8000)}

Please provide a summary based on the user's specific request. If they asked for a particular type of summary or focus area, tailor your response accordingly.`;

        responseType = 'summary';
        metadata = { action: 'summarize', focus: intent.details.focus };
        break;

      case 'question':
        systemMessage = `You are a knowledgeable document assistant. Answer questions accurately based on the document content. If the answer isn't in the document, say so clearly. Be conversational and helpful.`;

        prompt = `Document Title: "${documentTitle}"

Chat History:
${historyContext}

User's Question: ${userMessage}

Document Content:
${documentContent.substring(0, 8000)}

Please answer the user's question based on the document content. Be specific and cite relevant parts when possible.`;

        responseType = 'answer';
        metadata = { action: 'question_answer', question: userMessage };
        break;

      case 'translation':
        const targetLang = intent.details.language || 'Spanish';
        systemMessage = `You are a professional translator. Translate the requested content accurately while maintaining context and meaning.`;

        prompt = `User wants to translate content to ${targetLang}.

Request: ${userMessage}

Document Content:
${documentContent.substring(0, 6000)}

Please translate the requested content to ${targetLang}. If no specific part was mentioned, provide a brief translated summary.`;

        responseType = 'translation';
        metadata = { action: 'translate', target_language: targetLang };
        break;

      case 'action_items':
        systemMessage = `You are a business analyst. Extract actionable items, tasks, and next steps from documents. Be specific and practical.`;

        prompt = `Document Title: "${documentTitle}"

User's Request: ${userMessage}

Document Content:
${documentContent.substring(0, 8000)}

Please identify and list specific action items, tasks, or next steps mentioned in the document. Format them clearly.`;

        responseType = 'action_items';
        metadata = { action: 'extract_actions' };
        break;

      case 'analysis':
        systemMessage = `You are a strategic analyst. Provide insights, identify patterns, and offer analytical perspectives on document content.`;

        prompt = `Document Title: "${documentTitle}"

Chat History:
${historyContext}

User's Analysis Request: ${userMessage}

Document Content:
${documentContent.substring(0, 8000)}

Please provide the requested analysis. Consider trends, patterns, implications, and strategic insights.`;

        responseType = 'analysis';
        metadata = { action: 'analyze', analysis_type: intent.details.analysisType };
        break;

      default:
        systemMessage = `You are a helpful document assistant. You help users understand and work with their uploaded documents. Be conversational, helpful, and refer to the document context when relevant.`;

        prompt = `Document Title: "${documentTitle}"

Chat History:
${historyContext}

User's Message: ${userMessage}

Document Content (first part):
${documentContent.substring(0, 6000)}

Please respond helpfully to the user's message. You can refer to the document content when relevant, suggest actions they might want to take, or answer any questions about what you can help with.`;

        responseType = 'conversation';
        metadata = { action: 'general_chat' };
    }

    const aiResponse = await callOpenAI(prompt, systemMessage, 800);

    return {
      message: aiResponse,
      type: responseType,
      metadata: metadata
    };

  } catch (error) {
    console.error('AI Response Error:', error);
    return {
      message: "I'm sorry, I encountered an error while processing your request. Please try again or rephrase your question.",
      type: 'error',
      metadata: { error: true }
    };
  }
};

const analyzeUserIntent = (message) => {
  const lowerMessage = message.toLowerCase();

  if (lowerMessage.includes('summar') || lowerMessage.includes('overview') ||
    lowerMessage.includes('main points') || lowerMessage.includes('key points')) {
    return {
      type: 'summary',
      confidence: 0.9,
      details: {
        focus: lowerMessage.includes('brief') ? 'brief' :
          lowerMessage.includes('detailed') ? 'detailed' : 'standard'
      }
    };
  }

  if (lowerMessage.includes('what') || lowerMessage.includes('how') ||
    lowerMessage.includes('when') || lowerMessage.includes('where') ||
    lowerMessage.includes('why') || lowerMessage.includes('who') ||
    lowerMessage.includes('')) {
    return {
      type: 'question',
      confidence: 0.8,
      details: {}
    };
  }

  if (lowerMessage.includes('translat') || lowerMessage.includes('spanish') ||
    lowerMessage.includes('french') || lowerMessage.includes('german') ||
    lowerMessage.includes('chinese') || lowerMessage.includes('japanese')) {
    const languages = {
      spanish: 'Spanish', french: 'French', german: 'German',
      chinese: 'Chinese', japanese: 'Japanese', arabic: 'Arabic',
      russian: 'Russian', portuguese: 'Portuguese', italian: 'Italian'
    };

    let detectedLang = null;
    for (const [key, value] of Object.entries(languages)) {
      if (lowerMessage.includes(key)) {
        detectedLang = value;
        break;
      }
    }

    return {
      type: 'translation',
      confidence: 0.9,
      details: { language: detectedLang }
    };
  }

  if (lowerMessage.includes('action') || lowerMessage.includes('task') ||
    lowerMessage.includes('todo') || lowerMessage.includes('next step') ||
    lowerMessage.includes('follow up')) {
    return {
      type: 'action_items',
      confidence: 0.85,
      details: {}
    };
  }

  if (lowerMessage.includes('analyz') || lowerMessage.includes('insights') ||
    lowerMessage.includes('trends') || lowerMessage.includes('pattern') ||
    lowerMessage.includes('recommend')) {
    return {
      type: 'analysis',
      confidence: 0.8,
      details: {
        analysisType: lowerMessage.includes('financial') ? 'financial' :
          lowerMessage.includes('market') ? 'market' : 'general'
      }
    };
  }

  return {
    type: 'general',
    confidence: 0.5,
    details: {}
  };
};


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

// Schedule cleanup every hour
setInterval(cleanExpiredOTPs, 60 * 60 * 1000);

const startServer = async () => {
  try {
    console.log('🔍 Checking dependencies...');

    // Initialize Firebase first
    const firebaseInitialized = initializeFirebase();
    if (!firebaseInitialized) {
      console.warn('⚠️ Firebase not initialized - push notifications will not work');
    }

    // ... rest of your existing startup code ...

    const dbOk = await testDatabase();
    if (!dbOk) {
      console.error('❌ Database connection failed');
      process.exit(1);
    }

    //await initializeDatabase();
    await initializeDatabaseWithAdmin();
    await ensureAdsImagesDir();

    const interfaces = getNetworkInterfaces();
    const PORT = process.env.PORT || 3000;
    const HOST = '0.0.0.0';

    app.listen(PORT, HOST, () => {
      console.log('\n🚀 SERVER STARTED SUCCESSFULLY!');
      console.log('==========================================');
      console.log(`📡 Server running on port ${PORT}`);
      console.log(`🏠 Local: http://localhost:${PORT}`);

      if (interfaces.length > 0) {
        console.log('🌐 Network:');
        interfaces.forEach(iface => {
          console.log(`   ${iface.name}: http://${iface.address}:${PORT}`);
        });
      }

      // ... rest of your existing startup logs ...

      console.log('\n📱 Push Notification Endpoints:');
      console.log(`   POST /api/notifications/register-token`);
      console.log(`   POST /api/notifications/send-immediate`);
      console.log(`   POST /api/notifications/broadcast`);
      console.log(`   POST /api/notifications/test`);
      console.log(`   GET  /api/notifications/:id/delivery-status`);

      if (firebaseInitialized) {
        console.log('\n🔥 Firebase Status: ✅ Ready for push notifications');
      } else {
        console.log('\n🔥 Firebase Status: ❌ Not initialized');
        console.log('   - Add service-account-key.json to enable push notifications');
      }

      console.log('==========================================\n');
    });

  } catch (error) {
    console.error('❌ Server startup failed:', error);
    process.exit(1);
  }
};

// Enhanced backend URL content extraction
// Add these improvements to your existing server.js file

// Enhanced URL content extraction with multiple strategies
const extractUrlContent = async (url) => {
  console.log('🌐 Starting server-side URL extraction for:', url);

  try {
    // Validate URL
    const urlObj = new URL(url);
    if (!['http:', 'https:'].includes(urlObj.protocol)) {
      throw new Error('Only HTTP and HTTPS URLs are supported');
    }

    // Strategy 1: Direct request with proper headers
    const result = await attemptDirectExtraction(url);
    if (result.success) {
      return result;
    }

    // Strategy 2: Try with different user agents
    const userAgentResult = await attemptWithDifferentUserAgents(url);
    if (userAgentResult.success) {
      return userAgentResult;
    }

    // Strategy 3: Try with simplified headers
    const simplifiedResult = await attemptSimplifiedRequest(url);
    if (simplifiedResult.success) {
      return simplifiedResult;
    }

    throw new Error('All extraction strategies failed');

  } catch (error) {
    console.error('❌ URL extraction error:', error);

    // Return error result with fallback content
    const urlObj = new URL(url);
    return {
      success: false,
      error: error.message,
      preview: {
        url: url,
        title: `Content from ${urlObj.hostname}`,
        description: `Unable to extract content: ${error.message}`,
        favicon: '🌐',
        domain: urlObj.hostname,
        contentType: 'Web Page',
        estimatedReadTime: 'Unknown',
        wordCount: 0,
        error: true,
      },
      content: `URL: ${url}\n\nError: ${error.message}\n\nContent could not be automatically extracted.`
    };
  }
};

// Strategy 1: Direct extraction with comprehensive headers
const attemptDirectExtraction = async (url) => {
  try {
    console.log('🔄 Attempting direct extraction...');

    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Cache-Control': 'max-age=0',
      },
      timeout: 30000,
      maxRedirects: 5,
      validateStatus: (status) => status < 400,
    });

    if (response.data && response.data.length > 100) {
      return parseHtmlContent(response.data, url);
    }

    return { success: false, error: 'No valid content received' };
  } catch (error) {
    console.warn('❌ Direct extraction failed:', error.message);
    return { success: false, error: error.message };
  }
};

// Strategy 2: Try with different user agents
const attemptWithDifferentUserAgents = async (url) => {
  const userAgents = [
    // Chrome on Windows
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    // Chrome on Mac
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    // Firefox on Windows
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:120.0) Gecko/20100101 Firefox/120.0',
    // Safari on Mac
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15',
    // Edge
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0',
    // Mobile Chrome
    'Mozilla/5.0 (Linux; Android 10; SM-G975F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
    // iPhone Safari
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Mobile/15E148 Safari/604.1'
  ];

  for (const userAgent of userAgents) {
    try {
      console.log(`🔄 Trying with user agent: ${userAgent.substring(0, 50)}...`);

      const response = await axios.get(url, {
        headers: {
          'User-Agent': userAgent,
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
          'Connection': 'keep-alive',
          'Cache-Control': 'no-cache',
          'Pragma': 'no-cache'
        },
        timeout: 20000,
        maxRedirects: 3,
        validateStatus: (status) => status < 400,
      });

      if (response.data && response.data.length > 100) {
        console.log('✅ User agent strategy successful');
        return parseHtmlContent(response.data, url);
      }
    } catch (error) {
      console.warn(`❌ User agent attempt failed: ${error.message}`);
      continue;
    }
  }

  return { success: false, error: 'All user agent attempts failed' };
};

// Strategy 3: Simplified request (for sites that block complex headers)
const attemptSimplifiedRequest = async (url) => {
  try {
    console.log('🔄 Attempting simplified request...');

    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; ContentExtractor/1.0)',
        'Accept': 'text/html',
      },
      timeout: 15000,
      maxRedirects: 2,
      validateStatus: (status) => status < 400,
    });

    if (response.data && response.data.length > 100) {
      console.log('✅ Simplified request successful');
      return parseHtmlContent(response.data, url);
    }

    return { success: false, error: 'Simplified request failed' };
  } catch (error) {
    console.warn('❌ Simplified request failed:', error.message);
    return { success: false, error: error.message };
  }
};

// Enhanced HTML parsing with better content extraction
const parseHtmlContent = (html, url) => {
  try {
    console.log('📝 Parsing HTML content...');

    const $ = cheerio.load(html);
    const urlObj = new URL(url);

    // Extract title with multiple fallbacks
    let title = '';

    // Try different title sources
    const titleSources = [
      () => $('title').first().text(),
      () => $('meta[property="og:title"]').attr('content'),
      () => $('meta[name="twitter:title"]').attr('content'),
      () => $('h1').first().text(),
      () => $('h2').first().text(),
    ];

    for (const getTitleFn of titleSources) {
      try {
        const titleCandidate = getTitleFn();
        if (titleCandidate && titleCandidate.trim()) {
          title = titleCandidate.trim();
          break;
        }
      } catch (e) {
        continue;
      }
    }

    if (!title) {
      title = `Content from ${urlObj.hostname}`;
    }

    // Clean title
    title = cleanText(title);

    // Extract description with multiple fallbacks
    let description = '';
    const descriptionSources = [
      () => $('meta[name="description"]').attr('content'),
      () => $('meta[property="og:description"]').attr('content'),
      () => $('meta[name="twitter:description"]').attr('content'),
      () => $('meta[itemprop="description"]').attr('content'),
    ];

    for (const getDescFn of descriptionSources) {
      try {
        const descCandidate = getDescFn();
        if (descCandidate && descCandidate.trim()) {
          description = cleanText(descCandidate.trim());
          break;
        }
      } catch (e) {
        continue;
      }
    }

    // Remove unwanted elements more comprehensively
    const elementsToRemove = [
      'script', 'style', 'nav', 'header', 'footer', 'aside',
      '.ad', '.advertisement', '.sidebar', '.menu', '.navigation',
      '.social-share', '.related-posts', '.comments', '.popup',
      '.modal', '.overlay', '.banner', '.promo', '[role="complementary"]'
    ];

    elementsToRemove.forEach(selector => {
      $(selector).remove();
    });

    // Extract main content with better selectors
    let mainContent = '';
    const contentSelectors = [
      'main',
      'article',
      '[role="main"]',
      '.content',
      '.main-content',
      '.post-content',
      '.entry-content',
      '.article-content',
      '.post-body',
      '.story-body',
      '.article-body',
      '#content',
      '#main-content',
      '.page-content',
      '.blog-post',
      '.single-post',
      '.post',
      '.entry',
      '.article'
    ];

    for (const selector of contentSelectors) {
      const element = $(selector).first();
      if (element.length && element.text().trim().length > 200) {
        mainContent = element.text();
        console.log(`✅ Content found using selector: ${selector}`);
        break;
      }
    }

    // Fallback: try to find the largest text block
    if (!mainContent) {
      console.log('🔄 Using fallback content extraction...');
      const textBlocks = [];

      $('p, div').each((i, elem) => {
        const text = $(elem).text().trim();
        if (text.length > 100) {
          textBlocks.push(text);
        }
      });

      if (textBlocks.length > 0) {
        mainContent = textBlocks.join('\n\n');
      } else {
        // Final fallback to body
        $('body').find('script, style, nav, header, footer, aside').remove();
        mainContent = $('body').text();
      }
    }

    // Clean and format text content
    let textContent = cleanText(mainContent);

    // If description is empty, use first part of content
    if (!description && textContent.length > 0) {
      description = textContent.substring(0, 200);
      if (textContent.length > 200) {
        description += '...';
      }
    }

    // Calculate statistics
    const words = textContent.split(/\s+/).filter(word => word.length > 0);
    const wordCount = words.length;
    const readTimeMinutes = Math.max(1, Math.ceil(wordCount / 200));

    // Determine content type and favicon
    const { contentType, favicon } = determineContentType(urlObj.hostname, title, html);

    // Extract additional metadata
    const metadata = extractMetadata($, urlObj);

    console.log('✅ Content parsed successfully:', {
      title: title.substring(0, 50) + '...',
      contentLength: textContent.length,
      wordCount: wordCount,
      domain: urlObj.hostname
    });

    return {
      success: true,
      preview: {
        url: url,
        domain: urlObj.hostname,
        title: title,
        description: description,
        favicon: favicon,
        contentType: contentType,
        estimatedReadTime: `${readTimeMinutes} min read`,
        wordCount: wordCount,
        error: false,
        metadata: metadata
      },
      content: formatExtractedContent(title, url, urlObj.hostname, textContent, metadata)
    };

  } catch (error) {
    console.error('❌ HTML parsing error:', error);
    throw new Error('Failed to parse HTML content: ' + error.message);
  }
};

// Utility function to clean text
const cleanText = (text) => {
  if (!text) return '';

  return text
    .replace(/\s+/g, ' ')
    .replace(/\n\s*\n\s*\n/g, '\n\n')
    .replace(/\t/g, ' ')
    .trim();
};

// Determine content type and favicon based on URL and content
const determineContentType = (hostname, title, html) => {
  let contentType = 'Web Page';
  let favicon = '🌐';

  const host = hostname.toLowerCase();
  const titleLower = title.toLowerCase();

  // Check for specific sites and content types
  if (host.includes('wikipedia')) {
    contentType = 'Encyclopedia Article';
    favicon = '📖';
  } else if (host.includes('github')) {
    contentType = 'Repository';
    favicon = '💻';
  } else if (host.includes('medium') || host.includes('blog') || host.includes('wordpress')) {
    contentType = 'Blog Post';
    favicon = '✍️';
  } else if (host.includes('docs') || host.includes('documentation')) {
    contentType = 'Documentation';
    favicon = '📚';
  } else if (host.includes('news') || host.includes('bbc') || host.includes('cnn') || host.includes('reuters') || host.includes('nytimes')) {
    contentType = 'News Article';
    favicon = '📰';
  } else if (host.includes('youtube') || host.includes('video') || host.includes('vimeo')) {
    contentType = 'Video Content';
    favicon = '🎥';
  } else if (host.includes('stackoverflow') || host.includes('stackexchange')) {
    contentType = 'Q&A Forum';
    favicon = '❓';
  } else if (host.includes('reddit')) {
    contentType = 'Discussion Forum';
    favicon = '💬';
  } else if (host.includes('linkedin')) {
    contentType = 'Professional Network';
    favicon = '💼';
  } else if (titleLower.includes('documentation') || titleLower.includes('docs')) {
    contentType = 'Documentation';
    favicon = '📚';
  } else if (titleLower.includes('blog') || titleLower.includes('article')) {
    contentType = 'Blog Post';
    favicon = '✍️';
  } else if (titleLower.includes('news') || titleLower.includes('report')) {
    contentType = 'News Article';
    favicon = '📰';
  }

  return { contentType, favicon };
};

// Extract additional metadata from the page
const extractMetadata = ($, urlObj) => {
  const metadata = {};

  try {
    // Author
    metadata.author = $('meta[name="author"]').attr('content') ||
      $('meta[property="article:author"]').attr('content') ||
      $('.author').first().text().trim() || null;

    // Publication date
    metadata.publishDate = $('meta[property="article:published_time"]').attr('content') ||
      $('meta[name="date"]').attr('content') ||
      $('time[datetime]').attr('datetime') || null;

    // Keywords/tags
    metadata.keywords = $('meta[name="keywords"]').attr('content') || null;

    // Language
    metadata.language = $('html').attr('lang') ||
      $('meta[http-equiv="content-language"]').attr('content') || 'en';

    // Site name
    metadata.siteName = $('meta[property="og:site_name"]').attr('content') || urlObj.hostname;

    // Article section/category
    metadata.section = $('meta[property="article:section"]').attr('content') || null;

    // Canonical URL
    metadata.canonicalUrl = $('link[rel="canonical"]').attr('href') || null;

  } catch (error) {
    console.warn('Metadata extraction error:', error);
  }

  return metadata;
};

// Format the extracted content for storage
const formatExtractedContent = (title, url, hostname, textContent, metadata) => {
  let formattedContent = `Title: ${title}\n\nURL: ${url}\n\nDomain: ${hostname}\n\n`;

  // Add metadata if available
  if (metadata.author) {
    formattedContent += `Author: ${metadata.author}\n`;
  }
  if (metadata.publishDate) {
    formattedContent += `Published: ${metadata.publishDate}\n`;
  }
  if (metadata.siteName && metadata.siteName !== hostname) {
    formattedContent += `Site: ${metadata.siteName}\n`;
  }

  formattedContent += `\nContent:\n\n${textContent}`;

  return formattedContent;
};

// Enhanced URL extraction endpoint
app.post('/api/extract-url', authenticateToken, async (req, res) => {
  try {
    const { url } = req.body;

    if (!url) {
      return res.status(400).json({ error: 'URL is required' });
    }

    console.log('📤 URL extraction request for:', url);

    // Validate URL format
    try {
      new URL(url);
    } catch (urlError) {
      return res.status(400).json({ error: 'Invalid URL format' });
    }

    const result = await extractUrlContent(url);

    res.json(result);

  } catch (error) {
    console.error('❌ URL extraction endpoint error:', error);
    res.status(500).json({
      error: 'Failed to extract URL content: ' + error.message
    });
  }
});

// Enhanced bulk URL extraction
app.post('/api/extract-multiple-urls', authenticateToken, async (req, res) => {
  try {
    const { urls } = req.body;

    if (!urls || !Array.isArray(urls) || urls.length === 0) {
      return res.status(400).json({ error: 'URLs array is required' });
    }

    if (urls.length > 10) {
      return res.status(400).json({ error: 'Maximum 10 URLs allowed per request' });
    }

    console.log(`📤 Bulk URL extraction for ${urls.length} URLs`);

    const results = [];

    // Process URLs with limited concurrency to avoid overwhelming target servers
    const processUrl = async (url) => {
      try {
        const result = await extractUrlContent(url);
        return { url, ...result };
      } catch (error) {
        return {
          url,
          success: false,
          error: error.message
        };
      }
    };

    // Process in batches of 3 to avoid overwhelming servers
    for (let i = 0; i < urls.length; i += 3) {
      const batch = urls.slice(i, i + 3);
      const batchResults = await Promise.all(batch.map(processUrl));
      results.push(...batchResults);

      // Small delay between batches
      if (i + 3 < urls.length) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    res.json({
      success: true,
      results: results,
      processed: results.length,
      successful: results.filter(r => r.success).length,
      failed: results.filter(r => !r.success).length
    });

  } catch (error) {
    console.error('❌ Bulk URL extraction error:', error);
    res.status(500).json({
      error: 'Failed to process URLs: ' + error.message
    });
  }
});


// Create document directly from URL (server-side processing)
app.post('/api/documents/from-url', authenticateToken, async (req, res) => {
  try {
    const { url, title, description, category } = req.body;

    if (!url) {
      return res.status(400).json({ error: 'URL is required' });
    }

    console.log('📤 Creating document from URL:', url);

    // Validate URL format
    try {
      new URL(url);
    } catch (urlError) {
      return res.status(400).json({ error: 'Invalid URL format' });
    }

    // Extract content from URL using the backend extraction
    const extractionResult = await extractUrlContent(url);

    if (!extractionResult.success) {
      // Even if extraction had issues, try to create document with available content
      if (!extractionResult.content || extractionResult.content.trim().length === 0) {
        return res.status(400).json({
          error: 'No content could be extracted from this URL: ' + (extractionResult.error || 'Unknown error')
        });
      }
    }

    // Prepare document data
    const documentTitle = title || extractionResult.preview?.title || `Content from ${new URL(url).hostname}`;
    const documentDescription = description || extractionResult.preview?.description || `Imported from: ${url}`;
    const documentCategory = category || 'web-import';
    const content = extractionResult.content;

    // Process content into pages
    const pageContent = content.split('\n\n').filter(page => page.trim().length > 0);
    const totalPages = pageContent.length;

    // Save document to database
    const [result] = await db.query(
      `INSERT INTO documents (
        user_id, title, description, content, page_content, total_pages, 
        file_type, category, file_size, processing_status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        req.user.id,
        documentTitle,
        documentDescription,
        content,
        JSON.stringify(pageContent),
        totalPages,
        'url',
        documentCategory,
        content.length,
        'completed'
      ]
    );

    console.log('✅ Document created from URL with ID:', result.insertId);

    const responseData = {
      id: result.insertId,
      title: documentTitle,
      description: documentDescription,
      content: content,
      pageContent: pageContent,
      totalPages: totalPages,
      fileType: 'url',
      category: documentCategory,
      processingStatus: 'completed',
      url: url,
      extractionMetadata: extractionResult.preview,
      message: 'Document created successfully from URL'
    };

    res.status(201).json(responseData);

  } catch (error) {
    console.error('❌ Create document from URL error:', error);
    res.status(500).json({
      error: 'Failed to create document from URL: ' + error.message
    });
  }
});

let firebaseApp = null;

const initializeFirebase = () => {
  try {
    // Check if service account file exists
    const serviceAccountPath = path.join(__dirname, 'service-account-key2.json');

    if (!fs.existsSync(serviceAccountPath)) {
      console.error('❌ Service account key file not found at:', serviceAccountPath);
      console.error('📋 Please ensure your service-account-key.json file is in the root directory');
      return false;
    }

    // Read and parse service account
    const serviceAccount = require(serviceAccountPath);

    // Initialize Firebase Admin SDK
    if (!admin.apps.length) {
      firebaseApp = admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        projectId: serviceAccount.project_id
      });

      console.log('✅ Firebase Admin SDK initialized successfully');
      console.log('📱 FCM ready for push notifications');
      return true;
    }

    return true;
  } catch (error) {
    console.error('❌ Firebase initialization error:', error);
    return false;
  }
};

// Database schema for notifications
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

const sendPushNotification22 = async (deviceTokens, title, message, data = {}) => {
  if (!firebaseApp) {
    console.warn('⚠️ Firebase not initialized, cannot send push notification');
    return { success: false, error: 'Firebase not available' };
  }

  if (!deviceTokens || deviceTokens.length === 0) {
    console.warn('⚠️ No device tokens provided');
    return { success: false, error: 'No device tokens' };
  }

  try {
    console.log('📤 Sending push notification to', deviceTokens.length, 'devices');
    console.log('📋 Notification details:', { title, message, data });

    const payload = {
      notification: {
        title: title,
        body: message,
      },
      data: {
        ...data,
        timestamp: Date.now().toString(),
        click_action: 'FLUTTER_NOTIFICATION_CLICK', // For Flutter apps
      },
      android: {
        notification: {
          icon: 'ic_notification',
          color: '#4664D5',
          sound: 'default',
          channelId: 'default',
          priority: 'high',
          clickAction: 'FLUTTER_NOTIFICATION_CLICK',
        },
        priority: 'high',
        ttl: 3600000, // 1 hour
      },
      apns: {
        payload: {
          aps: {
            alert: {
              title: title,
              body: message,
            },
            sound: 'default',
            badge: 1,
            'content-available': 1,
          },
        },
      },
    };

    // Send to multiple tokens
    const response = await admin.messaging().sendToDevice(deviceTokens, payload);

    console.log('📊 Push notification results:', {
      successCount: response.successCount,
      failureCount: response.failureCount,
      totalTokens: deviceTokens.length
    });

    // Handle failed tokens
    if (response.failureCount > 0) {
      const failedTokens = [];
      const invalidTokens = [];

      response.results.forEach((result, index) => {
        if (!result.success) {
          const token = deviceTokens[index];
          console.warn('❌ Failed to send to token:', token.substring(0, 20) + '...', result.error?.code);

          failedTokens.push(token);

          // Check if token is invalid and should be removed
          if (result.error?.code === 'messaging/invalid-registration-token' ||
            result.error?.code === 'messaging/registration-token-not-registered') {
            invalidTokens.push(token);
          }
        }
      });

      // Remove invalid tokens from database
      if (invalidTokens.length > 0) {
        await removeInvalidDeviceTokens(invalidTokens);
      }
    }

    return {
      success: true,
      successCount: response.successCount,
      failureCount: response.failureCount,
      response: response
    };

  } catch (error) {
    console.error('❌ Push notification error:', error);
    return { success: false, error: error.message };
  }
};

const sendPushNotification = async (deviceTokens, title, message, data = {}) => {
  if (!firebaseApp) {
    console.warn('⚠️ Firebase not initialized, cannot send push notification');
    return { success: false, error: 'Firebase not available' };
  }

  if (!deviceTokens || deviceTokens.length === 0) {
    console.warn('⚠️ No device tokens provided');
    return { success: false, error: 'No device tokens' };
  }

  try {
    console.log('📤 Sending push notification to', deviceTokens.length, 'devices');
    console.log('📋 Notification details:', { title, message, data });

    // Convert all data values to strings (FCM requirement)
    const stringifiedData = {};
    Object.keys(data).forEach(key => {
      if (data[key] !== null && data[key] !== undefined) {
        stringifiedData[key] = String(data[key]);
      }
    });

    // Add required fields as strings
    stringifiedData.timestamp = String(Date.now());
    stringifiedData.click_action = 'FLUTTER_NOTIFICATION_CLICK';

    // Construct the message payload with proper structure
    const messagePayload = {
      notification: {
        title: title,
        body: message,
      },
      data: stringifiedData,
      android: {
        notification: {
          icon: 'ic_notification',
          color: '#4664D5',
          sound: 'default',
          channelId: 'default',
          priority: 'high',
          clickAction: 'FLUTTER_NOTIFICATION_CLICK',
        },
        priority: 'high',
        ttl: 3600000, // 1 hour
      },
      apns: {
        payload: {
          aps: {
            alert: {
              title: title,
              body: message,
            },
            sound: 'default',
            badge: 1,
            'content-available': 1,
          },
        },
      },
    };

    let successCount = 0;
    let failureCount = 0;
    const failedTokens = [];
    const invalidTokens = [];

    // Send to multiple tokens using sendEachForMulticast (recommended method)
    if (deviceTokens.length > 1) {
      const multicastMessage = {
        ...messagePayload,
        tokens: deviceTokens,
      };

      console.log('📤 Sending multicast message:', JSON.stringify(multicastMessage, null, 2));

      const response = await admin.messaging().sendEachForMulticast(multicastMessage);

      console.log('📊 Multicast notification results:', {
        successCount: response.successCount,
        failureCount: response.failureCount,
        totalTokens: deviceTokens.length
      });

      successCount = response.successCount;
      failureCount = response.failureCount;

      // Handle failed tokens
      response.responses.forEach((result, index) => {
        if (!result.success) {
          const token = deviceTokens[index];
          console.warn('❌ Failed to send to token:', token.substring(0, 20) + '...', result.error?.code);

          failedTokens.push(token);

          // Check if token is invalid and should be removed
          if (result.error?.code === 'messaging/invalid-registration-token' ||
            result.error?.code === 'messaging/registration-token-not-registered') {
            invalidTokens.push(token);
          }
        }
      });

    } else {
      // Send to single token using send method
      const singleMessage = {
        ...messagePayload,
        token: deviceTokens[0],
      };

      console.log('📤 Sending single message:', JSON.stringify(singleMessage, null, 2));

      try {
        const response = await admin.messaging().send(singleMessage);
        successCount = 1;
        console.log('✅ Single notification sent successfully:', response);
      } catch (error) {
        failureCount = 1;
        console.warn('❌ Failed to send single notification:', error.code, error.message);

        failedTokens.push(deviceTokens[0]);

        if (error.code === 'messaging/invalid-registration-token' ||
          error.code === 'messaging/registration-token-not-registered') {
          invalidTokens.push(deviceTokens[0]);
        }

        // Log detailed error information
        console.error('Full error details:', {
          code: error.code,
          message: error.message,
          details: error.details,
          stack: error.stack
        });
      }
    }

    // Remove invalid tokens from database
    if (invalidTokens.length > 0) {
      await removeInvalidDeviceTokens(invalidTokens);
    }

    return {
      success: successCount > 0,
      successCount: successCount,
      failureCount: failureCount,
      totalTokens: deviceTokens.length,
      failedTokens: failedTokens,
      invalidTokens: invalidTokens
    };

  } catch (error) {
    console.error('❌ Push notification error:', error);
    console.error('Error details:', {
      name: error.name,
      message: error.message,
      code: error.code,
      stack: error.stack
    });
    return { success: false, error: error.message };
  }
};

// Remove invalid device tokens
const removeInvalidDeviceTokens = async (tokens) => {
  try {
    if (tokens.length === 0) return;

    const placeholders = tokens.map(() => '?').join(',');
    await db.query(
      `UPDATE user_device_tokens SET is_active = FALSE WHERE device_token IN (${placeholders})`,
      tokens
    );

    console.log(`🗑️ Marked ${tokens.length} invalid tokens as inactive`);
  } catch (error) {
    console.error('❌ Error removing invalid tokens:', error);
  }
};


/**
 * Updated createNotification with better error handling
 */
const createNotification = async (userId, title, message, type = 'general', data = {}, sendPush = true) => {
  try {
    // Validate inputs
    if (!userId || userId <= 0) {
      console.warn('⚠️ Invalid userId for notification');
      return { success: false, error: 'Invalid user ID' };
    }

    if (!title || typeof title !== 'string') {
      console.warn('⚠️ Invalid title for notification');
      return { success: false, error: 'Invalid title' };
    }

    if (!message || typeof message !== 'string') {
      console.warn('⚠️ Invalid message for notification');
      return { success: false, error: 'Invalid message' };
    }

    const userIdNum = parseInt(userId);
    const titleStr = String(title).substring(0, 255);
    const messageStr = String(message).substring(0, 1000);

    // Ensure data is a proper object with string values
    const notificationData = {};
    if (typeof data === 'object' && data !== null && !Array.isArray(data)) {
      Object.keys(data).forEach(key => {
        if (data[key] !== null && data[key] !== undefined) {
          notificationData[key] = String(data[key]);
        }
      });
    }

    // Insert notification into database
    const [result] = await db.query(
      `INSERT INTO notifications (user_id, title, message, type, data, is_sent) 
       VALUES (?, ?, ?, ?, ?, FALSE)`,
      [userIdNum, titleStr, messageStr, type, JSON.stringify(notificationData)]
    );

    const notificationId = result.insertId;
    console.log('✅ Notification created with ID:', notificationId);

    // Send push notification if enabled and requested
    if (sendPush) {
      try {
        const [tokens] = await db.query(
          `SELECT device_token FROM user_device_tokens 
           WHERE user_id = ? AND is_active = TRUE`,
          [userIdNum]
        );

        if (tokens && tokens.length > 0) {
          const deviceTokens = tokens.map(t => t.device_token);
          const pushData = {
            ...notificationData,
            notificationId: String(notificationId),
            timestamp: String(Date.now())
          };

          const pushResult = await sendPushNotification(
            deviceTokens,
            titleStr,
            messageStr,
            pushData
          );

          if (pushResult.success) {
            await db.query(
              `UPDATE notifications SET is_sent = TRUE, sent_at = CURRENT_TIMESTAMP 
               WHERE id = ?`,
              [notificationId]
            );
          }
        }
      } catch (pushErr) {
        console.warn('⚠️ Failed to send push notification:', pushErr.message);
      }
    }

    return { success: true, notificationId };
  } catch (error) {
    console.error('❌ Create notification error:', error.message);
    return { success: false, error: error.message };
  }
};

// ==================== NOTIFICATION ROUTES ====================

app.post('/api/notifications/register-token', authenticateToken, async (req, res) => {
  try {
    const { deviceToken, deviceType, deviceId, appVersion } = req.body;

    if (!deviceToken || !deviceType) {
      return res.status(400).json({ error: 'Device token and type are required' });
    }

    // Validate device token format
    if (typeof deviceToken !== 'string' || deviceToken.length < 50) {
      return res.status(400).json({ error: 'Invalid device token format' });
    }

    console.log('📱 Registering device token:', {
      userId: req.user.id,
      deviceType,
      tokenLength: deviceToken.length,
      deviceId: deviceId?.substring(0, 10) + '...' || 'N/A'
    });

    // Test the token by sending a silent notification
    try {
      const testResult = await admin.messaging().send({
        token: deviceToken,
        data: {
          type: 'registration_test',
          timestamp: Date.now().toString()
        },
        android: {
          priority: 'normal',
        },
        apns: {
          headers: {
            'apns-priority': '5',
          },
          payload: {
            aps: {
              'content-available': 1,
            },
          },
        },
      });

      console.log('✅ Token validation successful:', testResult);
    } catch (testError) {
      console.warn('⚠️ Token validation failed:', testError.code);
      if (testError.code === 'messaging/invalid-registration-token') {
        return res.status(400).json({ error: 'Invalid device token' });
      }
    }

    // Upsert device token
    await db.query(`
      INSERT INTO user_device_tokens (user_id, device_token, device_type, device_id, app_version, is_active)
      VALUES (?, ?, ?, ?, ?, TRUE)
      ON DUPLICATE KEY UPDATE
      device_type = VALUES(device_type),
      device_id = VALUES(device_id),
      app_version = VALUES(app_version),
      is_active = TRUE,
      updated_at = CURRENT_TIMESTAMP
    `, [req.user.id, deviceToken, deviceType, deviceId, appVersion]);

    // Initialize notification preferences if not exists
    await db.query(`
      INSERT IGNORE INTO notification_preferences (user_id) VALUES (?)
    `, [req.user.id]);

    // Send welcome notification
    await createNotification(
      req.user.id,
      'Welcome!',
      'Push notifications are now enabled for your account.',
      'system',
      { registration: true }
    );

    res.json({
      success: true,
      message: 'Device token registered successfully',
      tokenValidated: true
    });

  } catch (error) {
    console.error('❌ Register token error:', error);
    res.status(500).json({ error: 'Failed to register device token' });
  }
});


app.post('/api/notifications/send-immediate', authenticateToken, async (req, res) => {
  try {
    const { title, message, data = {} } = req.body;

    if (!title || !message) {
      return res.status(400).json({ error: 'Title and message are required' });
    }

    console.log('📤 Sending immediate notification:', { title, message, userId: req.user.id });

    // Get user's device tokens
    const [tokens] = await db.query(
      `SELECT device_token FROM user_device_tokens 
       WHERE user_id = ? AND is_active = 1`,
      [req.user.id]
    );

    if (tokens.length === 0) {
      return res.status(404).json({ error: 'No active device tokens found' });
    }

    const deviceTokens = tokens.map(t => t.device_token);

    // Send notification
    const result = await sendPushNotification(deviceTokens, title, message, data);

    if (result.success) {
      // Also save to database
      await createNotification(req.user.id, title, message, 'manual', data, false);

      res.json({
        success: true,
        message: 'Notification sent successfully',
        sentTo: result.successCount,
        failed: result.failureCount
      });
    } else {
      res.status(500).json({
        success: false,
        error: result.error
      });
    }

  } catch (error) {
    console.error('❌ Send immediate notification error:', error);
    res.status(500).json({ error: 'Failed to send notification' });
  }
});


app.post('/api/notifications/broadcast', authenticateToken, async (req, res) => {
  try {
    const { title, message, data = {}, targetUserIds = [] } = req.body;

    if (!title || !message) {
      return res.status(400).json({ error: 'Title and message are required' });
    }

    console.log('📢 Broadcasting notification:', { title, message, targetUsers: targetUserIds.length });

    let whereClause = 'WHERE is_active = TRUE';
    let queryParams = [];

    if (targetUserIds.length > 0) {
      const placeholders = targetUserIds.map(() => '?').join(',');
      whereClause += ` AND user_id IN (${placeholders})`;
      queryParams = [...targetUserIds];
    }

    // Get all active device tokens
    const [tokens] = await db.query(
      `SELECT user_id, device_token FROM user_device_tokens ${whereClause}`,
      queryParams
    );

    if (tokens.length === 0) {
      return res.status(404).json({ error: 'No active device tokens found' });
    }

    // Group tokens by user for database saving
    const tokensByUser = {};
    const allTokens = [];

    tokens.forEach(({ user_id, device_token }) => {
      if (!tokensByUser[user_id]) {
        tokensByUser[user_id] = [];
      }
      tokensByUser[user_id].push(device_token);
      allTokens.push(device_token);
    });

    // Send notifications in batches (FCM limit is 500 tokens per request)
    const batchSize = 500;
    let totalSent = 0;
    let totalFailed = 0;

    for (let i = 0; i < allTokens.length; i += batchSize) {
      const batch = allTokens.slice(i, i + batchSize);
      const result = await sendPushNotification(batch, title, message, data);

      if (result.success) {
        totalSent += result.successCount;
        totalFailed += result.failureCount;
      }
    }

    // Save notifications to database for each user
    for (const userId of Object.keys(tokensByUser)) {
      await createNotification(parseInt(userId), title, message, 'broadcast', data, false);
    }

    res.json({
      success: true,
      message: 'Broadcast notification sent',
      totalUsers: Object.keys(tokensByUser).length,
      totalSent,
      totalFailed
    });

  } catch (error) {
    console.error('❌ Broadcast notification error:', error);
    res.status(500).json({ error: 'Failed to send broadcast notification' });
  }
});

// Get user notifications
app.get('/api/notifications', authenticateToken, async (req, res) => {
  try {
    const { page = 1, limit = 20, unreadOnly = false } = req.query;
    const offset = (page - 1) * limit;

    let whereClause = 'WHERE user_id = ?';
    let queryParams = [req.user.id];

    if (unreadOnly === 'true') {
      whereClause += ' AND is_read = FALSE';
    }

    const [notifications] = await db.query(`
      SELECT id, title, message, type, data, is_read, created_at, sent_at
      FROM notifications 
      ${whereClause}
      ORDER BY created_at DESC 
      LIMIT ? OFFSET ?
    `, [...queryParams, parseInt(limit), parseInt(offset)]);

    // Get unread count
    const [unreadCount] = await db.query(
      'SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND is_read = FALSE',
      [req.user.id]
    );

    // Parse JSON data
    const parsedNotifications = notifications.map(notification => ({
      ...notification,
      data: notification.data ? JSON.parse(notification.data) : {}
    }));

    res.json({
      notifications: parsedNotifications,
      unreadCount: unreadCount[0].count,
      page: parseInt(page),
      limit: parseInt(limit),
      hasMore: notifications.length === parseInt(limit)
    });
  } catch (error) {
    console.error('❌ Get notifications error:', error);
    res.status(500).json({ error: 'Failed to fetch notifications' });
  }
});

// Mark notification as read
app.put('/api/notifications/:id/read', authenticateToken, async (req, res) => {
  try {
    const [result] = await db.query(
      'UPDATE notifications SET is_read = TRUE WHERE id = ? AND user_id = ?',
      [req.params.id, req.user.id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Notification not found' });
    }

    res.json({ success: true, message: 'Notification marked as read' });
  } catch (error) {
    console.error('❌ Mark read error:', error);
    res.status(500).json({ error: 'Failed to mark notification as read' });
  }
});

// Mark all notifications as read
app.put('/api/notifications/mark-all-read', authenticateToken, async (req, res) => {
  try {
    await db.query(
      'UPDATE notifications SET is_read = TRUE WHERE user_id = ? AND is_read = FALSE',
      [req.user.id]
    );

    res.json({ success: true, message: 'All notifications marked as read' });
  } catch (error) {
    console.error('❌ Mark all read error:', error);
    res.status(500).json({ error: 'Failed to mark all notifications as read' });
  }
});

// Delete notification
app.delete('/api/notifications/:id', authenticateToken, async (req, res) => {
  try {
    const [result] = await db.query(
      'DELETE FROM notifications WHERE id = ? AND user_id = ?',
      [req.params.id, req.user.id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Notification not found' });
    }

    res.json({ success: true, message: 'Notification deleted' });
  } catch (error) {
    console.error('❌ Delete notification error:', error);
    res.status(500).json({ error: 'Failed to delete notification' });
  }
});

// Get notification preferences
app.get('/api/notifications/preferences', authenticateToken, async (req, res) => {
  try {
    const [preferences] = await db.query(
      'SELECT * FROM notification_preferences WHERE user_id = ?',
      [req.user.id]
    );

    if (preferences.length === 0) {
      // Create default preferences
      await db.query(
        'INSERT INTO notification_preferences (user_id) VALUES (?)',
        [req.user.id]
      );

      const [newPreferences] = await db.query(
        'SELECT * FROM notification_preferences WHERE user_id = ?',
        [req.user.id]
      );

      return res.json(newPreferences[0]);
    }

    res.json(preferences[0]);
  } catch (error) {
    console.error('❌ Get preferences error:', error);
    res.status(500).json({ error: 'Failed to fetch notification preferences' });
  }
});

// Update notification preferences
app.put('/api/notifications/preferences', authenticateToken, async (req, res) => {
  try {
    const {
      push_enabled,
      email_enabled,
      reading_reminders,
      achievement_notifications,
      content_notifications,
      system_notifications,
      quiet_hours_start,
      quiet_hours_end,
      timezone
    } = req.body;

    await db.query(`
      UPDATE notification_preferences SET
        push_enabled = ?,
        email_enabled = ?,
        reading_reminders = ?,
        achievement_notifications = ?,
        content_notifications = ?,
        system_notifications = ?,
        quiet_hours_start = ?,
        quiet_hours_end = ?,
        timezone = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE user_id = ?
    `, [
      push_enabled, email_enabled, reading_reminders,
      achievement_notifications, content_notifications, system_notifications,
      quiet_hours_start, quiet_hours_end, timezone, req.user.id
    ]);

    res.json({ success: true, message: 'Preferences updated successfully' });
  } catch (error) {
    console.error('❌ Update preferences error:', error);
    res.status(500).json({ error: 'Failed to update notification preferences' });
  }
});

app.post('/api/notifications/test', authenticateToken, async (req, res) => {
  try {
    const {
      title = 'Test Notification',
      message = 'This is a test notification from your backend server!',
      data = {}
    } = req.body;

    console.log('🧪 Sending test notification to user:', req.user.id);

    // Get user's device tokens
    const [tokens] = await db.query(
      `SELECT device_token, device_type, updated_at FROM user_device_tokens 
       WHERE user_id = ? AND is_active = TRUE`,
      [req.user.id]
    );

    if (tokens.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'No device tokens found. Please ensure the app is properly registered.',
        suggestion: 'Try restarting the app or checking your device registration.'
      });
    }

    console.log(`📱 Found ${tokens.length} device token(s):`,
      tokens.map(t => ({
        type: t.device_type,
        lastUpdated: t.updated_at,
        tokenPreview: t.device_token.substring(0, 20) + '...'
      }))
    );

    const deviceTokens = tokens.map(t => t.device_token);

    // Enhanced test data with proper formatting (all strings)
    const testData = {
      test: 'true', // Convert boolean to string
      timestamp: new Date().toISOString(),
      userId: String(req.user.id), // Ensure userId is a string
      notificationType: 'test',
      source: 'backend_test',
      ...Object.fromEntries(
        Object.entries(data).map(([key, value]) => [key, String(value)])
      )
    };

    console.log('🧪 Test data being sent:', testData);

    // Send the notification
    const result = await sendPushNotification(deviceTokens, title, message, testData);

    if (result.success) {
      // Save test notification to database
      await createNotification(req.user.id, title, message, 'test', testData, false);

      res.json({
        success: true,
        message: 'Test notification sent successfully!',
        details: {
          sentTo: result.successCount,
          failed: result.failureCount,
          totalTokens: deviceTokens.length,
          devices: tokens.map(t => t.device_type),
          testData: testData
        }
      });
    } else {
      res.status(500).json({
        success: false,
        error: result.error,
        details: {
          totalTokens: deviceTokens.length,
          firebaseInitialized: !!firebaseApp,
          failedTokens: result.failedTokens
        }
      });
    }

  } catch (error) {
    console.error('❌ Test notification error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to send test notification: ' + error.message,
      errorCode: error.code || 'UNKNOWN_ERROR'
    });
  }
});


// Get notification delivery status
app.get('/api/notifications/:id/delivery-status', authenticateToken, async (req, res) => {
  try {
    const [notification] = await db.query(
      `SELECT n.*, COUNT(udt.device_token) as device_count
       FROM notifications n
       LEFT JOIN user_device_tokens udt ON n.user_id = udt.user_id AND udt.is_active = TRUE
       WHERE n.id = ? AND n.user_id = ?
       GROUP BY n.id`,
      [req.params.id, req.user.id]
    );

    if (notification.length === 0) {
      return res.status(404).json({ error: 'Notification not found' });
    }

    const notif = notification[0];

    res.json({
      id: notif.id,
      title: notif.title,
      message: notif.message,
      type: notif.type,
      sent: notif.is_sent,
      sentAt: notif.sent_at,
      deviceCount: notif.device_count,
      createdAt: notif.created_at
    });

  } catch (error) {
    console.error('❌ Get delivery status error:', error);
    res.status(500).json({ error: 'Failed to get delivery status' });
  }
});

/**
 * Updated sendDocumentUploadNotification with validation
 */
async function sendDocumentUploadNotification(userId, documentTitle, documentId, processingStatus) {
  try {
    // Validate all required parameters
    if (!userId || userId <= 0) {
      console.warn('⚠️ Invalid userId for notification:', userId);
      return;
    }

    if (!documentId || documentId <= 0) {
      console.warn('⚠️ Invalid documentId for notification:', documentId);
      return;
    }

    if (!documentTitle || typeof documentTitle !== 'string') {
      console.warn('⚠️ Invalid documentTitle for notification:', documentTitle);
      documentTitle = 'Your Document';
    }

    if (!processingStatus) {
      processingStatus = 'completed';
    }

    const userIdStr = String(userId);
    const docIdStr = String(documentId);
    const titleStr = String(documentTitle).substring(0, 255);

    console.log('📄 Preparing document upload notification:', {
      userId: userIdStr,
      documentTitle: titleStr,
      documentId: docIdStr,
      processingStatus: processingStatus
    });

    // Get user device tokens
    const [tokens] = await db.query(
      `SELECT device_token, device_type FROM user_device_tokens 
       WHERE user_id = ? AND is_active = TRUE`,
      [parseInt(userIdStr)]
    );

    if (!tokens || tokens.length === 0) {
      console.log('ℹ️ No active device tokens for user:', userIdStr);
      return;
    }

    console.log('📱 Found', tokens.length, 'active device token(s)');

    // Determine notification content based on status
    let notificationTitle = 'Document Uploaded';
    let notificationBody = `"${titleStr}" has been uploaded successfully`;

    if (processingStatus === 'completed') {
      notificationTitle = 'Document Ready';
      notificationBody = `"${titleStr}" is ready to read`;
    } else if (processingStatus === 'failed') {
      notificationTitle = 'Upload Complete';
      notificationBody = `"${titleStr}" uploaded but OCR processing failed`;
    } else if (processingStatus === 'processing') {
      notificationTitle = 'Processing Document';
      notificationBody = `"${titleStr}" is being processed`;
    }

    // Prepare notification data (ensure all values are strings for FCM)
    const notificationData = {
      documentId: docIdStr,
      documentTitle: titleStr,
      processingStatus: String(processingStatus),
      type: 'document_uploaded',
      timestamp: String(Date.now()),
      userId: userIdStr
    };

    // Send push notification
    const deviceTokens = tokens.map(t => t.device_token);
    const pushResult = await sendPushNotification(
      deviceTokens,
      notificationTitle,
      notificationBody,
      notificationData
    );

    console.log('📤 Push notification result:', {
      success: pushResult.success,
      sentTo: pushResult.successCount,
      failed: pushResult.failureCount
    });

    // Save to database
    if (pushResult.success) {
      try {
        await createNotification(
          parseInt(userIdStr),
          notificationTitle,
          notificationBody,
          'document_uploaded',
          notificationData,
          false
        );
      } catch (dbErr) {
        console.warn('⚠️ Failed to save notification to database:', dbErr.message);
      }
    }

  } catch (error) {
    console.error('❌ Send notification error:', {
      message: error.message,
      userId: userId,
      documentId: documentId,
      stack: error.stack
    });
  }
}

/**
 * Updated sendOCRCompletionNotification with validation
 */
const sendOCRCompletionNotification = async (userId, documentTitle, confidence, documentId) => {
  try {
    // Validate parameters
    if (!userId || userId <= 0) {
      console.warn('⚠️ Invalid userId for OCR notification');
      return;
    }

    if (!documentId || documentId <= 0) {
      console.warn('⚠️ Invalid documentId for OCR notification');
      return;
    }

    const userIdNum = parseInt(userId);
    const docIdNum = parseInt(documentId);
    const confNum = typeof confidence === 'number' ? confidence : parseFloat(confidence) || 0;
    const titleStr = String(documentTitle).substring(0, 255);

    const message = confNum > 90
      ? `Text extracted with high accuracy (${Math.round(confNum)}%) from "${titleStr}". Ready to read!`
      : `Text extracted from "${titleStr}". You may want to review the content for accuracy.`;

    const title = confNum > 90 ? 'OCR Success! 🎯' : 'OCR Complete ✅';

    await createNotification(
      userIdNum,
      title,
      message,
      'ocr_complete',
      {
        action: 'view_document',
        documentId: String(docIdNum),
        documentTitle: titleStr,
        confidence: Math.round(confNum)
      },
      true
    );

    console.log('✅ OCR completion notification sent');
  } catch (error) {
    console.error('❌ OCR completion notification error:', error.message);
  }
};

// Webhook for FCM delivery reports (optional)
app.post('/api/notifications/delivery-webhook', (req, res) => {
  try {
    console.log('📊 FCM delivery report:', req.body);

    // Process delivery reports here if needed
    // This endpoint can be configured in Firebase Console

    res.status(200).json({ received: true });
  } catch (error) {
    console.error('❌ Webhook error:', error);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});
// Daily reading reminder (cron job)
cron.schedule('0 18 * * *', async () => {
  try {
    console.log('📅 Running daily reading reminder...');

    const [users] = await db.query(`
      SELECT u.id, u.username 
      FROM users u
      JOIN notification_preferences np ON u.id = np.user_id
      WHERE np.reading_reminders = TRUE AND np.push_enabled = TRUE
    `);

    for (const user of users) {
      await createNotification(
        user.id,
        'Daily Reading Goal',
        `Hi ${user.username}! Don't forget to continue your reading journey today.`,
        'daily_reminder',
        { action: 'open_app' }
      );
    }

    console.log(`✅ Sent daily reminders to ${users.length} users`);
  } catch (error) {
    console.error('❌ Daily reminder error:', error);
  }
});


// Initialize statistics tables
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

// ==================== ACTIVITY TRACKING FUNCTIONS ====================

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

// Update daily statistics
const updateDailyStats2 = async (userId, activityType, activityData, durationSeconds) => {
  try {
    const today = new Date().toISOString().split('T')[0];

    // Prepare update values based on activity type
    let updateQuery = `
      INSERT INTO daily_stats (user_id, stat_date) VALUES (?, ?)
      ON DUPLICATE KEY UPDATE
    `;
    let updateValues = [userId, today];
    let updateFields = [];

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
      await db.query(updateQuery, updateValues);
    }
  } catch (error) {
    console.error('❌ Update daily stats error:', error);
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

// Get user statistics for a specific period
const getUserStatistics2 = async (userId, period = 'week') => {
  try {
    let dateCondition = '';
    let chartDataQuery = '';

    const now = new Date();

    switch (period) {
      case 'week':
        const weekStart = new Date(now.setDate(now.getDate() - now.getDay()));
        weekStart.setHours(0, 0, 0, 0);
        dateCondition = `stat_date >= '${weekStart.toISOString().split('T')[0]}'`;

        chartDataQuery = `
          SELECT DAYNAME(stat_date) as label, 
                 SUBSTRING(DAYNAME(stat_date), 1, 1) as short_label,
                 ROUND((total_reading_time_seconds / 3600) * 100) as value
          FROM daily_stats 
          WHERE user_id = ? AND ${dateCondition}
          ORDER BY stat_date ASC
        `;
        break;

      case 'month':
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
        dateCondition = `stat_date >= '${monthStart.toISOString().split('T')[0]}'`;

        chartDataQuery = `
          SELECT CONCAT('Week ', WEEK(stat_date) - WEEK('${monthStart.toISOString().split('T')[0]}') + 1) as label,
                 CONCAT('W', WEEK(stat_date) - WEEK('${monthStart.toISOString().split('T')[0]}') + 1) as short_label,
                 ROUND(AVG(total_reading_time_seconds / 3600) * 100) as value
          FROM daily_stats 
          WHERE user_id = ? AND ${dateCondition}
          GROUP BY WEEK(stat_date)
          ORDER BY WEEK(stat_date) ASC
        `;
        break;

      case '6months':
        const sixMonthsStart = new Date();
        sixMonthsStart.setMonth(sixMonthsStart.getMonth() - 6);
        dateCondition = `stat_date >= '${sixMonthsStart.toISOString().split('T')[0]}'`;

        chartDataQuery = `
          SELECT MONTHNAME(stat_date) as label,
                 SUBSTRING(MONTHNAME(stat_date), 1, 3) as short_label,
                 ROUND(AVG(total_reading_time_seconds / 3600) * 100) as value
          FROM daily_stats 
          WHERE user_id = ? AND ${dateCondition}
          GROUP BY YEAR(stat_date), MONTH(stat_date)
          ORDER BY stat_date ASC
        `;
        break;

      case 'year':
        const yearStart = new Date(now.getFullYear(), 0, 1);
        dateCondition = `stat_date >= '${yearStart.toISOString().split('T')[0]}'`;

        chartDataQuery = `
          SELECT MONTHNAME(stat_date) as label,
                 SUBSTRING(MONTHNAME(stat_date), 1, 3) as short_label,
                 ROUND(AVG(total_reading_time_seconds / 3600) * 100) as value
          FROM daily_stats 
          WHERE user_id = ? AND ${dateCondition}
          GROUP BY MONTH(stat_date)
          ORDER BY MONTH(stat_date) ASC
        `;
        break;
    }

    // Get aggregated stats
    const [aggregatedStats] = await db.query(`
      SELECT 
        ROUND(SUM(total_reading_time_seconds) / 3600, 1) as total_hours,
        ROUND(AVG(total_reading_time_seconds) / 3600, 1) as daily_average_hours,
        SUM(total_words_read) as total_words,
        ROUND(AVG(total_words_read)) as daily_average_words,
        SUM(documents_opened) as total_documents_opened,
        ROUND(AVG(documents_opened), 1) as daily_average_documents,
        SUM(documents_completed) as total_documents_completed,
        SUM(sessions_count) as total_sessions,
        ROUND(AVG(sessions_count), 1) as daily_average_sessions,
        SUM(ai_actions_used) as total_ai_actions
      FROM daily_stats 
      WHERE user_id = ? AND ${dateCondition}
    `, [userId]);

    // Get chart data
    const [chartData] = await db.query(chartDataQuery, [userId]);

    // Get goals for this period
    const [goals] = await db.query(`
      SELECT target_type, target_value, current_value
      FROM reading_goals 
      WHERE user_id = ? AND goal_type = ? AND is_active = TRUE
    `, [userId, period]);

    // Calculate progress percentage for each metric
    const stats = aggregatedStats[0] || {};
    const goalMap = {};
    goals.forEach(goal => {
      goalMap[goal.target_type] = {
        target: goal.target_value,
        current: goal.current_value,
        percentage: Math.round((goal.current_value / goal.target_value) * 100)
      };
    });

    return {
      time: {
        daily: stats.daily_average_hours || 0,
        total: stats.total_hours || 0,
        goal: goalMap.time?.target || 10,
        current: goalMap.time?.current || stats.total_hours || 0,
        unit: 'h'
      },
      words: {
        daily: stats.daily_average_words || 0,
        total: stats.total_words || 0,
        goal: goalMap.words?.target || 20000,
        current: goalMap.words?.current || stats.total_words || 0,
        unit: 'words'
      },
      documents: {
        daily: stats.daily_average_documents || 0,
        total: stats.total_documents_completed || 0,
        goal: goalMap.documents?.target || 15,
        current: goalMap.documents?.current || stats.total_documents_completed || 0,
        unit: 'docs'
      },
      sessions: {
        daily: stats.daily_average_sessions || 0,
        total: stats.total_sessions || 0,
        goal: goalMap.sessions?.target || 25,
        current: goalMap.sessions?.current || stats.total_sessions || 0,
        unit: 'sessions'
      },
      chartData: chartData.map(row => ({
        day: row.label,
        value: Math.min(100, Math.max(0, row.value || 0)),
        label: row.short_label
      }))
    };

  } catch (error) {
    console.error('❌ Get user statistics error:', error);
    throw error;
  }
};


const getUserStatistics3 = async (userId, period = 'week') => {
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
        COALESCE(ROUND(AVG(documents_opened), 1), 0) as daily_avg_documents,
        COALESCE(SUM(documents_completed), 0) as total_documents_completed,
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

    // Get chart data for the period
    let chartDataQuery = '';
    switch (period) {
      case 'week':
        chartDataQuery = `
          SELECT 
            DAYNAME(stat_date) as label, 
            SUBSTRING(DAYNAME(stat_date), 1, 1) as short_label,
            COALESCE(ROUND(total_reading_time_seconds / 60), 0) as value
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
            COALESCE(ROUND(AVG(total_reading_time_seconds) / 60), 0) as value
          FROM daily_stats 
          WHERE user_id = ? AND ${dateCondition}
          GROUP BY WEEK(stat_date, 1)
          ORDER BY stat_date ASC
        `;
        break;

      default:
        chartDataQuery = `
          SELECT 
            DATE_FORMAT(stat_date, '%a') as label,
            DATE_FORMAT(stat_date, '%a') as short_label,
            COALESCE(ROUND(total_reading_time_seconds / 60), 0) as value
          FROM daily_stats 
          WHERE user_id = ? AND ${dateCondition}
          ORDER BY stat_date ASC
        `;
    }

    const [chartData] = await db.query(chartDataQuery, [userId]);
    console.log('📈 Chart data:', chartData);

    // Get reading goals
    const [goals] = await db.query(`
      SELECT target_type, target_value, current_value
      FROM reading_goals 
      WHERE user_id = ? AND goal_type = ? AND is_active = TRUE
    `, [userId, period]);

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

    // Build response
    const goalMap = {};
    goals.forEach(goal => {
      goalMap[goal.target_type] = {
        target: goal.target_value,
        current: goal.current_value,
        percentage: Math.round((goal.current_value / goal.target_value) * 100)
      };
    });

    const result = {
      time: {
        daily: todayMinutes, // Today's reading time in minutes
        total: totalMinutes, // Total for the period
        goal: goalMap.time?.target || 15, // Default 15 min goal
        current: goalMap.time?.current || todayMinutes,
        unit: 'min'
      },
      words: {
        daily: todayData.today_words || 0,
        total: stats.total_words || 0,
        goal: goalMap.words?.target || 2000,
        current: goalMap.words?.current || stats.total_words || 0,
        unit: 'words'
      },
      documents: {
        daily: todayData.today_docs_completed || 0,
        total: stats.total_documents_completed || 0,
        goal: goalMap.documents?.target || 5,
        current: goalMap.documents?.current || stats.total_documents_completed || 0,
        unit: 'docs'
      },
      sessions: {
        daily: todayData.today_sessions || 0,
        total: stats.total_sessions || 0,
        goal: goalMap.sessions?.target || 3,
        current: goalMap.sessions?.current || stats.total_sessions || 0,
        unit: 'sessions'
      },
      streak: streak,
      chartData: chartData.map(row => ({
        day: row.label,
        value: Math.min(100, Math.max(0, row.value || 0)),
        label: row.short_label
      }))
    };

    console.log('✅ Final processed statistics:', result);
    return result;

  } catch (error) {
    console.error('❌ Get user statistics error:', error);
    throw error;
  }
};

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

// ==================== STATISTICS API ROUTES ====================

// Get user statistics
app.get('/api/statistics', authenticateToken, async (req, res) => {
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
});

app.post(
  '/api/reading-sessions/start',
  authenticateToken,
  checkFeatureAccess,
  async (req, res) => {
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
  }
);

// Update reading session progress
app.put('/api/reading-sessions/:sessionId/progress', authenticateToken, async (req, res) => {
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
});

// End reading session
app.post('/api/reading-sessions/:sessionId/end', authenticateToken, async (req, res) => {
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
});

// Add this route for saving reading position
app.post('/api/reading-sessions/position', authenticateToken, async (req, res) => {
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
});

// Add this route for loading reading position
app.get('/api/reading-sessions/position/:documentId', authenticateToken, async (req, res) => {
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
});

// ==================== READING POSITION ROUTES ====================

app.post('/api/documents/:documentId/position', authenticateToken, async (req, res) => {
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
});


app.get('/api/documents/:documentId/position', authenticateToken, async (req, res) => {
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
});

// Track AI action usage
app.post('/api/track/ai-action', authenticateToken, async (req, res) => {
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
});

// Track OCR processing
app.post('/api/track/ocr-processing', authenticateToken, async (req, res) => {
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
});

// Track chat message
app.post('/api/track/chat-message', authenticateToken, async (req, res) => {
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
});

// Get reading goals
app.get('/api/reading-goals', authenticateToken, async (req, res) => {
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
});

// Set reading goal
app.post('/api/reading-goals', authenticateToken, async (req, res) => {
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
});

// Get dashboard summary
// app.get('/api/dashboard-summary', authenticateToken, async (req, res) => {
//   try {
//     const today = new Date().toISOString().split('T')[0];

//     // Get today's stats
//     const [todayStats] = await db.query(
//       'SELECT * FROM daily_stats WHERE user_id = ? AND stat_date = ?',
//       [req.user.id, today]
//     );

//     // Get total documents
//     const [totalDocs] = await db.query(
//       'SELECT COUNT(*) as total FROM documents WHERE user_id = ?',
//       [req.user.id]
//     );

//     // Get reading streak
//     const streak = await getReadingStreak(req.user.id);

//     // Get recent achievements
//     const [recentAchievements] = await db.query(`
//       SELECT achievement_name, earned_at FROM user_achievements 
//       WHERE user_id = ? 
//       ORDER BY earned_at DESC 
//       LIMIT 3
//     `, [req.user.id]);

//     const stats = todayStats[0] || {
//       total_reading_time_seconds: 0,
//       total_words_read: 0,
//       documents_completed: 0,
//       sessions_count: 0
//     };

//     res.json({
//       success: true,
//       summary: {
//         todayReadingTime: Math.round(stats.total_reading_time_seconds / 60), // minutes
//         todayWordsRead: stats.total_words_read,
//         todayDocumentsCompleted: stats.documents_completed,
//         todaySessions: stats.sessions_count,
//         totalDocuments: totalDocs[0].total,
//         currentStreak: streak,
//         recentAchievements: recentAchievements.map(a => ({
//           name: a.achievement_name,
//           earnedAt: a.earned_at
//         }))
//       }
//     });

//   } catch (error) {
//     console.error('❌ Get dashboard summary error:', error);
//     res.status(500).json({ error: 'Failed to fetch dashboard summary' });
//   }
// });

app.post(
  '/api/voice-command',
  authenticateToken,
  checkFeatureAccess,
  requirePremiumOrTrial,
  upload.single('audio'),
  async (req, res) => {
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
  }
);

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


// Also update your /api/dashboard-summary endpoint:
app.get('/api/dashboard-summary', authenticateToken, async (req, res) => {
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
});

// Update the main initializeDatabase function to include statistics tables
const initializeStatisticsInMainDatabase = async () => {
  try {
    await initializeStatisticsTables();
    console.log('✅ Statistics system initialized');
  } catch (error) {
    console.error('❌ Statistics initialization error:', error);
    throw error;
  }
};


// ==================== ADMIN PANEL BACKEND ENDPOINTS ====================
// Add these to your existing server.js file

// Admin middleware for authentication
const authenticateAdmin = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Admin access token required' });
  }

  jwt.verify(token, JWT_SECRET, async (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid admin token' });
    }

    try {
      // Check if user is admin - updated for unified schema
      const [adminCheck] = await db.query(
        'SELECT role FROM Users WHERE id = ? AND role = "admin"',  // Updated table and column names
        [user.user_id || user.id]  // Handle both token formats
      );

      if (adminCheck.length === 0) {
        return res.status(403).json({ error: 'Admin access required' });
      }

      req.user = user;
      next();
    } catch (error) {
      console.error('Admin authentication error:', error);
      res.status(500).json({ error: 'Authentication failed' });
    }
  });
};

// Add this to the initializeAdminTables function
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

// Log admin action
const logAdminAction = async (adminId, action, targetType = null, targetId = null, details = {}, req = null) => {
  try {
    await db.query(
      `INSERT INTO admin_logs (admin_id, action, target_type, target_id, details, ip_address, user_agent) 
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        adminId,
        action,
        targetType,
        targetId,
        JSON.stringify(details),
        req?.ip || null,
        req?.get('User-Agent') || null
      ]
    );
  } catch (error) {
    console.error('❌ Log admin action error:', error);
  }
};

// ==================== ADMIN AUTHENTICATION ====================

// Create first admin user
app.post('/api/admin/setup', async (req, res) => {
  try {
    const { email, password, setupKey } = req.body;

    // Check setup key (you should set this in environment variables)
    if (setupKey !== process.env.ADMIN_SETUP_KEY) {
      return res.status(403).json({ error: 'Invalid setup key' });
    }

    // Check if admin already exists
    const [existingAdmin] = await db.query('SELECT * FROM users WHERE role = "admin"');
    if (existingAdmin.length > 0) {
      return res.status(400).json({ error: 'Admin already exists' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    await db.query(
      'INSERT INTO users (username, email, password, role) VALUES (?, ?, ?, ?)',
      ['admin', email, hashedPassword, 'admin']
    );

    res.json({ message: 'Admin user created successfully' });

  } catch (error) {
    console.error('❌ Admin setup error:', error);
    res.status(500).json({ error: 'Setup failed' });
  }
});

app.post('/api/admin/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    // Query by email OR username to be flexible
    const [users] = await db.query(
      'SELECT * FROM users WHERE (email = ? OR username = ?) AND role IN ("admin", "moderator")',
      [email, email] // This allows login with either email or username
    );

    if (users.length === 0) {
      return res.status(400).json({ error: 'Invalid admin credentials' });
    }

    const user = users[0];
    const isValidPassword = await bcrypt.compare(password, user.password);

    if (!isValidPassword) {
      return res.status(400).json({ error: 'Invalid admin credentials' });
    }

    // Update last login
    await db.query(
      'UPDATE users SET last_login = CURRENT_TIMESTAMP, login_count = login_count + 1 WHERE id = ?',
      [user.id]
    );

    // Create token with proper expiration
    const token = jwt.sign(
      {
        id: user.id,
        email: user.email,
        username: user.username,
        role: user.role
      },
      JWT_SECRET,
      { expiresIn: '24h' } // Increased to 24 hours
    );

    await logAdminAction(user.id, 'admin_login', null, null, { ip: req.ip }, req);

    console.log('✅ Admin login successful:', user.email, 'Token generated');

    res.json({
      token,
      admin: {
        id: user.id,
        email: user.email,
        username: user.username,
        role: user.role
      }
    });

  } catch (error) {
    console.error('❌ Admin login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

app.get('/api/admin/me', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1]; // Get Bearer token
    if (!token) {
      return res.status(401).json({ error: 'No token provided' });
    }

    console.log('🔍 Verifying admin token...');

    const decoded = jwt.verify(token, JWT_SECRET);
    console.log('✅ Token decoded:', { id: decoded.id, role: decoded.role });

    const [users] = await db.query(
      'SELECT id, email, role, username FROM users WHERE id = ? AND role IN ("admin", "moderator")',
      [decoded.id]
    );

    if (users.length === 0) {
      console.log('❌ Admin user not found in database');
      return res.status(401).json({ error: 'Admin user not found' });
    }

    const user = users[0];
    console.log('✅ Admin user found:', user.username);

    res.json({
      id: user.id,
      username: user.username,
      email: user.email,
      role: user.role
    });

  } catch (error) {
    console.error('❌ /api/admin/me error:', error);

    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired', code: 'TOKEN_EXPIRED' });
    }

    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({ error: 'Invalid token', code: 'INVALID_TOKEN' });
    }

    res.status(500).json({ error: 'Authentication failed' });
  }
});

// ==================== DASHBOARD & ANALYTICS ====================

// Admin dashboard overview
app.get('/api/admin/dashboard', authenticateAdmin, async (req, res) => {
  try {
    console.log('📊 Getting admin dashboard data...');

    // Users statistics
    const [userStats] = await db.query(`
      SELECT 
        COUNT(*) as total_users,
        COUNT(CASE WHEN created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY) THEN 1 END) as new_users_week,
        COUNT(CASE WHEN created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY) THEN 1 END) as new_users_month,
        COUNT(CASE WHEN last_login >= DATE_SUB(NOW(), INTERVAL 7 DAY) THEN 1 END) as active_users_week,
        COUNT(CASE WHEN status = 'active' THEN 1 END) as active_users,
        COUNT(CASE WHEN status = 'suspended' THEN 1 END) as suspended_users
      FROM users WHERE role = 'user'
    `);

    // Documents statistics
    const [docStats] = await db.query(`
      SELECT 
        COUNT(*) as total_documents,
        COUNT(CASE WHEN created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY) THEN 1 END) as new_documents_week,
        COUNT(CASE WHEN file_type = 'image_ocr' THEN 1 END) as ocr_documents,
        ROUND(AVG(file_size)) as avg_file_size,
        SUM(file_size) as total_storage_used
      FROM documents
    `);

    // Chat statistics
    const [chatStats] = await db.query(`
      SELECT 
        COUNT(DISTINCT cs.id) as total_chats,
        COUNT(cm.id) as total_messages,
        COUNT(CASE WHEN cs.created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY) THEN 1 END) as new_chats_week
      FROM chat_sessions cs
      LEFT JOIN chat_messages cm ON cs.id = cm.chat_id
    `);

    // System statistics
    const [systemStats] = await db.query(`
      SELECT 
        (SELECT COUNT(*) FROM notifications WHERE created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)) as notifications_sent_today,
        (SELECT COUNT(*) FROM user_device_tokens WHERE is_active = TRUE) as active_devices,
        (SELECT COUNT(*) FROM admin_logs WHERE created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)) as admin_actions_today
    `);

    // Recent activity
    const [recentUsers] = await db.query(`
      SELECT id, username, email, created_at, last_login, status
      FROM users 
      WHERE role = 'user' 
      ORDER BY created_at DESC 
      LIMIT 10
    `);

    const [recentDocuments] = await db.query(`
      SELECT d.id, d.title, d.file_type, d.created_at, u.username, u.email
      FROM documents d
      JOIN users u ON d.user_id = u.id
      ORDER BY d.created_at DESC
      LIMIT 10
    `);

    // Error logs (last 24 hours)
    const [errorLogs] = await db.query(`
      SELECT action, details, created_at, COUNT(*) as count
      FROM admin_logs 
      WHERE created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
        AND action LIKE '%error%'
      GROUP BY action, DATE(created_at)
      ORDER BY created_at DESC
      LIMIT 10
    `);

    await logAdminAction(req.user.id, 'view_dashboard', null, null, {}, req);

    res.json({
      success: true,
      dashboard: {
        users: userStats[0],
        documents: docStats[0],
        chats: chatStats[0],
        system: systemStats[0],
        recentUsers,
        recentDocuments,
        errorLogs
      }
    });

  } catch (error) {
    console.error('❌ Admin dashboard error:', error);
    res.status(500).json({ error: 'Failed to load dashboard' });
  }
});

// System analytics
app.get('/api/admin/analytics', authenticateAdmin, async (req, res) => {
  try {
    const { period = '30days', metric = 'users' } = req.query;

    let dateCondition = '';
    switch (period) {
      case '7days':
        dateCondition = 'created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)';
        break;
      case '30days':
        dateCondition = 'created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)';
        break;
      case '90days':
        dateCondition = 'created_at >= DATE_SUB(NOW(), INTERVAL 90 DAY)';
        break;
      default:
        dateCondition = 'created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)';
    }

    let chartData = [];

    if (metric === 'users') {
      const [userData] = await db.query(`
        SELECT 
          DATE(created_at) as date,
          COUNT(*) as count
        FROM users 
        WHERE role = 'user' AND ${dateCondition}
        GROUP BY DATE(created_at)
        ORDER BY date ASC
      `);
      chartData = userData;
    } else if (metric === 'documents') {
      const [docData] = await db.query(`
        SELECT 
          DATE(created_at) as date,
          COUNT(*) as count
        FROM documents 
        WHERE ${dateCondition}
        GROUP BY DATE(created_at)
        ORDER BY date ASC
      `);
      chartData = docData;
    }

    await logAdminAction(req.user.id, 'view_analytics', null, null, { period, metric }, req);

    res.json({
      success: true,
      analytics: {
        period,
        metric,
        chartData
      }
    });

  } catch (error) {
    console.error('❌ Analytics error:', error);
    res.status(500).json({ error: 'Failed to load analytics' });
  }
});

// Admin: Get all feature limits
app.get('/api/admin/feature-limits', authenticateAdmin, async (req, res) => {
  try {
    const [limits] = await db.query(`
      SELECT * FROM feature_limits ORDER BY plan_type, feature_key
    `);

    res.json({
      success: true,
      limits
    });

  } catch (error) {
    console.error('Get feature limits error:', error);
    res.status(500).json({ error: 'Failed to get feature limits' });
  }
});

// Admin: Update feature limit
app.put('/api/admin/feature-limits/:id', authenticateAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { daily_limit, monthly_limit, is_unlimited } = req.body;

    await db.query(
      `UPDATE feature_limits 
       SET daily_limit = ?, monthly_limit = ?, is_unlimited = ?
       WHERE id = ?`,
      [daily_limit, monthly_limit, is_unlimited, id]
    );

    await logAdminAction(
      req.user.id,
      'update_feature_limit',
      'feature_limit',
      id,
      { daily_limit, monthly_limit, is_unlimited },
      req
    );

    res.json({
      success: true,
      message: 'Feature limit updated'
    });

  } catch (error) {
    console.error('Update feature limit error:', error);
    res.status(500).json({ error: 'Failed to update feature limit' });
  }
});

// Admin: Bulk update feature limits for a plan
app.put('/api/admin/feature-limits/plan/:planType', authenticateAdmin, async (req, res) => {
  try {
    const { planType } = req.params;
    const { limits } = req.body; // Array of {feature_key, daily_limit, monthly_limit, is_unlimited}

    if (!['free', 'trial', 'premium'].includes(planType)) {
      return res.status(400).json({ error: 'Invalid plan type' });
    }

    for (const limit of limits) {
      await db.query(
        `UPDATE feature_limits 
         SET daily_limit = ?, monthly_limit = ?, is_unlimited = ?
         WHERE plan_type = ? AND feature_key = ?`,
        [limit.daily_limit, limit.monthly_limit, limit.is_unlimited, planType, limit.feature_key]
      );
    }

    await logAdminAction(
      req.user.id,
      'bulk_update_feature_limits',
      'feature_limits',
      null,
      { planType, limitsCount: limits.length },
      req
    );

    res.json({
      success: true,
      message: `Updated ${limits.length} feature limits for ${planType} plan`
    });

  } catch (error) {
    console.error('Bulk update feature limits error:', error);
    res.status(500).json({ error: 'Failed to update feature limits' });
  }
});

app.delete('/api/chats/:id', authenticateToken, async (req, res) => {
  try {
    const [chats] = await db.query(
      'SELECT id FROM chat_sessions WHERE id = ? AND user_id = ?',
      [req.params.id, req.user.id]
    );

    if (chats.length === 0) {
      return res.status(404).json({ error: 'Chat session not found' });
    }

    await db.query('DELETE FROMagers chat_messages WHERE chat_id = ?', [req.params.id]);

    await db.query('DELETE FROM chat_sessions WHERE id = ?', [req.params.id]);

    res.json({ message: 'Chat session deleted successfully' });

  } catch (error) {
    console.error('❌ Delete chat error:', error);
    res.status(500).json({ error: 'Failed to delete chat session' });
  }
});


// ==================== USER MANAGEMENT ====================

// Get all users with filtering and pagination
app.get('/api/admin/users', authenticateAdmin, async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      search = '',
      status = 'all',
      sortBy = 'created_at',
      sortOrder = 'desc'
    } = req.query;

    const offset = (page - 1) * limit;
    let whereClause = 'WHERE role = "user"';
    let queryParams = [];

    if (search) {
      whereClause += ' AND (username LIKE ? OR email LIKE ?)';
      queryParams.push(`%${search}%`, `%${search}%`);
    }

    if (status !== 'all') {
      whereClause += ' AND status = ?';
      queryParams.push(status);
    }

    const validSortColumns = ['created_at', 'username', 'email', 'last_login', 'login_count'];
    const sortColumn = validSortColumns.includes(sortBy) ? sortBy : 'created_at';
    const order = sortOrder.toLowerCase() === 'asc' ? 'ASC' : 'DESC';

    const [users] = await db.query(`
      SELECT 
        u.id, u.username, u.email, u.status, u.created_at, u.last_login, u.login_count,
        COUNT(d.id) as document_count,
        COUNT(cs.id) as chat_count
      FROM users u
      LEFT JOIN documents d ON u.id = d.user_id
      LEFT JOIN chat_sessions cs ON u.id = cs.user_id
      ${whereClause}
      GROUP BY u.id
      ORDER BY ${sortColumn} ${order}
      LIMIT ? OFFSET ?
    `, [...queryParams, parseInt(limit), parseInt(offset)]);

    const [totalCount] = await db.query(`
      SELECT COUNT(*) as total FROM users ${whereClause}
    `, queryParams);

    await logAdminAction(req.user.id, 'view_users', null, null, { search, status }, req);

    res.json({
      success: true,
      users,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: totalCount[0].total,
        totalPages: Math.ceil(totalCount[0].total / limit)
      }
    });

  } catch (error) {
    console.error('❌ Get users error:', error);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

// Get user details
app.get('/api/admin/users/:userId', authenticateAdmin, async (req, res) => {
  try {
    const { userId } = req.params;

    const [users] = await db.query(`
      SELECT u.*, 
        COUNT(DISTINCT d.id) as document_count,
        COUNT(DISTINCT cs.id) as chat_count,
        COUNT(DISTINCT n.id) as notification_count,
        SUM(d.file_size) as total_storage_used
      FROM users u
      LEFT JOIN documents d ON u.id = d.user_id
      LEFT JOIN chat_sessions cs ON u.id = cs.user_id
      LEFT JOIN notifications n ON u.id = n.user_id
      WHERE u.id = ? AND u.role = 'user'
      GROUP BY u.id
    `, [userId]);

    if (users.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Get subscription plan details
    let subscriptionDetails = null;
    const user = users[0];

    if (user.subscription_plan && user.subscription_plan !== 'free') {
      const [planDetails] = await db.query(`
        SELECT 
          plan_name,
          plan_identifier,
          description,
          price,
          currency,
          billing_period,
          features,
          is_active as plan_is_active
        FROM pricing_plans 
        WHERE plan_identifier = ?
      `, [user.subscription_plan]);

      if (planDetails.length > 0) {
        subscriptionDetails = {
          ...planDetails[0],
          features: planDetails[0].features ? JSON.parse(planDetails[0].features) : [],
          subscription_status: user.subscription_status || 'inactive',
          subscription_start_date: user.subscription_start_date || null,
          subscription_end_date: user.subscription_end_date || null,
          last_payment_date: user.last_payment_date || null,
          last_payment_amount: user.last_payment_amount || 0,
          next_billing_date: user.next_billing_date || null,
          payment_method: user.payment_method || null,
          total_payments: user.total_payments || 0,
          is_trial: user.is_trial || false,
          trial_end_date: user.trial_end_date || null
        };
      }
    }

    // If no subscription plan found or user has free plan
    if (!subscriptionDetails) {
      subscriptionDetails = {
        plan_name: 'Free Plan',
        plan_identifier: 'free',
        description: 'Basic free tier with limited features',
        price: 0,
        currency: 'USD',
        billing_period: 'free',
        features: [
          'Basic document upload',
          'Limited OCR processing',
          'Standard support'
        ],
        plan_is_active: true,
        subscription_status: 'active',
        subscription_start_date: user.created_at,
        subscription_end_date: null,
        last_payment_date: null,
        last_payment_amount: 0,
        next_billing_date: null,
        payment_method: null,
        total_payments: 0,
        is_trial: false,
        trial_end_date: null
      };
    }

    const [recentDocuments] = await db.query(`
      SELECT id, title, file_type, file_size, created_at
      FROM documents
      WHERE user_id = ?
      ORDER BY created_at DESC
      LIMIT 5
    `, [userId]);

    const [recentActivity] = await db.query(`
      SELECT activity_type, entity_type, activity_data, created_at
      FROM user_activities
      WHERE user_id = ?
      ORDER BY created_at DESC
      LIMIT 10
    `, [userId]);

    // Get payment history if user has made payments
    let paymentHistory = [];
    if (user.subscription_plan && user.subscription_plan !== 'free') {
      const [payments] = await db.query(`
        SELECT 
          payment_id,
          amount,
          currency,
          payment_method,
          payment_status,
          transaction_id,
          created_at as payment_date
        FROM user_payments 
        WHERE user_id = ?
        ORDER BY created_at DESC
        LIMIT 10
      `, [userId]);

      paymentHistory = payments || [];
    }

    // Get refund history
    const [refundHistory] = await db.query(`
      SELECT 
        id as refund_id,
        refund_type,
        refund_value,
        reason,
        status,
        processed_at,
        created_at
      FROM refunds 
      WHERE user_id = ?
      ORDER BY created_at DESC
      LIMIT 10
    `, [userId]);

    await logAdminAction(req.user.id, 'view_user_details', 'user', userId, {}, req);

    res.json({
      success: true,
      user: users[0],
      subscriptionDetails,
      paymentHistory,
      refundHistory,
      recentDocuments,
      recentActivity
    });

  } catch (error) {
    console.error('❌ Get user details error:', error);
    res.status(500).json({ error: 'Failed to fetch user details' });
  }
});

// Update user status
app.put('/api/admin/users/:userId/status', authenticateAdmin, async (req, res) => {
  try {
    const { userId } = req.params;
    const { status, reason } = req.body;

    if (!['active', 'suspended', 'banned'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    const [result] = await db.query(
      'UPDATE users SET status = ? WHERE id = ? AND role = "user"',
      [status, userId]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    await logAdminAction(
      req.user.id,
      'update_user_status',
      'user',
      userId,
      { status, reason },
      req
    );

    res.json({
      success: true,
      message: `User status updated to ${status}`
    });

  } catch (error) {
    console.error('❌ Update user status error:', error);
    res.status(500).json({ error: 'Failed to update user status' });
  }
});

// Delete user account
app.delete('/api/admin/users/:userId', authenticateAdmin, async (req, res) => {
  try {
    const { userId } = req.params;
    const { reason } = req.body;

    // Get user info before deletion
    const [users] = await db.query('SELECT username, email FROM users WHERE id = ?', [userId]);
    if (users.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Delete user (cascade will handle related data)
    await db.query('DELETE FROM users WHERE id = ? AND role = "user"', [userId]);

    await logAdminAction(
      req.user.id,
      'delete_user',
      'user',
      userId,
      { username: users[0].username, email: users[0].email, reason },
      req
    );

    res.json({
      success: true,
      message: 'User account deleted successfully'
    });

  } catch (error) {
    console.error('❌ Delete user error:', error);
    res.status(500).json({ error: 'Failed to delete user' });
  }
});

// ==================== CONTENT MANAGEMENT ====================

// Get all documents with filtering
app.get('/api/admin/documents', authenticateAdmin, async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      search = '',
      fileType = 'all',
      userId = null
    } = req.query;

    const offset = (page - 1) * limit;
    let whereClause = 'WHERE 1=1';
    let queryParams = [];

    if (search) {
      whereClause += ' AND (d.title LIKE ? OR d.description LIKE ?)';
      queryParams.push(`%${search}%`, `%${search}%`);
    }

    if (fileType !== 'all') {
      whereClause += ' AND d.file_type = ?';
      queryParams.push(fileType);
    }

    if (userId) {
      whereClause += ' AND d.user_id = ?';
      queryParams.push(userId);
    }

    const [documents] = await db.query(`
      SELECT 
        d.id, d.title, d.description, d.file_type, d.file_size, d.total_pages,
        d.processing_status, d.ocr_confidence, d.created_at,
        u.username, u.email
      FROM documents d
      JOIN users u ON d.user_id = u.id
      ${whereClause}
      ORDER BY d.created_at DESC
      LIMIT ? OFFSET ?
    `, [...queryParams, parseInt(limit), parseInt(offset)]);

    const [totalCount] = await db.query(`
      SELECT COUNT(*) as total FROM documents d ${whereClause}
    `, queryParams);

    res.json({
      success: true,
      documents,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: totalCount[0].total,
        totalPages: Math.ceil(totalCount[0].total / limit)
      }
    });

  } catch (error) {
    console.error('❌ Get documents error:', error);
    res.status(500).json({ error: 'Failed to fetch documents' });
  }
});

// Delete document
app.delete('/api/admin/documents/:documentId', authenticateAdmin, async (req, res) => {
  try {
    const { documentId } = req.params;
    const { reason } = req.body;

    // Get document info before deletion
    const [docs] = await db.query(`
      SELECT d.title, d.user_id, u.username 
      FROM documents d
      JOIN users u ON d.user_id = u.id
      WHERE d.id = ?
    `, [documentId]);

    if (docs.length === 0) {
      return res.status(404).json({ error: 'Document not found' });
    }

    await db.query('DELETE FROM documents WHERE id = ?', [documentId]);

    await logAdminAction(
      req.user.id,
      'delete_document',
      'document',
      documentId,
      { title: docs[0].title, owner: docs[0].username, reason },
      req
    );

    res.json({
      success: true,
      message: 'Document deleted successfully'
    });

  } catch (error) {
    console.error('❌ Delete document error:', error);
    res.status(500).json({ error: 'Failed to delete document' });
  }
});

// ==================== SYSTEM MANAGEMENT ====================

// Get system settings
app.get('/api/admin/settings', authenticateAdmin, async (req, res) => {
  try {
    const [settings] = await db.query('SELECT * FROM system_settings ORDER BY setting_key');

    res.json({
      success: true,
      settings
    });

  } catch (error) {
    console.error('❌ Get settings error:', error);
    res.status(500).json({ error: 'Failed to fetch settings' });
  }
});

// Update system setting
app.put('/api/admin/settings/:settingKey', authenticateAdmin, async (req, res) => {
  try {
    const { settingKey } = req.params;
    const { value, description } = req.body;

    await db.query(`
      INSERT INTO system_settings (setting_key, setting_value, description, updated_by)
      VALUES (?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
      setting_value = VALUES(setting_value),
      description = VALUES(description),
      updated_by = VALUES(updated_by),
      updated_at = CURRENT_TIMESTAMP
    `, [settingKey, JSON.stringify(value), description, req.user.id]);

    await logAdminAction(
      req.user.id,
      'update_setting',
      'system_setting',
      null,
      { key: settingKey, value },
      req
    );

    res.json({
      success: true,
      message: 'Setting updated successfully'
    });

  } catch (error) {
    console.error('❌ Update setting error:', error);
    res.status(500).json({ error: 'Failed to update setting' });
  }
});

// Get admin logs
app.get('/api/admin/logs', authenticateAdmin, async (req, res) => {
  try {
    const {
      page = 1,
      limit = 50,
      action = 'all',
      adminId = 'all'
    } = req.query;

    const offset = (page - 1) * limit;
    let whereClause = 'WHERE 1=1';
    let queryParams = [];

    if (action !== 'all') {
      whereClause += ' AND al.action = ?';
      queryParams.push(action);
    }

    if (adminId !== 'all') {
      whereClause += ' AND al.admin_id = ?';
      queryParams.push(adminId);
    }

    const [logs] = await db.query(`
      SELECT 
        al.*, u.username as admin_name, u.email as admin_email
      FROM admin_logs al
      JOIN users u ON al.admin_id = u.id
      ${whereClause}
      ORDER BY al.created_at DESC
      LIMIT ? OFFSET ?
    `, [...queryParams, parseInt(limit), parseInt(offset)]);

    const [totalCount] = await db.query(`
      SELECT COUNT(*) as total FROM admin_logs al ${whereClause}
    `, queryParams);

    res.json({
      success: true,
      logs,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: totalCount[0].total,
        totalPages: Math.ceil(totalCount[0].total / limit)
      }
    });

  } catch (error) {
    console.error('❌ Get logs error:', error);
    res.status(500).json({ error: 'Failed to fetch logs' });
  }
});

// Send broadcast notification to all users
app.post('/api/admin/broadcast-notification', authenticateAdmin, async (req, res) => {
  try {
    const { title, message, data = {} } = req.body;

    if (!title || !message) {
      return res.status(400).json({ error: 'Title and message are required' });
    }

    // Get all active user device tokens
    const [tokens] = await db.query(`
      SELECT udt.device_token, udt.user_id
      FROM user_device_tokens udt
      JOIN users u ON udt.user_id = u.id
      WHERE udt.is_active = 1 AND u.status = 'active'
    `);

    if (tokens.length === 0) {
      return res.status(404).json({ error: 'No active devices found' });
    }

    const deviceTokens = tokens.map(t => t.device_token);

    // Send push notification
    const result = await sendPushNotification(deviceTokens, title, message, {
      ...data,
      broadcast: true,
      admin_sent: true
    });

    // Save notifications to database for each user
    const uniqueUserIds = [...new Set(tokens.map(t => t.user_id))];
    for (const userId of uniqueUserIds) {
      await createNotification(userId, title, message, 'admin_broadcast', data, false);
    }

    await logAdminAction(
      req.user.id,
      'broadcast_notification',
      null,
      null,
      { title, recipientCount: uniqueUserIds.length },
      req
    );

    res.json({
      success: true,
      message: 'Broadcast notification sent',
      sentTo: result.successCount,
      failed: result.failureCount,
      totalUsers: uniqueUserIds.length
    });

  } catch (error) {
    console.error('❌ Broadcast notification error:', error);
    res.status(500).json({ error: 'Failed to send broadcast notification' });
  }
});

// Export system data
app.get('/api/admin/export/:dataType', authenticateAdmin, async (req, res) => {
  try {
    const { dataType } = req.params;
    const { format = 'json' } = req.query;

    let data = [];
    let filename = '';

    switch (dataType) {
      case 'users':
        const [users] = await db.query(`
          SELECT u.id, u.username, u.email, u.status, u.created_at, u.last_login, u.login_count,
            COUNT(DISTINCT d.id) as document_count,
            COUNT(DISTINCT cs.id) as chat_count,
            SUM(d.file_size) as total_storage_used
          FROM users u
          LEFT JOIN documents d ON u.id = d.user_id
          LEFT JOIN chat_sessions cs ON u.id = cs.user_id
          WHERE u.role = 'user'
          GROUP BY u.id
          ORDER BY u.created_at DESC
        `);
        data = users;
        filename = `users_export_${new Date().toISOString().split('T')[0]}`;
        break;

      case 'documents':
        const [documents] = await db.query(`
          SELECT d.id, d.title, d.description, d.file_type, d.file_size, d.total_pages,
            d.processing_status, d.ocr_confidence, d.created_at,
            u.username as owner_username, u.email as owner_email
          FROM documents d
          JOIN users u ON d.user_id = u.id
          ORDER BY d.created_at DESC
        `);
        data = documents;
        filename = `documents_export_${new Date().toISOString().split('T')[0]}`;
        break;

      case 'analytics':
        const [analytics] = await db.query(`
          SELECT 
            DATE(created_at) as date,
            COUNT(CASE WHEN table_name = 'users' THEN 1 END) as new_users,
            COUNT(CASE WHEN table_name = 'documents' THEN 1 END) as new_documents,
            COUNT(CASE WHEN table_name = 'chat_sessions' THEN 1 END) as new_chats
          FROM (
            SELECT 'users' as table_name, created_at FROM users WHERE role = 'user'
            UNION ALL
            SELECT 'documents' as table_name, created_at FROM documents
            UNION ALL
            SELECT 'chat_sessions' as table_name, created_at FROM chat_sessions
          ) combined
          WHERE created_at >= DATE_SUB(NOW(), INTERVAL 90 DAY)
          GROUP BY DATE(created_at)
          ORDER BY date DESC
        `);
        data = analytics;
        filename = `analytics_export_${new Date().toISOString().split('T')[0]}`;
        break;

      default:
        return res.status(400).json({ error: 'Invalid data type' });
    }

    await logAdminAction(
      req.user.id,
      'export_data',
      null,
      null,
      { dataType, format, recordCount: data.length },
      req
    );

    if (format === 'csv') {
      // Convert to CSV
      if (data.length === 0) {
        return res.status(404).json({ error: 'No data to export' });
      }

      const headers = Object.keys(data[0]);
      const csvContent = [
        headers.join(','),
        ...data.map(row => headers.map(header => `"${row[header] || ''}"`).join(','))
      ].join('\n');

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}.csv"`);
      res.send(csvContent);
    } else {
      // Return JSON
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}.json"`);
      res.json({
        success: true,
        dataType,
        exportedAt: new Date().toISOString(),
        recordCount: data.length,
        data
      });
    }

  } catch (error) {
    console.error('❌ Export data error:', error);
    res.status(500).json({ error: 'Failed to export data' });
  }
});

// Feature flags management
app.get('/api/admin/feature-flags', authenticateAdmin, async (req, res) => {
  try {
    const [flags] = await db.query('SELECT * FROM feature_flags ORDER BY flag_name');

    res.json({
      success: true,
      flags
    });

  } catch (error) {
    console.error('❌ Get feature flags error:', error);
    res.status(500).json({ error: 'Failed to fetch feature flags' });
  }
});

app.put('/api/admin/feature-flags/:flagName', authenticateAdmin, async (req, res) => {
  try {
    const { flagName } = req.params;
    const { isEnabled, rolloutPercentage, targetUsers, description } = req.body;

    await db.query(`
      INSERT INTO feature_flags (flag_name, description, is_enabled, rollout_percentage, target_users, created_by, updated_by)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
      description = VALUES(description),
      is_enabled = VALUES(is_enabled),
      rollout_percentage = VALUES(rollout_percentage),
      target_users = VALUES(target_users),
      updated_by = VALUES(updated_by),
      updated_at = CURRENT_TIMESTAMP
    `, [
      flagName,
      description,
      isEnabled,
      rolloutPercentage || 0,
      JSON.stringify(targetUsers || []),
      req.user.id,
      req.user.id
    ]);

    await logAdminAction(
      req.user.id,
      'update_feature_flag',
      'feature_flag',
      null,
      { flagName, isEnabled, rolloutPercentage },
      req
    );

    res.json({
      success: true,
      message: 'Feature flag updated successfully'
    });

  } catch (error) {
    console.error('❌ Update feature flag error:', error);
    res.status(500).json({ error: 'Failed to update feature flag' });
  }
});

// System health check
app.get('/api/admin/system-health', authenticateAdmin, async (req, res) => {
  try {
    // Database health
    const dbStart = Date.now();
    await db.query('SELECT 1');
    const dbLatency = Date.now() - dbStart;

    // Storage health
    const [storageInfo] = await db.query(`
      SELECT 
        SUM(file_size) as total_storage,
        COUNT(*) as total_files,
        AVG(file_size) as avg_file_size
      FROM documents
    `);

    // Active connections
    const [activeUsers] = await db.query(`
      SELECT COUNT(*) as count 
      FROM users 
      WHERE last_login >= DATE_SUB(NOW(), INTERVAL 24 HOUR) AND role = 'user'
    `);

    // Error rates (last 24 hours)
    const [errors] = await db.query(`
      SELECT COUNT(*) as error_count
      FROM admin_logs 
      WHERE created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
        AND (action LIKE '%error%' OR action LIKE '%failed%')
    `);

    // OCR processing stats
    const [ocrStats] = await db.query(`
      SELECT 
        COUNT(*) as total_ocr_docs,
        AVG(ocr_confidence) as avg_confidence,
        COUNT(CASE WHEN processing_status = 'failed' THEN 1 END) as failed_ocr
      FROM documents 
      WHERE file_type = 'image_ocr' 
        AND created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
    `);

    const health = {
      database: {
        status: dbLatency < 100 ? 'healthy' : dbLatency < 500 ? 'warning' : 'critical',
        latency: dbLatency
      },
      storage: {
        totalSizeGB: Math.round((storageInfo[0].total_storage || 0) / 1024 / 1024 / 1024 * 100) / 100,
        totalFiles: storageInfo[0].total_files || 0,
        avgFileSizeMB: Math.round((storageInfo[0].avg_file_size || 0) / 1024 / 1024 * 100) / 100
      },
      users: {
        activeToday: activeUsers[0].count || 0
      },
      errors: {
        errorCount24h: errors[0].error_count || 0,
        status: (errors[0].error_count || 0) < 10 ? 'healthy' : 'warning'
      },
      ocr: {
        processedToday: ocrStats[0].total_ocr_docs || 0,
        avgConfidence: Math.round((ocrStats[0].avg_confidence || 0) * 100) / 100,
        failedCount: ocrStats[0].failed_ocr || 0
      }
    };

    res.json({
      success: true,
      health,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ System health error:', error);
    res.status(500).json({
      error: 'Failed to check system health',
      health: {
        database: { status: 'critical', error: error.message }
      }
    });
  }
});


// ==================== ADS MANAGEMENT ====================

// Get all ads
// Modify the existing GET /api/admin/ads endpoint to include banner_pages
app.get('/api/admin/ads', authenticateAdmin, async (req, res) => {
  try {
    const [ads] = await db.query(`
      SELECT *, banner_pages FROM ads ORDER BY created_at DESC
    `);

    await logAdminAction(req.user.id, 'view_ads', null, null, {}, req);

    res.json({
      success: true,
      ads: ads.map(ad => ({
        ...ad,
        content: JSON.parse(ad.content),
        target_users: ad.target_users ? JSON.parse(ad.target_users) : null,
        banner_pages: ad.banner_pages ? JSON.parse(ad.banner_pages) : [],
        target_plans: ad.target_plans ? JSON.parse(ad.target_plans) : []
      }))
    });

  } catch (error) {
    console.error('❌ Get ads error:', error);
    res.status(500).json({ error: 'Failed to fetch ads' });
  }
});


// Create new ad
app.post('/api/admin/ads', authenticateAdmin, async (req, res) => {
  try {
    const { ad_type, content, target_users, schedule_start, schedule_end, priority, banner_pages, target_audience, target_plans } = req.body;


    if (!ad_type || !content) {
      return res.status(400).json({ error: 'Ad type and content are required' });
    }

    // Validate banner_pages for banner ads
    if (ad_type === 'banner' && (!banner_pages || !Array.isArray(banner_pages) || banner_pages.length === 0)) {
      return res.status(400).json({ error: 'Banner ads must specify at least one page to display on' });
    }

    const [result] = await db.query(
      `INSERT INTO ads (ad_type, content, target_users, schedule_start, schedule_end, priority, banner_pages, target_audience, target_plans, created_by, updated_by)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        ad_type,
        JSON.stringify(content),
        target_users ? JSON.stringify(target_users) : null,
        schedule_start || null,
        schedule_end || null,
        priority || 0,
        ad_type === 'banner' ? JSON.stringify(banner_pages) : null,
        target_audience || 'all',
        target_plans && target_plans.length > 0 ? JSON.stringify(target_plans) : null,
        req.user.id,
        req.user.id
      ]
    );

    await logAdminAction(req.user.id, 'create_ad', 'ad', result.insertId, { ad_type, banner_pages: ad_type === 'banner' ? banner_pages : null }, req);

    res.json({
      success: true,
      message: 'Ad created successfully',
      adId: result.insertId
    });

  } catch (error) {
    console.error('❌ Create ad error:', error);
    res.status(500).json({ error: 'Failed to create ad' });
  }
});

// Update ad
app.put('/api/admin/ads/:id', authenticateAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { ad_type, content, target_users, schedule_start, schedule_end, is_active, priority, banner_pages, target_audience, target_plans } = req.body;



    // Validate banner_pages for banner ads
    if (ad_type === 'banner' && (!banner_pages || !Array.isArray(banner_pages) || banner_pages.length === 0)) {
      return res.status(400).json({ error: 'Banner ads must specify at least one page to display on' });
    }

    const [result] = await db.query(
      `UPDATE ads SET 
    ad_type = ?, 
    content = ?, 
    target_users = ?, 
    schedule_start = ?, 
    schedule_end = ?, 
    is_active = ?, 
    priority = ?, 
    banner_pages = ?,
    target_audience = ?,
    target_plans = ?,
    updated_by = ?,
    updated_at = CURRENT_TIMESTAMP
   WHERE id = ?`,
      [
        ad_type,
        JSON.stringify(content),
        target_users ? JSON.stringify(target_users) : null,
        schedule_start || null,
        schedule_end || null,
        is_active,
        priority || 0,
        ad_type === 'banner' ? JSON.stringify(banner_pages) : null,
        target_audience || 'all',
        target_plans && target_plans.length > 0 ? JSON.stringify(target_plans) : null,
        req.user.id,
        id
      ]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Ad not found' });
    }

    await logAdminAction(req.user.id, 'update_ad', 'ad', id, { ad_type, is_active, banner_pages: ad_type === 'banner' ? banner_pages : null }, req);

    res.json({
      success: true,
      message: 'Ad updated successfully'
    });

  } catch (error) {
    console.error('❌ Update ad error:', error);
    res.status(500).json({ error: 'Failed to update ad' });
  }
});

// Delete ad
app.delete('/api/admin/ads/:id', authenticateAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    const [result] = await db.query('DELETE FROM ads WHERE id = ?', [id]);

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Ad not found' });
    }

    await logAdminAction(req.user.id, 'delete_ad', 'ad', id, {}, req);

    res.json({
      success: true,
      message: 'Ad deleted successfully'
    });

  } catch (error) {
    console.error('❌ Delete ad error:', error);
    res.status(500).json({ error: 'Failed to delete ad' });
  }
});

// Get all active ads (for full-screen random display)
app.get('/api/ads/all-active', authenticateToken, async (req, res) => {
  try {
    console.log('🎯 Fetching all active ads...');
    const userId = req.user.id;

    // Get user subscription info
    const [userInfo] = await db.query(
      'SELECT subscription_plan FROM users WHERE id = ?',
      [userId]
    );

    const userSubscriptionPlan = userInfo[0]?.subscription_plan;
    const isUserFree = !userSubscriptionPlan || userSubscriptionPlan === 'free';

    console.log('👤 User subscription status:', {
      userId,
      plan: userSubscriptionPlan,
      isFree: isUserFree
    });

    // Build targeting condition based on user subscription
    let targetingCondition = '';
    let queryParams = [];

    if (isUserFree) {
      // Free users see ads targeted to 'all' or 'free'
      targetingCondition = `AND (target_audience IN ('all', 'free'))`;
    } else {
      // Paid users see ads targeted to 'all', 'free', or 'paid' (with plan matching)
      targetingCondition = `AND (
        target_audience = 'all' 
        OR target_audience = 'free'
        OR (target_audience = 'paid' AND (target_plans IS NULL OR JSON_CONTAINS(target_plans, ?)))
      )`;
      queryParams.push(JSON.stringify(userSubscriptionPlan));
    }

    const [ads] = await db.query(`
      SELECT id, ad_type, content, priority, impressions, clicks, target_audience, target_plans
      FROM ads 
      WHERE is_active = TRUE 
      AND (schedule_start IS NULL OR schedule_start <= NOW())
      AND (schedule_end IS NULL OR schedule_end >= NOW())
      ${targetingCondition}
      ORDER BY priority DESC, created_at DESC
    `, queryParams);

    console.log(`✅ Found ${ads.length} targeted ads for user`);

    res.json({
      success: true,
      ads: ads.map(ad => ({
        ...ad,
        content: JSON.parse(ad.content)
      }))
    });

  } catch (error) {
    console.error('⚠️ Get all active ads error:', error);
    res.status(500).json({ error: 'Failed to fetch active ads' });
  }
});

// Get ads for specific page (for mobile app)
app.get('/api/ads/page/:pageId', authenticateToken, async (req, res) => {
  try {
    const { pageId } = req.params;
    const userId = req.user.id;

    console.log('🎯 Fetching ads for page:', { pageId, userId });

    // Get user subscription info
    const [userInfo] = await db.query(
      'SELECT subscription_plan FROM users WHERE id = ?',
      [userId]
    );

    const userSubscriptionPlan = userInfo[0]?.subscription_plan;
    const isUserFree = !userSubscriptionPlan || userSubscriptionPlan === 'free';

    console.log('👤 User subscription status:', {
      userId,
      plan: userSubscriptionPlan,
      isFree: isUserFree
    });

    // Build targeting condition based on user subscription
    let targetingCondition = '';
    let queryParams = [JSON.stringify(pageId)];

    if (isUserFree) {
      // Free users see ads targeted to 'all' or 'free'
      targetingCondition = `AND (target_audience IN ('all', 'free'))`;
    } else {
      // Paid users see ads targeted to 'all', 'free', or 'paid' (with plan matching)
      targetingCondition = `AND (
        target_audience = 'all' 
        OR target_audience = 'free'
        OR (target_audience = 'paid' AND (target_plans IS NULL OR JSON_CONTAINS(target_plans, ?)))
      )`;
      queryParams.push(JSON.stringify(userSubscriptionPlan));
    }

    const [ads] = await db.query(`
      SELECT id, ad_type, content, priority, impressions, clicks, target_audience, target_plans
      FROM ads 
      WHERE is_active = TRUE 
      AND (schedule_start IS NULL OR schedule_start <= NOW())
      AND (schedule_end IS NULL OR schedule_end >= NOW())
      AND (
        ad_type != 'banner' 
        OR (ad_type = 'banner' AND JSON_CONTAINS(banner_pages, ?))
      )
      ${targetingCondition}
      ORDER BY priority DESC, created_at DESC
    `, queryParams);

    console.log(`✅ Found ${ads.length} targeted ads for page: ${pageId}`);

    res.json({
      success: true,
      ads: ads.map(ad => ({
        ...ad,
        content: JSON.parse(ad.content)
      }))
    });

  } catch (error) {
    console.error('⚠️ Get page ads error:', error);
    res.status(500).json({ error: 'Failed to fetch ads' });
  }
});

// Get available subscription plans for ad targeting
app.get('/api/admin/subscription-plans', authenticateAdmin, async (req, res) => {
  try {
    const [plans] = await db.query(`
      SELECT plan_identifier, plan_name, is_active
      FROM pricing_plans 
      WHERE is_active = TRUE
      ORDER BY sort_order ASC, plan_name ASC
    `);

    res.json({
      success: true,
      plans
    });

  } catch (error) {
    console.error('⚠️ Get subscription plans error:', error);
    res.status(500).json({ error: 'Failed to fetch subscription plans' });
  }
});

// ==================== AD IMAGE UPLOAD ====================

// Upload advertisement image
app.post('/api/admin/ads/upload-image', authenticateAdmin, uploadAdImage.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ 
        success: false,
        error: 'No image file provided' 
      });
    }

    console.log('📤 Uploading ad image:', {
      originalName: req.file.originalname,
      mimetype: req.file.mimetype,
      size: req.file.size
    });

    // Generate unique filename
    const fileExtension = path.extname(req.file.originalname);
    const timestamp = Date.now();
    const randomString = Math.random().toString(36).substring(7);
    const uniqueFilename = `ad_${timestamp}_${randomString}${fileExtension}`;
    
    // Process image with sharp for optimization
    let processedImageBuffer = req.file.buffer;
    
    try {
      // Optimize image: resize if too large, compress
      const image = sharp(req.file.buffer);
      const metadata = await image.metadata();
      
      // Resize if width > 1200px
      if (metadata.width > 1200) {
        processedImageBuffer = await image
          .resize(1200, null, { 
            fit: 'inside',
            withoutEnlargement: true 
          })
          .jpeg({ quality: 85 })
          .toBuffer();
      } else {
        processedImageBuffer = await image
          .jpeg({ quality: 85 })
          .toBuffer();
      }
      
      console.log('✅ Image optimized:', {
        originalSize: req.file.size,
        optimizedSize: processedImageBuffer.length
      });
    } catch (sharpError) {
      console.warn('⚠️ Image optimization skipped:', sharpError.message);
      processedImageBuffer = req.file.buffer;
    }

    // Save file to disk
    const filePath = path.join(ADS_IMAGES_DIR, uniqueFilename);
    await fs.writeFile(filePath, processedImageBuffer);

    // Generate URLs
    const imageUrl = `/ads-images/${uniqueFilename}`;
    const fullImageUrl = `${req.protocol}://${req.get('host')}${imageUrl}`;

    console.log('✅ Ad image uploaded successfully:', fullImageUrl);

    await logAdminAction(
      req.user.id,
      'upload_ad_image',
      'ad_image',
      null,
      { 
        filename: uniqueFilename, 
        originalSize: req.file.size,
        optimizedSize: processedImageBuffer.length 
      },
      req
    );

    res.json({
      success: true,
      message: 'Image uploaded successfully',
      imageUrl: imageUrl,
      fullImageUrl: fullImageUrl,
      filename: uniqueFilename,
      size: processedImageBuffer.length
    });

  } catch (error) {
    console.error('❌ Upload ad image error:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to upload image: ' + error.message 
    });
  }
});

// Delete advertisement image
app.delete('/api/admin/ads/delete-image', authenticateAdmin, async (req, res) => {
  try {
    const { imageUrl } = req.body;

    if (!imageUrl) {
      return res.status(400).json({ 
        success: false,
        error: 'Image URL is required' 
      });
    }

    // Extract filename from URL (handle both relative and full URLs)
    let filename;
    if (imageUrl.startsWith('http')) {
      const urlObj = new URL(imageUrl);
      filename = path.basename(urlObj.pathname);
    } else {
      filename = path.basename(imageUrl);
    }

    const filePath = path.join(ADS_IMAGES_DIR, filename);

    // Check if file exists
    const fileExists = await fs.pathExists(filePath);
    
    if (fileExists) {
      await fs.remove(filePath);
      console.log('✅ Ad image deleted:', filename);

      await logAdminAction(
        req.user.id,
        'delete_ad_image',
        'ad_image',
        null,
        { filename, imageUrl },
        req
      );

      res.json({
        success: true,
        message: 'Image deleted successfully'
      });
    } else {
      console.warn('⚠️ Image file not found:', filename);
      res.json({
        success: true,
        message: 'Image file not found (may have been already deleted)'
      });
    }

  } catch (error) {
    console.error('❌ Delete ad image error:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to delete image: ' + error.message 
    });
  }
});


// Update ad impression count
app.post('/api/ads/:adId/impression', authenticateToken, async (req, res) => {
  try {
    const { adId } = req.params;

    await db.query(
      'UPDATE ads SET impressions = impressions + 1 WHERE id = ?',
      [adId]
    );

    res.json({ success: true });

  } catch (error) {
    console.error('❌ Update impression error:', error);
    res.status(500).json({ error: 'Failed to update impression' });
  }
});

// Update ad click count
app.post('/api/ads/:adId/click', authenticateToken, async (req, res) => {
  try {
    const { adId } = req.params;

    await db.query(
      'UPDATE ads SET clicks = clicks + 1 WHERE id = ?',
      [adId]
    );

    res.json({ success: true });

  } catch (error) {
    console.error('❌ Update click error:', error);
    res.status(500).json({ error: 'Failed to update click' });
  }
});

// ==================== OTP API ROUTES ====================

// Request OTP for signup
app.post('/api/auth/signup/request-otp', async (req, res) => {
  try {
    const { username, email, password } = req.body;
    
    // Validation
    if (!username || !email || !password) {
      return res.status(400).json({ error: 'All fields are required' });
    }
    
    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }
    
    if (!/\S+@\S+\.\S+/.test(email)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }
    
    // Check if email already exists
    const [existingUser] = await db.query(
      'SELECT id FROM users WHERE email = ?',
      [email.toLowerCase()]
    );
    
    if (existingUser.length > 0) {
      return res.status(400).json({ error: 'Email already registered' });
    }
    
    // Generate OTP
    const otp = generateOTP();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes
    
    // Store OTP in database
    await db.query(
      `INSERT INTO otp_verifications (email, otp_code, otp_type, expires_at) 
       VALUES (?, ?, 'signup', ?)`,
      [email.toLowerCase(), otp, expiresAt]
    );
    
    // Send OTP email
    const emailResult = await sendOTPEmail(email, otp, 'signup');
    
    if (!emailResult.success) {
      return res.status(500).json({ error: 'Failed to send OTP email' });
    }
    
    console.log('✅ Signup OTP sent to:', email);
    
    res.json({
      success: true,
      message: 'OTP sent to your email',
      email: email,
      expiresIn: 900 // 15 minutes in seconds
    });
    
  } catch (error) {
    console.error('❌ Request OTP error:', error);
    res.status(500).json({ error: 'Failed to send OTP' });
  }
});

// Request OTP for login
app.post('/api/auth/login/request-otp', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    // Validation
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }
    
    // Check if user exists and password is correct
    const [users] = await db.query('SELECT * FROM users WHERE email = ?', [email.toLowerCase()]);
    
    if (users.length === 0) {
      return res.status(400).json({ error: 'Invalid credentials' });
    }
    
    const user = users[0];
    const isValidPassword = await bcrypt.compare(password, user.password);
    
    if (!isValidPassword) {
      return res.status(400).json({ error: 'Invalid credentials' });
    }
    
    // Generate OTP
    const otp = generateOTP();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes
    
    // Store OTP in database
    await db.query(
      `INSERT INTO otp_verifications (email, otp_code, otp_type, expires_at) 
       VALUES (?, ?, 'login', ?)`,
      [email.toLowerCase(), otp, expiresAt]
    );
    
    // Send OTP email
    const emailResult = await sendOTPEmail(email, otp, 'login');
    
    if (!emailResult.success) {
      return res.status(500).json({ error: 'Failed to send OTP email' });
    }
    
    console.log('✅ Login OTP sent to:', email);
    
    res.json({
      success: true,
      message: 'OTP sent to your email',
      email: email,
      expiresIn: 900 // 15 minutes in seconds
    });
    
  } catch (error) {
    console.error('❌ Request login OTP error:', error);
    res.status(500).json({ error: 'Failed to send OTP' });
  }
});

// Verify OTP and complete signup
app.post('/api/auth/signup/verify-otp', async (req, res) => {
  try {
    const { email, otp, username, password } = req.body;
    
    // Validation
    if (!email || !otp || !username || !password) {
      return res.status(400).json({ error: 'All fields are required' });
    }
    
    // Find valid OTP
    const [otpRecords] = await db.query(
      `SELECT * FROM otp_verifications 
       WHERE email = ? AND otp_type = 'signup' AND is_verified = FALSE 
       ORDER BY created_at DESC LIMIT 1`,
      [email.toLowerCase()]
    );
    
    if (otpRecords.length === 0) {
      return res.status(400).json({ error: 'No OTP found. Please request a new one.' });
    }
    
    const otpRecord = otpRecords[0];
    
    // Check if expired
    if (new Date() > new Date(otpRecord.expires_at)) {
      return res.status(400).json({ error: 'OTP expired. Please request a new one.' });
    }
    
    // Check attempts
    if (otpRecord.attempts >= 5) {
      return res.status(400).json({ error: 'Too many attempts. Please request a new OTP.' });
    }
    
    // Increment attempts
    await db.query(
      'UPDATE otp_verifications SET attempts = attempts + 1 WHERE id = ?',
      [otpRecord.id]
    );
    
    // Verify OTP
    if (otpRecord.otp_code !== otp) {
      return res.status(400).json({ 
        error: 'Invalid OTP', 
        remainingAttempts: 5 - (otpRecord.attempts + 1) 
      });
    }
    
    // Mark OTP as verified
    await db.query(
      'UPDATE otp_verifications SET is_verified = TRUE, verified_at = NOW() WHERE id = ?',
      [otpRecord.id]
    );
    
    // Check if email already exists (double check)
    const [existingUser] = await db.query(
      'SELECT id FROM users WHERE email = ?',
      [email.toLowerCase()]
    );
    
    if (existingUser.length > 0) {
      return res.status(400).json({ error: 'Email already registered' });
    }
    
    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);
    
    // Calculate 3-day trial end date
    const trialEndDate = new Date();
    trialEndDate.setDate(trialEndDate.getDate() + 3);
    
    // Create user
    const [result] = await db.query(
      `INSERT INTO users (username, email, password, is_trial, trial_end_date, subscription_status) 
       VALUES (?, ?, ?, TRUE, ?, 'trial')`,
      [username, email.toLowerCase(), hashedPassword, trialEndDate]
    );
    
    // Create notification for trial start
    await createNotification(
      result.insertId,
      'Welcome to Your 3-Day Trial!',
      'Enjoy full access to all premium features for 3 days. Upgrade anytime to continue.',
      'trial_started',
      { trial_days: 3, trial_end: trialEndDate.toISOString() }
    );
    
    // Generate JWT token
    const token = jwt.sign(
      { 
        id: result.insertId, 
        email: email.toLowerCase(), 
        username: username, 
        role: 'user' 
      },
      JWT_SECRET,
      { expiresIn: '24h' }
    );
    
    console.log('✅ User registered successfully via OTP:', email);
    
    res.json({
      success: true,
      message: 'Account created successfully',
      token,
      user: {
        id: result.insertId,
        username,
        email: email.toLowerCase(),
        is_trial: true,
        trial_end_date: trialEndDate
      }
    });
    
  } catch (error) {
    console.error('❌ Verify OTP signup error:', error);
    res.status(500).json({ error: 'Failed to verify OTP' });
  }
});

// Verify OTP and complete login
app.post('/api/auth/login/verify-otp', async (req, res) => {
  try {
    const { email, otp } = req.body;
    
    // Validation
    if (!email || !otp) {
      return res.status(400).json({ error: 'Email and OTP are required' });
    }
    
    // Find valid OTP
    const [otpRecords] = await db.query(
      `SELECT * FROM otp_verifications 
       WHERE email = ? AND otp_type = 'login' AND is_verified = FALSE 
       ORDER BY created_at DESC LIMIT 1`,
      [email.toLowerCase()]
    );
    
    if (otpRecords.length === 0) {
      return res.status(400).json({ error: 'No OTP found. Please request a new one.' });
    }
    
    const otpRecord = otpRecords[0];
    
    // Check if expired
    if (new Date() > new Date(otpRecord.expires_at)) {
      return res.status(400).json({ error: 'OTP expired. Please request a new one.' });
    }
    
    // Check attempts
    if (otpRecord.attempts >= 5) {
      return res.status(400).json({ error: 'Too many attempts. Please request a new OTP.' });
    }
    
    // Increment attempts
    await db.query(
      'UPDATE otp_verifications SET attempts = attempts + 1 WHERE id = ?',
      [otpRecord.id]
    );
    
    // Verify OTP
    if (otpRecord.otp_code !== otp) {
      return res.status(400).json({ 
        error: 'Invalid OTP', 
        remainingAttempts: 5 - (otpRecord.attempts + 1) 
      });
    }
    
    // Mark OTP as verified
    await db.query(
      'UPDATE otp_verifications SET is_verified = TRUE, verified_at = NOW() WHERE id = ?',
      [otpRecord.id]
    );
    
    // Get user
    const [users] = await db.query('SELECT * FROM users WHERE email = ?', [email.toLowerCase()]);
    
    if (users.length === 0) {
      return res.status(400).json({ error: 'User not found' });
    }
    
    const user = users[0];
    
    // Update last login
    await db.query(
      'UPDATE users SET last_login = CURRENT_TIMESTAMP, login_count = login_count + 1 WHERE id = ?',
      [user.id]
    );
    
    // Generate JWT token
    const token = jwt.sign(
      { 
        id: user.id, 
        email: user.email, 
        username: user.username, 
        role: user.role || 'user' 
      },
      JWT_SECRET,
      { expiresIn: '24h' }
    );
    
    console.log('✅ User logged in successfully via OTP:', email);
    
    res.json({
      success: true,
      token,
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        role: user.role || 'user',
        status: user.status || 'active',
        created_at: user.created_at,
        last_login: user.last_login
      }
    });
    
  } catch (error) {
    console.error('❌ Verify OTP login error:', error);
    res.status(500).json({ error: 'Failed to verify OTP' });
  }
});

// Resend OTP
app.post('/api/auth/resend-otp', async (req, res) => {
  try {
    const { email, type } = req.body; // type: 'signup' or 'login'
    
    if (!email || !type) {
      return res.status(400).json({ error: 'Email and type are required' });
    }
    
    if (!['signup', 'login'].includes(type)) {
      return res.status(400).json({ error: 'Invalid OTP type' });
    }
    
    // Check rate limiting (max 3 OTPs per 5 minutes)
    const [recentOTPs] = await db.query(
      `SELECT COUNT(*) as count FROM otp_verifications 
       WHERE email = ? AND otp_type = ? AND created_at > DATE_SUB(NOW(), INTERVAL 5 MINUTE)`,
      [email.toLowerCase(), type]
    );
    
    if (recentOTPs[0].count >= 3) {
      return res.status(429).json({ 
        error: 'Too many OTP requests. Please wait 5 minutes.' 
      });
    }
    
    // Generate new OTP
    const otp = generateOTP();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
    
    // Store OTP
    await db.query(
      `INSERT INTO otp_verifications (email, otp_code, otp_type, expires_at) 
       VALUES (?, ?, ?, ?)`,
      [email.toLowerCase(), otp, type, expiresAt]
    );
    
    // Send email
    const emailResult = await sendOTPEmail(email, otp, type);
    
    if (!emailResult.success) {
      return res.status(500).json({ error: 'Failed to send OTP email' });
    }
    
    console.log('✅ OTP resent to:', email);
    
    res.json({
      success: true,
      message: 'New OTP sent to your email',
      expiresIn: 900
    });
    
  } catch (error) {
    console.error('❌ Resend OTP error:', error);
    res.status(500).json({ error: 'Failed to resend OTP' });
  }
});

// ==================== PAYMENT & SUBSCRIPTION ENDPOINTS ====================

// Get all active pricing plans for mobile app
app.get('/api/pricing-plans', authenticateToken, async (req, res) => {
  try {
    const [plans] = await db.query(`
      SELECT 
        id,
        plan_name,
        plan_identifier,
        plan_group,
        description,
        price,
        currency,
        billing_period,
        features,
        is_active,
        sort_order
      FROM pricing_plans 
      WHERE is_active = TRUE
      ORDER BY sort_order ASC, price ASC
    `);

    const processedPlans = plans.map(plan => ({
      ...plan,
      features: plan.features ? JSON.parse(plan.features) : []
    }));

    // Group by plan_group for better mobile display
    const groupedPlans = processedPlans.reduce((acc, plan) => {
      if (!acc[plan.plan_group]) {
        acc[plan.plan_group] = {
          group: plan.plan_group,
          name: plan.plan_name,
          description: plan.description,
          features: plan.features,
          variants: []
        };
      }
      acc[plan.plan_group].variants.push({
        id: plan.id,
        identifier: plan.plan_identifier,
        price: plan.price,
        currency: plan.currency,
        billing_period: plan.billing_period
      });
      return acc;
    }, {});

    res.json({
      success: true,
      plans: Object.values(groupedPlans)
    });

  } catch (error) {
    console.error('❌ Get pricing plans error:', error);
    res.status(500).json({ error: 'Failed to fetch pricing plans' });
  }
});


// Create payment intent (for Stripe/PayPal - Debug APK simulation)
app.post('/api/payments/create-intent', authenticateToken, async (req, res) => {
  try {
    const { plan_id, billing_period } = req.body;

    if (!plan_id) {
      return res.status(400).json({ error: 'Plan ID is required' });
    }

    // Get plan details
    const [plans] = await db.query(
      'SELECT * FROM pricing_plans WHERE id = ? AND billing_period = ?',
      [plan_id, billing_period || 'monthly']
    );

    if (plans.length === 0) {
      return res.status(404).json({ error: 'Plan not found' });
    }

    const plan = plans[0];

    // FOR DEBUG APK: Simulate payment intent
    // In production, you would integrate with Stripe/PayPal/Google Play Billing
    const mockPaymentIntent = {
      id: `pi_debug_${Date.now()}_${req.user.id}`,
      client_secret: `pi_secret_${Date.now()}`,
      amount: plan.price * 100, // Convert to cents
      currency: plan.currency.toLowerCase(),
      status: 'requires_payment_method',
      plan_id: plan.id,
      plan_identifier: plan.plan_identifier,
      plan_name: plan.plan_name,
      billing_period: plan.billing_period
    };

    console.log('💳 Payment intent created (DEBUG MODE):', mockPaymentIntent.id);

    res.json({
      success: true,
      payment_intent: mockPaymentIntent,
      plan: {
        id: plan.id,
        name: plan.plan_name,
        price: plan.price,
        currency: plan.currency,
        billing_period: plan.billing_period,
        features: JSON.parse(plan.features || '[]')
      }
    });

  } catch (error) {
    console.error('❌ Create payment intent error:', error);
    res.status(500).json({ error: 'Failed to create payment intent' });
  }
});

// Process payment and update subscription
app.post('/api/payments/process', authenticateToken, async (req, res) => {
  try {
    const { payment_intent_id, plan_id, payment_method = 'card' } = req.body;

    if (!payment_intent_id || !plan_id) {
      return res.status(400).json({ error: 'Payment intent ID and plan ID are required' });
    }

    // Get plan details
    const [plans] = await db.query('SELECT * FROM pricing_plans WHERE id = ?', [plan_id]);
    
    if (plans.length === 0) {
      return res.status(404).json({ error: 'Plan not found' });
    }

    const plan = plans[0];

    // FOR DEBUG APK: Simulate successful payment
    // In production, verify payment with Stripe/PayPal/Google Play
    const paymentSuccess = true; // Simulate success for debug

    if (!paymentSuccess) {
      return res.status(400).json({ error: 'Payment failed' });
    }

    // Calculate subscription dates
    const subscriptionStartDate = new Date();
    const subscriptionEndDate = new Date();
    
    if (plan.billing_period === 'monthly') {
      subscriptionEndDate.setMonth(subscriptionEndDate.getMonth() + 1);
    } else if (plan.billing_period === 'yearly') {
      subscriptionEndDate.setFullYear(subscriptionEndDate.getFullYear() + 1);
    }

    const nextBillingDate = new Date(subscriptionEndDate);

    // Start transaction
    await db.query('START TRANSACTION');

    try {
      // Update user subscription
      await db.query(
        `UPDATE users SET 
          subscription_plan = ?,
          subscription_status = 'active',
          subscription_start_date = ?,
          subscription_end_date = ?,
          next_billing_date = ?,
          payment_method = ?,
          is_trial = FALSE,
          trial_end_date = NULL
         WHERE id = ?`,
        [
          plan.plan_identifier,
          subscriptionStartDate,
          subscriptionEndDate,
          nextBillingDate,
          payment_method,
          req.user.id
        ]
      );

      // Record payment
      await db.query(
        `INSERT INTO user_payments (
          user_id, payment_id, amount, currency, payment_method,
          payment_status, transaction_id, plan_id
        ) VALUES (?, ?, ?, ?, ?, 'completed', ?, ?)`,
        [
          req.user.id,
          payment_intent_id,
          plan.price,
          plan.currency,
          payment_method,
          payment_intent_id,
          plan.id
        ]
      );

      // Commit transaction
      await db.query('COMMIT');

      // Send success notification
      await createNotification(
        req.user.id,
        'Subscription Activated!',
        `Your ${plan.plan_name} subscription is now active. Enjoy all premium features!`,
        'subscription_activated',
        {
          plan_name: plan.plan_name,
          amount: plan.price,
          currency: plan.currency,
          billing_period: plan.billing_period
        }
      );

      console.log('✅ Subscription activated for user:', req.user.id);

      res.json({
        success: true,
        message: 'Payment processed successfully',
        subscription: {
          plan: plan.plan_name,
          plan_identifier: plan.plan_identifier,
          status: 'active',
          start_date: subscriptionStartDate,
          end_date: subscriptionEndDate,
          next_billing_date: nextBillingDate
        }
      });

    } catch (error) {
      await db.query('ROLLBACK');
      throw error;
    }

  } catch (error) {
    console.error('❌ Process payment error:', error);
    res.status(500).json({ error: 'Payment processing failed' });
  }
});

// Get user subscription status
app.get('/api/subscription/status', authenticateToken, async (req, res) => {
  try {
    const [users] = await db.query(
      `SELECT 
        subscription_plan,
        subscription_status,
        subscription_start_date,
        subscription_end_date,
        next_billing_date,
        payment_method,
        is_trial,
        trial_end_date
       FROM users WHERE id = ?`,
      [req.user.id]
    );

    if (users.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = users[0];
    const now = new Date();

    // Check if trial expired
    if (user.is_trial && user.trial_end_date && new Date(user.trial_end_date) < now) {
      await db.query(
        'UPDATE users SET is_trial = FALSE, subscription_status = "expired" WHERE id = ?',
        [req.user.id]
      );
      user.is_trial = false;
      user.subscription_status = 'expired';
    }

    // Get plan details if subscribed
    let planDetails = null;
    if (user.subscription_plan && user.subscription_plan !== 'free') {
      const [plans] = await db.query(
        'SELECT * FROM pricing_plans WHERE plan_identifier = ?',
        [user.subscription_plan]
      );
      if (plans.length > 0) {
        planDetails = {
          ...plans[0],
          features: JSON.parse(plans[0].features || '[]')
        };
      }
    }

    res.json({
      success: true,
      subscription: {
        is_trial: user.is_trial,
        trial_end_date: user.trial_end_date,
        trial_days_remaining: user.is_trial && user.trial_end_date
          ? Math.max(0, Math.ceil((new Date(user.trial_end_date) - now) / (1000 * 60 * 60 * 24)))
          : 0,
        plan: user.subscription_plan || 'free',
        status: user.subscription_status || 'inactive',
        start_date: user.subscription_start_date,
        end_date: user.subscription_end_date,
        next_billing_date: user.next_billing_date,
        payment_method: user.payment_method,
        plan_details: planDetails
      }
    });

  } catch (error) {
    console.error('❌ Get subscription status error:', error);
    res.status(500).json({ error: 'Failed to fetch subscription status' });
  }
});

// Cancel subscription
app.post('/api/subscription/cancel', authenticateToken, async (req, res) => {
  try {
    const { reason } = req.body;

    await db.query(
      `UPDATE users SET 
        subscription_status = 'cancelled',
        updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [req.user.id]
    );

    // Log cancellation
    await trackActivity(
      req.user.id,
      'subscription_cancelled',
      'subscription',
      null,
      { reason }
    );

    // Notify user
    await createNotification(
      req.user.id,
      'Subscription Cancelled',
      'Your subscription has been cancelled. You can continue using premium features until the end of your billing period.',
      'subscription_cancelled',
      { reason }
    );

    res.json({
      success: true,
      message: 'Subscription cancelled successfully'
    });

  } catch (error) {
    console.error('❌ Cancel subscription error:', error);
    res.status(500).json({ error: 'Failed to cancel subscription' });
  }
});


// ==================== REFUND PROCESSING ====================

// Process user refund
app.post('/api/admin/users/:userId/refund', authenticateAdmin, async (req, res) => {
  try {
    const { userId } = req.params;
    const { type, value, reason } = req.body;

    if (!type || !value || !reason) {
      return res.status(400).json({ error: 'All refund details are required' });
    }

    // Validate refund type and value
    if (!['amount', 'percent'].includes(type)) {
      return res.status(400).json({ error: 'Invalid refund type' });
    }

    if (type === 'percent' && (value < 0 || value > 100)) {
      return res.status(400).json({ error: 'Percentage must be between 0 and 100' });
    }

    if (type === 'amount' && value < 0) {
      return res.status(400).json({ error: 'Amount must be positive' });
    }

    // Get user information
    const [users] = await db.query(
      'SELECT username, email FROM users WHERE id = ? AND role = "user"',
      [userId]
    );

    if (users.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Insert refund record
    const [result] = await db.query(
      `INSERT INTO refunds (user_id, refund_type, refund_value, reason, processed_by, status) 
       VALUES (?, ?, ?, ?, ?, 'processed')`,
      [userId, type, value, reason, req.user.id]
    );

    await logAdminAction(
      req.user.id,
      'process_refund',
      'user',
      userId,
      { type, value, reason, refundId: result.insertId },
      req
    );

    // Send notification to user
    await createNotification(
      parseInt(userId),
      'Refund Processed',
      `Your refund has been processed. ${type === 'percent' ? value + '% refund' : '$' + value + ' refund'} for: ${reason}`,
      'refund',
      { refundId: result.insertId, type, value }
    );

    res.json({
      success: true,
      message: 'Refund processed successfully',
      refundId: result.insertId
    });

  } catch (error) {
    console.error('❌ Process refund error:', error);
    res.status(500).json({ error: 'Failed to process refund' });
  }
});

// Get user refund history
app.get('/api/admin/users/:userId/refunds', authenticateAdmin, async (req, res) => {
  try {
    const { userId } = req.params;

    const [refunds] = await db.query(`
      SELECT r.*, u.username as processed_by_username
      FROM refunds r
      LEFT JOIN users u ON r.processed_by = u.id
      WHERE r.user_id = ?
      ORDER BY r.created_at DESC
    `, [userId]);

    res.json({
      success: true,
      refunds
    });

  } catch (error) {
    console.error('❌ Get refunds error:', error);
    res.status(500).json({ error: 'Failed to fetch refunds' });
  }
});

// ==================== PRICING PLANS MANAGEMENT ====================

// Get all pricing plans
app.get('/api/admin/pricing-plans', authenticateAdmin, async (req, res) => {
  try {
    const [plans] = await db.query(`
      SELECT pp.*, 
        u1.username as created_by_username,
        u2.username as updated_by_username
      FROM pricing_plans pp
      LEFT JOIN users u1 ON pp.created_by = u1.id
      LEFT JOIN users u2 ON pp.updated_by = u2.id
      ORDER BY pp.sort_order ASC, pp.created_at DESC
    `);

    const processedPlans = plans.map(plan => ({
      ...plan,
      features: plan.features ? JSON.parse(plan.features) : []
    }));

    await logAdminAction(req.user.id, 'view_pricing_plans', null, null, {}, req);

    res.json({
      success: true,
      plans: processedPlans
    });

  } catch (error) {
    console.error('❌ Get pricing plans error:', error);
    res.status(500).json({ error: 'Failed to fetch pricing plans' });
  }
});

// Create pricing plan (creates both monthly and yearly variants)
app.post('/api/admin/pricing-plans', authenticateAdmin, async (req, res) => {
  try {
    const {
      plan_group,
      plan_name,
      description,
      monthly_price,
      yearly_price,
      currency = 'USD',
      features = [],
      is_active = true,
      sort_order = 0
    } = req.body;

    // Validation
    if (!plan_group || !plan_name || !monthly_price || !yearly_price) {
      return res.status(400).json({
        error: 'Plan group, name, monthly price, and yearly price are required'
      });
    }

    if (monthly_price <= 0 || yearly_price <= 0) {
      return res.status(400).json({
        error: 'Prices must be greater than 0'
      });
    }

    // Check if plan group already exists
    const [existingGroup] = await db.query(
      'SELECT plan_group FROM pricing_plans WHERE plan_group = ? LIMIT 1',
      [plan_group]
    );

    if (existingGroup.length > 0) {
      return res.status(400).json({
        error: 'Plan group already exists. Use a different plan group identifier.'
      });
    }

    // Generate plan identifiers
    const monthlyPlanId = `${plan_group}-monthly`;
    const yearlyPlanId = `${plan_group}-yearly`;

    // Start transaction
    await db.query('START TRANSACTION');

    try {
      // Insert monthly plan
      const [monthlyResult] = await db.query(
        `INSERT INTO pricing_plans (
          plan_group, plan_name, plan_identifier, description, price, 
          currency, billing_period, features, is_active, sort_order, 
          created_by, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'monthly', ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
        [
          plan_group,
          plan_name,
          monthlyPlanId,
          description,
          monthly_price,
          currency,
          JSON.stringify(features),
          is_active,
          sort_order,
          req.user.id
        ]
      );

      // Insert yearly plan
      const [yearlyResult] = await db.query(
        `INSERT INTO pricing_plans (
          plan_group, plan_name, plan_identifier, description, price, 
          currency, billing_period, features, is_active, sort_order, 
          created_by, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'yearly', ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
        [
          plan_group,
          plan_name,
          yearlyPlanId,
          description,
          yearly_price,
          currency,
          JSON.stringify(features),
          is_active,
          sort_order + 1, // Yearly plan gets slightly higher sort order
          req.user.id
        ]
      );

      // Commit transaction
      await db.query('COMMIT');

      // Log admin action
      await logAdminAction(
        req.user.id,
        'create_pricing_plan_group',
        'pricing_plan',
        plan_group,
        {
          plan_group,
          plan_name,
          monthly_price,
          yearly_price,
          monthly_plan_id: monthlyResult.insertId,
          yearly_plan_id: yearlyResult.insertId
        },
        req
      );

      res.status(201).json({
        success: true,
        message: 'Pricing plan group created successfully',
        data: {
          plan_group,
          plan_name,
          monthly_plan: {
            id: monthlyResult.insertId,
            plan_identifier: monthlyPlanId,
            price: monthly_price,
            billing_period: 'monthly'
          },
          yearly_plan: {
            id: yearlyResult.insertId,
            plan_identifier: yearlyPlanId,
            price: yearly_price,
            billing_period: 'yearly'
          }
        }
      });

    } catch (insertError) {
      // Rollback transaction on error
      await db.query('ROLLBACK');
      throw insertError;
    }

  } catch (error) {
    console.error('❌ Create pricing plan error:', error);

    // Handle specific database errors
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({
        error: 'Plan identifier already exists'
      });
    }

    res.status(500).json({
      error: 'Failed to create pricing plan group',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Update pricing plan group (updates both monthly and yearly variants)
app.put('/api/admin/pricing-plans/:planId', authenticateAdmin, async (req, res) => {
  try {
    const { planId } = req.params; // This will be the plan_group identifier
    const {
      plan_group,
      plan_name,
      description,
      monthly_price,
      yearly_price,
      currency = 'USD',
      features = [],
      is_active = true,
      sort_order = 0
    } = req.body;

    // Validation
    if (!plan_group || !plan_name || !monthly_price || !yearly_price) {
      return res.status(400).json({
        error: 'Plan group, name, monthly price, and yearly price are required'
      });
    }

    if (monthly_price <= 0 || yearly_price <= 0) {
      return res.status(400).json({
        error: 'Prices must be greater than 0'
      });
    }

    // Check if the plan group exists
    const [existingPlans] = await db.query(
      'SELECT id, plan_identifier, billing_period FROM pricing_plans WHERE plan_group = ?',
      [planId]
    );

    if (existingPlans.length === 0) {
      return res.status(404).json({ error: 'Pricing plan group not found' });
    }

    // Check if new plan_group conflicts with other existing groups (if plan_group is being changed)
    if (plan_group !== planId) {
      const [conflictingGroup] = await db.query(
        'SELECT plan_group FROM pricing_plans WHERE plan_group = ? AND plan_group != ? LIMIT 1',
        [plan_group, planId]
      );

      if (conflictingGroup.length > 0) {
        return res.status(400).json({
          error: 'New plan group identifier already exists for another plan group'
        });
      }
    }

    // Generate new plan identifiers
    const monthlyPlanId = `${plan_group}-monthly`;
    const yearlyPlanId = `${plan_group}-yearly`;

    // Start transaction
    await db.query('START TRANSACTION');

    try {
      // Update monthly plan
      const [monthlyUpdateResult] = await db.query(
        `UPDATE pricing_plans SET 
          plan_group = ?, plan_name = ?, plan_identifier = ?, description = ?, 
          price = ?, currency = ?, features = ?, is_active = ?, 
          sort_order = ?, updated_by = ?, updated_at = CURRENT_TIMESTAMP
         WHERE plan_group = ? AND billing_period = 'monthly'`,
        [
          plan_group,
          plan_name,
          monthlyPlanId,
          description,
          monthly_price,
          currency,
          JSON.stringify(features),
          is_active,
          sort_order,
          req.user.id,
          planId
        ]
      );

      // Update yearly plan
      const [yearlyUpdateResult] = await db.query(
        `UPDATE pricing_plans SET 
          plan_group = ?, plan_name = ?, plan_identifier = ?, description = ?, 
          price = ?, currency = ?, features = ?, is_active = ?, 
          sort_order = ?, updated_by = ?, updated_at = CURRENT_TIMESTAMP
         WHERE plan_group = ? AND billing_period = 'yearly'`,
        [
          plan_group,
          plan_name,
          yearlyPlanId,
          description,
          yearly_price,
          currency,
          JSON.stringify(features),
          is_active,
          sort_order + 1, // Yearly plan gets slightly higher sort order
          req.user.id,
          planId
        ]
      );

      // Check if updates were successful
      if (monthlyUpdateResult.affectedRows === 0 && yearlyUpdateResult.affectedRows === 0) {
        await db.query('ROLLBACK');
        return res.status(404).json({ error: 'No pricing plans were updated' });
      }

      // If plan_group changed, update any users who have this subscription
      if (plan_group !== planId) {
        await db.query(
          'UPDATE users SET subscription_plan = ? WHERE subscription_plan LIKE ?',
          [monthlyPlanId, `${planId}-%`]
        );

        await db.query(
          'UPDATE users SET subscription_plan = ? WHERE subscription_plan LIKE ?',
          [yearlyPlanId, `${planId}-%`]
        );
      }

      // Commit transaction
      await db.query('COMMIT');

      // Get updated plan details
      const [updatedPlans] = await db.query(
        'SELECT id, plan_identifier, price, billing_period FROM pricing_plans WHERE plan_group = ?',
        [plan_group]
      );

      const monthlyPlan = updatedPlans.find(p => p.billing_period === 'monthly');
      const yearlyPlan = updatedPlans.find(p => p.billing_period === 'yearly');

      // Log admin action
      await logAdminAction(
        req.user.id,
        'update_pricing_plan_group',
        'pricing_plan',
        plan_group,
        {
          old_plan_group: planId,
          new_plan_group: plan_group,
          plan_name,
          monthly_price,
          yearly_price,
          monthly_plan_id: monthlyPlan?.id,
          yearly_plan_id: yearlyPlan?.id
        },
        req
      );

      res.json({
        success: true,
        message: 'Pricing plan group updated successfully',
        data: {
          plan_group,
          plan_name,
          monthly_plan: {
            id: monthlyPlan?.id,
            plan_identifier: monthlyPlan?.plan_identifier,
            price: monthlyPlan?.price,
            billing_period: 'monthly'
          },
          yearly_plan: {
            id: yearlyPlan?.id,
            plan_identifier: yearlyPlan?.plan_identifier,
            price: yearlyPlan?.price,
            billing_period: 'yearly'
          }
        }
      });

    } catch (updateError) {
      // Rollback transaction on error
      await db.query('ROLLBACK');
      throw updateError;
    }

  } catch (error) {
    console.error('❌ Update pricing plan error:', error);

    // Handle specific database errors
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({
        error: 'Plan identifier already exists'
      });
    }

    res.status(500).json({
      error: 'Failed to update pricing plan group',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Delete pricing plan group (deletes both monthly and yearly variants)
app.delete('/api/admin/pricing-plans/:planGroup', authenticateAdmin, async (req, res) => {
  try {
    const { planGroup } = req.params;

    console.log('🗑️ Attempting to delete plan group:', planGroup);

    if (!planGroup || planGroup === 'null' || planGroup === 'undefined') {
      return res.status(400).json({ error: 'Invalid plan group identifier' });
    }

    // Get plan info before deletion
    const [plans] = await db.query(
      'SELECT id, plan_name, plan_identifier, plan_group FROM pricing_plans WHERE plan_group = ?',
      [planGroup]
    );

    console.log('📋 Found plans for deletion:', plans);

    if (plans.length === 0) {
      return res.status(404).json({ error: 'Pricing plan group not found' });
    }

    // Check if any plans in this group are in use by users
    const planIdentifiers = plans.map(p => p.plan_identifier);
    const placeholders = planIdentifiers.map(() => '?').join(',');

    const [usersWithPlan] = await db.query(
      `SELECT COUNT(*) as count FROM users WHERE subscription_plan IN (${placeholders})`,
      planIdentifiers
    );

    console.log('👥 Users with this plan:', usersWithPlan[0].count);

    if (usersWithPlan[0].count > 0) {
      return res.status(400).json({
        error: `Cannot delete plan group. ${usersWithPlan[0].count} users are currently subscribed to plans in this group.`
      });
    }

    // Start transaction
    await db.query('START TRANSACTION');

    try {
      // Delete all plans in this group
      const [result] = await db.query('DELETE FROM pricing_plans WHERE plan_group = ?', [planGroup]);

      console.log('🗑️ Deletion result:', result);

      if (result.affectedRows === 0) {
        await db.query('ROLLBACK');
        return res.status(404).json({ error: 'No plans found to delete' });
      }

      // Commit transaction
      await db.query('COMMIT');

      await logAdminAction(
        req.user.id,
        'delete_pricing_plan_group',
        'pricing_plan',
        planGroup,
        {
          plan_group: planGroup,
          plans_deleted: result.affectedRows,
          plan_names: plans.map(p => p.plan_name)
        },
        req
      );

      console.log('✅ Plan group deleted successfully');

      res.json({
        success: true,
        message: `Pricing plan group '${planGroup}' deleted successfully`,
        plans_deleted: result.affectedRows
      });

    } catch (deleteError) {
      await db.query('ROLLBACK');
      throw deleteError;
    }

  } catch (error) {
    console.error('❌ Delete pricing plan group error:', error);
    res.status(500).json({
      error: 'Failed to delete pricing plan group',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Get all pricing plan groups (grouped by plan_group)
app.get('/api/admin/pricing-plans/groups', authenticateAdmin, async (req, res) => {
  try {
    const [plans] = await db.query(`
      SELECT 
        pp.*,
        u1.username as created_by_username,
        u2.username as updated_by_username
      FROM pricing_plans pp
      LEFT JOIN users u1 ON pp.created_by = u1.id
      LEFT JOIN users u2 ON pp.updated_by = u2.id
      WHERE pp.is_active = 1
      ORDER BY pp.plan_group ASC, pp.billing_period ASC
    `);

    // Group plans by plan_group
    const groupedPlans = plans.reduce((acc, plan) => {
      const groupKey = plan.plan_group;

      if (!acc[groupKey]) {
        acc[groupKey] = {
          plan_group: plan.plan_group,
          plan_name: plan.plan_name,
          description: plan.description,
          currency: plan.currency,
          features: plan.features ? JSON.parse(plan.features) : [],
          is_active: plan.is_active,
          sort_order: plan.sort_order,
          created_at: plan.created_at,
          updated_at: plan.updated_at,
          created_by_username: plan.created_by_username,
          updated_by_username: plan.updated_by_username,
          monthly_price: null,
          yearly_price: null,
          monthly_plan_id: null,
          yearly_plan_id: null
        };
      }

      // Add billing period specific data
      if (plan.billing_period === 'monthly') {
        acc[groupKey].monthly_price = plan.price;
        acc[groupKey].monthly_plan_id = plan.id;
      } else if (plan.billing_period === 'yearly') {
        acc[groupKey].yearly_price = plan.price;
        acc[groupKey].yearly_plan_id = plan.id;
      }

      return acc;
    }, {});

    // Convert to array and sort
    const planGroups = Object.values(groupedPlans).sort((a, b) => a.sort_order - b.sort_order);

    await logAdminAction(req.user.id, 'view_pricing_plan_groups', null, null, {}, req);

    res.json({
      success: true,
      planGroups,
      total: planGroups.length
    });

  } catch (error) {
    console.error('❌ Get pricing plan groups error:', error);
    res.status(500).json({ error: 'Failed to fetch pricing plan groups' });
  }
});

// ==================== SUPPORT REQUESTS MANAGEMENT ====================

// ==================== USER SUPPORT ENDPOINTS ====================

// Create support request
app.post('/api/support/create', authenticateToken, async (req, res) => {
  try {
    const { subject, message, category = 'general', priority = 'medium' } = req.body;

    if (!subject || !message) {
      return res.status(400).json({ error: 'Subject and message are required' });
    }

    if (!['low', 'medium', 'high', 'urgent'].includes(priority)) {
      return res.status(400).json({ error: 'Invalid priority level' });
    }

    const [result] = await db.query(
      `INSERT INTO support_requests (user_id, subject, message, category, priority, status) 
       VALUES (?, ?, ?, ?, ?, 'open')`,
      [req.user.id, subject, message, category, priority]
    );

    // Notify admins about new support request
    const [admins] = await db.query('SELECT id FROM users WHERE role IN ("admin", "moderator")');
    
    for (const admin of admins) {
      await createNotification(
        admin.id,
        'New Support Request',
        `${subject} - Priority: ${priority}`,
        'support_request',
        { requestId: result.insertId, priority }
      );
    }

    console.log('✅ Support request created:', result.insertId);

    res.json({
      success: true,
      message: 'Support request submitted successfully',
      request_id: result.insertId
    });

  } catch (error) {
    console.error('❌ Create support request error:', error);
    res.status(500).json({ error: 'Failed to create support request' });
  }
});

// Get user's support requests
app.get('/api/support/my-requests', authenticateToken, async (req, res) => {
  try {
    const { status = 'all' } = req.query;

    let whereClause = 'WHERE user_id = ?';
    const queryParams = [req.user.id];

    if (status !== 'all') {
      whereClause += ' AND status = ?';
      queryParams.push(status);
    }

    const [requests] = await db.query(
      `SELECT 
        id,
        subject,
        message,
        category,
        priority,
        status,
        admin_response,
        created_at,
        updated_at,
        resolved_at
       FROM support_requests 
       ${whereClause}
       ORDER BY 
         CASE priority 
           WHEN 'urgent' THEN 1
           WHEN 'high' THEN 2
           WHEN 'medium' THEN 3
           WHEN 'low' THEN 4
         END,
         created_at DESC`,
      queryParams
    );

    res.json({
      success: true,
      requests
    });

  } catch (error) {
    console.error('❌ Get user support requests error:', error);
    res.status(500).json({ error: 'Failed to fetch support requests' });
  }
});

// Get single support request
app.get('/api/support/requests/:requestId', authenticateToken, async (req, res) => {
  try {
    const { requestId } = req.params;

    const [requests] = await db.query(
      `SELECT * FROM support_requests WHERE id = ? AND user_id = ?`,
      [requestId, req.user.id]
    );

    if (requests.length === 0) {
      return res.status(404).json({ error: 'Support request not found' });
    }

    res.json({
      success: true,
      request: requests[0]
    });

  } catch (error) {
    console.error('❌ Get support request error:', error);
    res.status(500).json({ error: 'Failed to fetch support request' });
  }
});

// Request refund
app.post('/api/support/refund-request', authenticateToken, async (req, res) => {
  try {
    const { reason, order_details = '' } = req.body;

    if (!reason) {
      return res.status(400).json({ error: 'Refund reason is required' });
    }

    // Get user's subscription info
    const [users] = await db.query(
      'SELECT subscription_plan, email, username FROM users WHERE id = ?',
      [req.user.id]
    );

    if (users.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = users[0];

    if (!user.subscription_plan || user.subscription_plan === 'free') {
      return res.status(400).json({ 
        error: 'No active subscription found. Refunds are only available for paid subscriptions.' 
      });
    }

    // Create support request for refund
    const subject = 'Refund Request';
    const message = `Refund Request\n\nReason: ${reason}\n\nOrder Details: ${order_details}\n\nSubscription Plan: ${user.subscription_plan}`;

    const [result] = await db.query(
      `INSERT INTO support_requests (user_id, subject, message, category, priority, status) 
       VALUES (?, ?, ?, 'refund', 'high', 'open')`,
      [req.user.id, subject, message]
    );

    // Notify admins
    const [admins] = await db.query('SELECT id FROM users WHERE role IN ("admin", "moderator")');
    
    for (const admin of admins) {
      await createNotification(
        admin.id,
        'Refund Request',
        `User ${user.username} requested a refund`,
        'refund_request',
        { requestId: result.insertId, userId: req.user.id }
      );
    }

    // Notify user
    await createNotification(
      req.user.id,
      'Refund Request Received',
      'Your refund request has been submitted. Our team will review it and respond within 24-48 hours.',
      'refund_request',
      { requestId: result.insertId }
    );

    console.log('✅ Refund request created:', result.insertId);

    res.json({
      success: true,
      message: 'Refund request submitted successfully. You will receive a response within 24-48 hours.',
      request_id: result.insertId
    });

  } catch (error) {
    console.error('❌ Refund request error:', error);
    res.status(500).json({ error: 'Failed to submit refund request' });
  }
});

// Get all support requests
app.get('/api/admin/support-requests', authenticateAdmin, async (req, res) => {
  try {
    const {
      status = 'all',
      priority = 'all',
      page = 1,
      limit = 20
    } = req.query;

    let whereClause = 'WHERE 1=1';
    let queryParams = [];

    if (status !== 'all') {
      whereClause += ' AND sr.status = ?';
      queryParams.push(status);
    }

    if (priority !== 'all') {
      whereClause += ' AND sr.priority = ?';
      queryParams.push(priority);
    }

    const offset = (page - 1) * limit;

    const [requests] = await db.query(`
      SELECT 
        sr.*,
        u.username,
        u.email,
        a.username as assigned_to_username
      FROM support_requests sr
      JOIN users u ON sr.user_id = u.id
      LEFT JOIN users a ON sr.assigned_to = a.id
      ${whereClause}
      ORDER BY 
        CASE sr.priority 
          WHEN 'urgent' THEN 1
          WHEN 'high' THEN 2  
          WHEN 'medium' THEN 3
          WHEN 'low' THEN 4
        END,
        sr.created_at DESC
      LIMIT ? OFFSET ?
    `, [...queryParams, parseInt(limit), parseInt(offset)]);

    const [totalCount] = await db.query(`
      SELECT COUNT(*) as total FROM support_requests sr ${whereClause}
    `, queryParams);

    await logAdminAction(req.user.id, 'view_support_requests', null, null, { status, priority }, req);

    res.json({
      success: true,
      requests,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: totalCount[0].total,
        totalPages: Math.ceil(totalCount[0].total / limit)
      }
    });

  } catch (error) {
    console.error('❌ Get support requests error:', error);
    res.status(500).json({ error: 'Failed to fetch support requests' });
  }
});

// Get support request by ID
app.get('/api/admin/support-requests/:requestId', authenticateAdmin, async (req, res) => {
  try {
    const { requestId } = req.params;

    const [requests] = await db.query(`
      SELECT 
        sr.*,
        u.username,
        u.email,
        u.created_at as user_joined,
        a.username as assigned_to_username
      FROM support_requests sr
      JOIN users u ON sr.user_id = u.id
      LEFT JOIN users a ON sr.assigned_to = a.id
      WHERE sr.id = ?
    `, [requestId]);

    if (requests.length === 0) {
      return res.status(404).json({ error: 'Support request not found' });
    }

    await logAdminAction(req.user.id, 'view_support_request', 'support_request', requestId, {}, req);

    res.json({
      success: true,
      request: requests[0]
    });

  } catch (error) {
    console.error('❌ Get support request error:', error);
    res.status(500).json({ error: 'Failed to fetch support request' });
  }
});

// Update support request (respond)
app.put('/api/admin/support-requests/:requestId', authenticateAdmin, async (req, res) => {
  try {
    const { requestId } = req.params;
    const { admin_response, status, priority, assigned_to } = req.body;

    // Check if request exists
    const [existingRequest] = await db.query(
      'SELECT user_id, subject FROM support_requests WHERE id = ?',
      [requestId]
    );

    if (existingRequest.length === 0) {
      return res.status(404).json({ error: 'Support request not found' });
    }

    const updateData = {
      updated_at: 'CURRENT_TIMESTAMP'
    };
    const updateParams = [];
    const updateFields = [];

    if (admin_response !== undefined) {
      updateFields.push('admin_response = ?');
      updateParams.push(admin_response);
    }

    if (status !== undefined) {
      updateFields.push('status = ?');
      updateParams.push(status);

      if (status === 'resolved' || status === 'closed') {
        updateFields.push('resolved_at = CURRENT_TIMESTAMP');
      }
    }

    if (priority !== undefined) {
      updateFields.push('priority = ?');
      updateParams.push(priority);
    }

    if (assigned_to !== undefined) {
      updateFields.push('assigned_to = ?');
      updateParams.push(assigned_to === '' ? null : assigned_to);
    }

    if (updateFields.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    const [result] = await db.query(
      `UPDATE support_requests SET ${updateFields.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [...updateParams, requestId]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Support request not found' });
    }

    // Send notification to user if there's a response
    if (admin_response && admin_response.trim()) {
      await createNotification(
        existingRequest[0].user_id,
        'Support Response',
        `We've responded to your support request: "${existingRequest[0].subject}"`,
        'support_response',
        {
          requestId: parseInt(requestId),
          response: admin_response.substring(0, 200) + (admin_response.length > 200 ? '...' : '')
        }
      );
    }

    await logAdminAction(
      req.user.id,
      'update_support_request',
      'support_request',
      requestId,
      { status, admin_response: !!admin_response },
      req
    );

    res.json({
      success: true,
      message: 'Support request updated successfully'
    });

  } catch (error) {
    console.error('❌ Update support request error:', error);
    res.status(500).json({ error: 'Failed to update support request' });
  }
});

// Assign support request to admin
app.put('/api/admin/support-requests/:requestId/assign', authenticateAdmin, async (req, res) => {
  try {
    const { requestId } = req.params;
    const { admin_id } = req.body;

    const [result] = await db.query(
      'UPDATE support_requests SET assigned_to = ?, status = "in_progress", updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [admin_id || null, requestId]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Support request not found' });
    }

    await logAdminAction(
      req.user.id,
      'assign_support_request',
      'support_request',
      requestId,
      { assigned_to: admin_id },
      req
    );

    res.json({
      success: true,
      message: admin_id ? 'Support request assigned successfully' : 'Support request unassigned successfully'
    });

  } catch (error) {
    console.error('❌ Assign support request error:', error);
    res.status(500).json({ error: 'Failed to assign support request' });
  }
});

// Get support statistics
app.get('/api/admin/support-stats', authenticateAdmin, async (req, res) => {
  try {
    const [stats] = await db.query(`
      SELECT 
        COUNT(*) as total_requests,
        COUNT(CASE WHEN status = 'open' THEN 1 END) as open_requests,
        COUNT(CASE WHEN status = 'in_progress' THEN 1 END) as in_progress_requests,
        COUNT(CASE WHEN status = 'resolved' THEN 1 END) as resolved_requests,
        COUNT(CASE WHEN status = 'closed' THEN 1 END) as closed_requests,
        COUNT(CASE WHEN priority = 'urgent' THEN 1 END) as urgent_requests,
        COUNT(CASE WHEN priority = 'high' THEN 1 END) as high_priority_requests,
        COUNT(CASE WHEN created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR) THEN 1 END) as requests_today,
        COUNT(CASE WHEN created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY) THEN 1 END) as requests_this_week,
        AVG(CASE 
          WHEN resolved_at IS NOT NULL 
          THEN TIMESTAMPDIFF(HOUR, created_at, resolved_at) 
          ELSE NULL 
        END) as avg_resolution_time_hours
      FROM support_requests
    `);

    res.json({
      success: true,
      stats: stats[0]
    });

  } catch (error) {
    console.error('❌ Get support stats error:', error);
    res.status(500).json({ error: 'Failed to fetch support statistics' });
  }
});

const initializeDatabaseWithAdmin = async () => {
  await initializeDatabase();
  await initializeAdminTables();
  await initializeRefundsAndSupportTables();
};




// ==================== ADMIN PANEL EXPORTS ====================


// Export functions for testing
module.exports = {
  performOCR,
  preprocessImage,
  cleanExtractedText,
  processTextIntoPages,
  updateDatabaseSchema,
  initializeDatabase,
  startServer,
  extractUrlContent,
  parseHtmlContent,
  initializeFirebase,
  initializeNotificationTables,
  createNotification,
  sendPushNotification,
  sendDocumentUploadNotification,
  sendOCRCompletionNotification,
  initializeStatisticsTables,
  trackActivity,
  startReadingSession,
  updateReadingSession,
  endReadingSession,
  getUserStatistics,
  getUserInsights,
  getUserAchievements,
  checkAchievements,

  authenticateAdmin,
  logAdminAction,
  initializeAdminTables
};

// Start the server
startServer();