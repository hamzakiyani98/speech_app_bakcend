const express = require('express');
const router = express.Router();
const {
  signup,
  login,
  requestSignupOTP,
  requestLoginOTP,
  verifySignupOTP,
  verifyLoginOTP,
  resendOTP
} = require('../controllers/authController');

// Basic authentication routes
router.post('/signup', signup);
router.post('/login', login);

// OTP-based authentication routes
router.post('/auth/signup/request-otp', requestSignupOTP);
router.post('/auth/login/request-otp', requestLoginOTP);
router.post('/auth/signup/verify-otp', verifySignupOTP);
router.post('/auth/login/verify-otp', verifyLoginOTP);
router.post('/auth/resend-otp', resendOTP);

module.exports = router;
