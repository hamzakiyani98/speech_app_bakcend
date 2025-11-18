const Tesseract = require('tesseract.js');
const sharp = require('sharp');

const preprocessImage = async (buffer) => {
  try {
    console.log('📸 Preprocessing image for OCR...');

    // Validate buffer
    if (!buffer || buffer.length === 0) {
      throw new Error('Invalid image buffer');
    }

    // Get image metadata
    const metadata = await sharp(buffer).metadata();
    console.log('Image metadata:', {
      width: metadata.width,
      height: metadata.height,
      format: metadata.format,
      size: Math.round(buffer.length / 1024) + 'KB'
    });

    // Process image for better OCR results
    const processedBuffer = await sharp(buffer)
      .resize({
        width: Math.min(metadata.width || 2000, 2000),
        height: Math.min(metadata.height || 2000, 2000),
        fit: 'inside',
        withoutEnlargement: true
      })
      .grayscale()
      .normalize()
      .sharpen()
      .jpeg({ quality: 95 })
      .toBuffer();

    console.log('✅ Image preprocessed successfully');
    return processedBuffer;

  } catch (error) {
    console.error('❌ Image preprocessing error:', error);
    throw new Error('Failed to preprocess image: ' + error.message);
  }
};

// Enhanced OCR function with better text extraction
const performOCR = async (imageBuffer, options = {}) => {
  try {
    console.log('🔍 Starting OCR process...');

    // Validate input
    if (!imageBuffer || imageBuffer.length === 0) {
      throw new Error('Invalid image buffer provided');
    }

    const startTime = Date.now();

    // Preprocess image for better OCR results
    const processedBuffer = await preprocessImage(imageBuffer);

    // OCR configuration for better accuracy
    const ocrOptions = {
      lang: options.language || 'eng',
      logger: m => {
        if (m.status === 'recognizing text') {
          console.log(`OCR Progress: ${Math.round(m.progress * 100)}%`);
        }
      }
    };

    console.log(`Starting Tesseract OCR with language: ${ocrOptions.lang}`);

    // Perform OCR with proper error handling
    let ocrResult;
    try {
      ocrResult = await Tesseract.recognize(processedBuffer, ocrOptions.lang, {
        logger: ocrOptions.logger,
      });
    } catch (tesseractError) {
      console.error('Tesseract OCR error:', tesseractError);
      throw new Error('OCR engine failed: ' + tesseractError.message);
    }

    const processingTime = Date.now() - startTime;

    // Extract and clean text
    const extractedText = ocrResult.data.text ? ocrResult.data.text.trim() : '';

    if (!extractedText) {
      console.warn('⚠️ No text extracted from image');
    }

    // Get confidence score
    const confidence = ocrResult.data.confidence || 0;

    // Extract additional data
    const words = ocrResult.data.words || [];
    const lines = ocrResult.data.lines || [];
    const paragraphs = ocrResult.data.paragraphs || [];

    // Process text into readable format
    const processedText = cleanExtractedText(extractedText);
    const pageContent = processTextIntoPages(processedText);

    console.log('✅ OCR completed successfully:', {
      processingTime: processingTime + 'ms',
      confidence: Math.round(confidence) + '%',
      textLength: processedText.length,
      wordsFound: words.length,
      linesFound: lines.length
    });

    return {
      text: processedText,
      pageContent: pageContent,
      totalPages: pageContent.length,
      confidence: confidence,
      metadata: {
        processingTime,
        wordsFound: words.length,
        linesFound: lines.length,
        paragraphsFound: paragraphs.length,
        ocrEngine: 'Tesseract.js',
        language: ocrOptions.lang
      },
      rawData: {
        words: words.map(word => ({
          text: word.text,
          confidence: word.confidence,
          bbox: word.bbox
        })),
        lines: lines.map(line => ({
          text: line.text,
          confidence: line.confidence,
          bbox: line.bbox
        }))
      }
    };

  } catch (error) {
    console.error('❌ OCR processing error:', error);
    throw new Error('OCR processing failed: ' + error.message);
  }
};


// Clean and format extracted text
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

const getImageDimensions = async (buffer) => {
  try {
    const metadata = await sharp(buffer).metadata();
    return {
      width: metadata.width,
      height: metadata.height,
      format: metadata.format
    };
  } catch (error) {
    console.error('Error getting image dimensions:', error);
    return null;
  }
};

module.exports = {
  preprocessImage,
  performOCR,
  cleanExtractedText,
  processTextIntoPages,
  getImageDimensions
};
