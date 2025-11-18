const { openai } = require('../config/services');
const os = require('os');

// OpenAI Helper Functions
const callOpenAI = async (prompt, systemMessage = null, maxTokens = 1000) => {
  try {
    const messages = [];

    if (systemMessage) {
      messages.push({ role: 'system', content: systemMessage });
    }

    messages.push({ role: 'user', content: prompt });

    const response = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: messages,
      max_tokens: maxTokens,
      temperature: 0.7,
    });

    return response.choices[0].message.content.trim();
  } catch (error) {
    console.error('OpenAI API Error:', error);
    throw new Error('AI processing failed: ' + error.message);
  }
};

// AI Processing Functions
const summarizeText = async (text, selectedText = null) => {
  const textToSummarize = selectedText || text;
  const systemMessage = "You are a helpful assistant that creates concise, accurate summaries. Focus on the main points and key information.";

  const prompt = `Please provide a comprehensive summary of the following text. Include the main points, key insights, and important details:

${textToSummarize}

Summary:`;

  return await callOpenAI(prompt, systemMessage, 500);
};

const extractActionPoints = async (text, selectedText = null) => {
  const textToAnalyze = selectedText || text;
  const systemMessage = "You are a business analyst that extracts actionable items and tasks from documents. Focus on specific, measurable actions.";

  const prompt = `Analyze the following text and extract specific action points, tasks, and next steps. Format them as a numbered list:

${textToAnalyze}

Action Points:`;

  return await callOpenAI(prompt, systemMessage, 600);
};

const getDecisionSupport = async (text, selectedText = null, context = '') => {
  const textToAnalyze = selectedText || text;
  const systemMessage = "You are a strategic advisor that helps with decision-making by analyzing information and providing insights.";

  const prompt = `Based on the following document content, provide decision support and recommendations. Consider the context: ${context}

Document content:
${textToAnalyze}

Please provide:
1. Key considerations
2. Potential risks and opportunities
3. Recommended actions
4. Alternative approaches

Decision Support:`;

  return await callOpenAI(prompt, systemMessage, 800);
};

const translateText = async (text, targetLanguage, selectedText = null) => {
  const textToTranslate = selectedText || text;
  const systemMessage = `You are a professional translator. Translate the following text to ${targetLanguage} while maintaining the original meaning and context.`;

  const prompt = `Translate the following text to ${targetLanguage}:

${textToTranslate}

Translation:`;

  return await callOpenAI(prompt, systemMessage, Math.min(textToTranslate.length * 2, 2000));
};

// Network interface helper
function getNetworkInterfaces() {
  const interfaces = os.networkInterfaces();
  const addresses = [];

  for (const name of Object.keys(interfaces)) {
    for (const interface of interfaces[name]) {
      if (interface.family === 'IPv4' && !interface.internal) {
        addresses.push({
          name: name,
          address: interface.address
        });
      }
    }
  }
  return addresses;
}

module.exports = {
  callOpenAI,
  summarizeText,
  extractActionPoints,
  getDecisionSupport,
  translateText,
  getNetworkInterfaces
};
