const { db } = require('../config/database');
const fs = require('fs-extra');
const path = require('path');
const sharp = require('sharp');
const { ADS_IMAGES_DIR } = require('../config/constants');
const { logAdminAction } = require('../utils/adminLogger');

// Get all ads (admin)
const getAds = async (req, res) => {
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
};

// Create new ad
const createAd = async (req, res) => {
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
};

// Update ad
const updateAd = async (req, res) => {
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
};

// Delete ad
const deleteAd = async (req, res) => {
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
};

// Get all active ads (for full-screen random display)
const getAllActiveAds = async (req, res) => {
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
};

// Get ads for specific page (for mobile app)
const getAdsByPage = async (req, res) => {
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
};

// Get available subscription plans for ad targeting
const getSubscriptionPlans = async (req, res) => {
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
};

// Upload advertisement image
const uploadAdImage = async (req, res) => {
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
};

// Delete advertisement image
const deleteAdImage = async (req, res) => {
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
};

// Update ad impression count
const trackAdImpression = async (req, res) => {
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
};

// Update ad click count
const trackAdClick = async (req, res) => {
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
};

module.exports = {
  getAds,
  createAd,
  updateAd,
  deleteAd,
  getAllActiveAds,
  getAdsByPage,
  getSubscriptionPlans,
  uploadAdImage,
  deleteAdImage,
  trackAdImpression,
  trackAdClick
};
