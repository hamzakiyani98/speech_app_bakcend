const { admin, firebaseApp } = require('../config/services');
const { db } = require('../config/database');

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

module.exports = {
  sendPushNotification,
  removeInvalidDeviceTokens,
  createNotification,
  sendDocumentUploadNotification,
  sendOCRCompletionNotification
};
