// Documents Controller
// This controller handles all document-related operations including:
// - Document upload (file, camera/OCR, text, URL)
// - OCR processing and quota management
// - AI-powered document analysis (summarization, action points, translation, etc.)
// - URL content extraction

// ==================== IMPORTS ====================
const mysql = require('mysql2/promise');
const OpenAI = require('openai');
const Tesseract = require('tesseract.js');
const sharp = require('sharp');
const path = require('path');
require('dotenv').config();

// Initialize OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
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

// ==================== HELPER FUNCTIONS ====================
// Note: These helper functions are referenced from server.js
// They should be moved to a separate utils file or imported from server.js
// For now, they are referenced as external dependencies

// External helper functions that need to be imported:
// - getBasePlanType(subscriptionPlan)
// - getOCREngine(userId)
// - checkOCRQuota(userId, userPlan)
// - performGoogleOCR(imageBuffer, options)
// - performOCR(imageBuffer, options)
// - getImageDimensions(buffer)
// - cleanExtractedText(text)
// - processTextIntoPages(text)
// - extractFileContent(file)
// - sendDocumentUploadNotification(userId, title, documentId, status)
// - sendOCRCompletionNotification(userId, title, confidence, documentId)
// - trackActivity(userId, activityType, entityType, entityId, data)
// - callOpenAI(prompt, systemMessage, maxTokens)
// - extractUrlContent(url)

// Placeholder references (these should be imported from utils or server.js)
let getBasePlanType, getOCREngine, checkOCRQuota, performGoogleOCR, performOCR;
let getImageDimensions, cleanExtractedText, processTextIntoPages, extractFileContent;
let sendDocumentUploadNotification, sendOCRCompletionNotification, trackActivity;
let callOpenAI, extractUrlContent;

// Helper function to set dependencies (called from server.js)
const setHelpers = (helpers) => {
  getBasePlanType = helpers.getBasePlanType;
  getOCREngine = helpers.getOCREngine;
  checkOCRQuota = helpers.checkOCRQuota;
  performGoogleOCR = helpers.performGoogleOCR;
  performOCR = helpers.performOCR;
  getImageDimensions = helpers.getImageDimensions;
  cleanExtractedText = helpers.cleanExtractedText;
  processTextIntoPages = helpers.processTextIntoPages;
  extractFileContent = helpers.extractFileContent;
  sendDocumentUploadNotification = helpers.sendDocumentUploadNotification;
  sendOCRCompletionNotification = helpers.sendOCRCompletionNotification;
  trackActivity = helpers.trackActivity;
  callOpenAI = helpers.callOpenAI;
  extractUrlContent = helpers.extractUrlContent;
};

// ==================== CONTROLLER FUNCTIONS ====================

/**
 * Upload Document (POST /api/documents)
 * Handles file upload, camera/OCR, text, and URL document creation
 * Lines 998-1262 from server.js
 */
const uploadDocument = async (req, res) => {
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
};

/**
 * Get OCR Quota Info (GET /api/ocr/quota-info)
 * Returns OCR usage quota information for the authenticated user
 * Lines 1725-1796 from server.js
 */
const getOCRQuotaInfo = async (req, res) => {
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
};

/**
 * Get OCR Usage (GET /api/ocr/usage)
 * Returns OCR usage statistics for the authenticated user
 * Lines 1798-1852 from server.js
 */
const getOCRUsage = async (req, res) => {
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
};

/**
 * Get Documents (GET /api/documents)
 * Returns all documents for the authenticated user
 * Lines 1884-1895 from server.js
 */
const getDocuments = async (req, res) => {
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
};

/**
 * Get Document By ID (GET /api/documents/:id)
 * Returns a specific document with full details including OCR metadata
 * Lines 1898-1950 from server.js
 */
const getDocumentById = async (req, res) => {
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
};

/**
 * Get Document OCR Status (GET /api/documents/:id/ocr-status)
 * Returns OCR processing status for a specific document
 * Lines 1953-1976 from server.js
 */
const getDocumentOCRStatus = async (req, res) => {
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
};

/**
 * Reprocess OCR (POST /api/documents/:id/reprocess-ocr)
 * Reprocesses OCR for a document with a new image
 * Lines 1979-2065 from server.js
 */
const reprocessOCR = async (req, res) => {
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
};

/**
 * Get User OCR Stats (GET /api/user/ocr-stats)
 * Returns OCR statistics for the authenticated user
 * Lines 2068-2085 from server.js
 */
const getUserOCRStats = async (req, res) => {
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
};

/**
 * Summarize Document (POST /api/documents/:id/summarize)
 * Generates an AI-powered summary of the document
 * Lines 2089-2180 from server.js
 */
const summarizeDocument = async (req, res) => {
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
};

/**
 * Extract Action Points (POST /api/documents/:id/action-points)
 * Extracts actionable items from the document using AI
 * Lines 2183-2273 from server.js
 */
const extractActionPoints = async (req, res) => {
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
};

/**
 * Get Decision Making (POST /api/documents/:id/decision-making)
 * Provides AI-powered decision support based on document content
 * Lines 2276-2363 from server.js
 */
const getDecisionMaking = async (req, res) => {
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
};

/**
 * Translate Document (POST /api/documents/:id/translate)
 * Translates document content to a target language
 * Lines 2366-2463 from server.js
 */
const translateDocument = async (req, res) => {
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
};

/**
 * Process Voice Command (POST /api/documents/:id/voice-command)
 * Processes voice commands for document operations
 * Lines 2465-2499 from server.js
 */
const processVoiceCommand = async (req, res) => {
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
};

/**
 * Extract URL (POST /api/extract-url)
 * Extracts content from a single URL
 * Lines 3931-3958 from server.js
 */
const extractUrl = async (req, res) => {
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
};

/**
 * Extract Multiple URLs (POST /api/extract-multiple-urls)
 * Extracts content from multiple URLs in batch
 * Lines 3961-4017 from server.js
 */
const extractMultipleUrls = async (req, res) => {
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
};

/**
 * Create Document From URL (POST /api/documents/from-url)
 * Creates a document directly from URL content
 * Lines 4021-4105 from server.js
 */
const createDocumentFromUrl = async (req, res) => {
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
};

// ==================== EXPORTS ====================
module.exports = {
  uploadDocument,
  getOCRQuotaInfo,
  getOCRUsage,
  getDocuments,
  getDocumentById,
  getDocumentOCRStatus,
  reprocessOCR,
  getUserOCRStats,
  summarizeDocument,
  extractActionPoints,
  getDecisionMaking,
  translateDocument,
  processVoiceCommand,
  extractUrl,
  extractMultipleUrls,
  createDocumentFromUrl,
  setHelpers // Export setHelpers so it can be called from server.js to inject dependencies
};
