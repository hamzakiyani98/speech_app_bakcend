const pdf = require('pdf-parse');
const mammoth = require('mammoth');

// File extraction functions
const extractTextFromPDF = async (buffer) => {
  try {
    const data = await pdf(buffer);
    const pageContent = data.text.split('\n\n').filter(page => page.trim().length > 0);
    return {
      text: data.text,
      pages: data.numpages,
      pageContent: pageContent
    };
  } catch (error) {
    throw new Error('PDF extraction failed: ' + error.message);
  }
};

const extractTextFromDOCX = async (buffer) => {
  try {
    const result = await mammoth.extractRawText({ buffer });
    const text = result.value;
    const pageContent = text.split('\n\n').filter(page => page.trim().length > 0);
    return {
      text: text,
      pages: pageContent.length,
      pageContent: pageContent
    };
  } catch (error) {
    throw new Error('DOCX extraction failed: ' + error.message);
  }
};

const extractTextFromTXT = async (buffer) => {
  try {
    const text = buffer.toString('utf-8');
    const pageContent = text.split('\n\n').filter(page => page.trim().length > 0);
    return {
      text: text,
      pages: pageContent.length,
      pageContent: pageContent
    };
  } catch (error) {
    throw new Error('TXT extraction failed: ' + error.message);
  }
};

const extractFileContent = async (file) => {
  const { buffer, mimetype } = file;

  switch (mimetype) {
    case 'application/pdf':
      return await extractTextFromPDF(buffer);
    case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
    case 'application/msword':
      return await extractTextFromDOCX(buffer);
    case 'text/plain':
      return await extractTextFromTXT(buffer);
    default:
      throw new Error('Unsupported file type');
  }
};

module.exports = {
  extractTextFromPDF,
  extractTextFromDOCX,
  extractTextFromTXT,
  extractFileContent
};
