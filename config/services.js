const OpenAI = require('openai');
const { TextToSpeechClient } = require('@google-cloud/text-to-speech');
const nodemailer = require('nodemailer');
const admin = require('firebase-admin');
const path = require('path');
const fs = require('fs-extra');
require('dotenv').config();

// Initialize OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Email transporter configuration
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

// Check if service account file exists
const serviceAccountPath = path.join(__dirname, '..', 'service-account-key.json');

// Initialize Google TTS client with explicit credentials
let ttsClient;
try {
  if (fs.existsSync(serviceAccountPath)) {
    ttsClient = new TextToSpeechClient({
      keyFilename: serviceAccountPath,
      projectId: 'custom-point-463612-v5',
    });
    console.log('✅ Google TTS Client initialized successfully');
  } else {
    console.error('❌ Service account key file not found at:', serviceAccountPath);
    console.error('📋 Please ensure your service-account-key.json file is in the root directory');
  }
} catch (error) {
  console.error('❌ Failed to initialize Google TTS Client:', error);
}

// Firebase initialization
let firebaseApp = null;

const initializeFirebase = () => {
  try {
    // Check if service account file exists
    const serviceAccountPath2 = path.join(__dirname, '..', 'service-account-key2.json');

    if (!fs.existsSync(serviceAccountPath2)) {
      console.error('❌ Service account key file not found at:', serviceAccountPath2);
      console.error('📋 Please ensure your service-account-key.json file is in the root directory');
      return false;
    }

    // Read and parse service account
    const serviceAccount = require(serviceAccountPath2);

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

module.exports = {
  openai,
  ttsClient,
  emailTransporter,
  admin,
  firebaseApp,
  initializeFirebase
};
