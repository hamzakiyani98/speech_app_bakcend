const nodemailer = require('nodemailer');
const { emailTransporter } = require('../config/services');

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

module.exports = {
  generateOTP,
  sendOTPEmail
};
