const { db } = require('../config/database');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { JWT_SECRET } = require('../config/constants');
const { generateOTP, sendOTPEmail } = require('../utils/email');
const { createNotification } = require('../utils/notifications');

// Signup
const signup = async (req, res) => {
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
};

// Login
const login = async (req, res) => {
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
};

// Request OTP for signup
const requestSignupOTP = async (req, res) => {
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
};

// Request OTP for login
const requestLoginOTP = async (req, res) => {
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
};

// Verify OTP and complete signup
const verifySignupOTP = async (req, res) => {
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
};

// Verify OTP and complete login
const verifyLoginOTP = async (req, res) => {
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
};

// Resend OTP
const resendOTP = async (req, res) => {
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
};

module.exports = {
  signup,
  login,
  requestSignupOTP,
  requestLoginOTP,
  verifySignupOTP,
  verifyLoginOTP,
  resendOTP
};
