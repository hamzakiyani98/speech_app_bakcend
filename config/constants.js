require('dotenv').config();
const path = require('path');

// JWT configuration
const JWT_SECRET = process.env.JWT_SECRET || 'your_jwt_secret_change_in_production';

// File paths
const ADS_IMAGES_DIR = path.join(__dirname, '..', 'public', 'ads-images');

// Upload limits
const UPLOAD_LIMITS = {
  DOCUMENT: 10 * 1024 * 1024, // 10MB
  AD_IMAGE: 5 * 1024 * 1024,  // 5MB
  JSON_BODY: 50 * 1024 * 1024 // 50MB
};

// Allowed file types
const ALLOWED_TYPES = {
  DOCUMENTS: [
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
    'video/mp4'
  ],
  AD_IMAGES: [
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp'
  ]
};

// OCR Configuration
const OCR_LIMITS = {
  FREE: {
    DAILY: 0,
    MONTHLY: 0
  },
  TRIAL: {
    DAILY: 5,
    MONTHLY: 150
  },
  PREMIUM: {
    DAILY: 300,
    MONTHLY: 9000
  }
};

module.exports = {
  JWT_SECRET,
  ADS_IMAGES_DIR,
  UPLOAD_LIMITS,
  ALLOWED_TYPES,
  OCR_LIMITS
};
