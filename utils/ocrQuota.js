const db = require('../config/database');
const path = require('path');

// ==================== HELPER FUNCTIONS ====================

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

// ==================== MAIN FUNCTIONS ====================

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

// ==================== EXPORTS ====================

module.exports = {
  getBasePlanType,
  getOCREngine,
  checkOCRQuota,
  trackOCRUsage,
  performGoogleOCR
};
