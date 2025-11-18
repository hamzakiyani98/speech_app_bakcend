const multer = require('multer');
const { UPLOAD_LIMITS, ALLOWED_TYPES } = require('../config/constants');

// Multer configuration for document uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: UPLOAD_LIMITS.DOCUMENT },
  fileFilter: (req, file, cb) => {
    if (ALLOWED_TYPES.DOCUMENTS.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type'));
    }
  }
});

// Multer configuration for advertisement images
const uploadAdImage = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: UPLOAD_LIMITS.AD_IMAGE },
  fileFilter: (req, file, cb) => {
    if (ALLOWED_TYPES.AD_IMAGES.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only JPEG, PNG, GIF, and WebP are allowed.'));
    }
  }
});

module.exports = {
  upload,
  uploadAdImage
};
