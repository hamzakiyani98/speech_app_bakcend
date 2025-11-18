const { openai } = require('../config/services');
const { db } = require('../config/database');

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

const generateChatbotResponse = async (userMessage, documentContent, documentTitle, chatHistory) => {
  try {
    const intent = analyzeUserIntent(userMessage);

    const historyContext = chatHistory.slice(-6).map(msg =>
      `${msg.sender}: ${msg.message}`
    ).join('\n');

    let systemMessage = '';
    let prompt = '';
    let responseType = 'text';
    let metadata = {};

    switch (intent.type) {
      case 'summary':
        systemMessage = `You are a helpful document assistant. You provide clear, concise summaries of document content. Focus on the main points and key information.`;

        prompt = `Document Title: "${documentTitle}"

Chat History:
${historyContext}

User's Request: ${userMessage}

Document Content:
${documentContent.substring(0, 8000)}

Please provide a summary based on the user's specific request. If they asked for a particular type of summary or focus area, tailor your response accordingly.`;

        responseType = 'summary';
        metadata = { action: 'summarize', focus: intent.details.focus };
        break;

      case 'question':
        systemMessage = `You are a knowledgeable document assistant. Answer questions accurately based on the document content. If the answer isn't in the document, say so clearly. Be conversational and helpful.`;

        prompt = `Document Title: "${documentTitle}"

Chat History:
${historyContext}

User's Question: ${userMessage}

Document Content:
${documentContent.substring(0, 8000)}

Please answer the user's question based on the document content. Be specific and cite relevant parts when possible.`;

        responseType = 'answer';
        metadata = { action: 'question_answer', question: userMessage };
        break;

      case 'translation':
        const targetLang = intent.details.language || 'Spanish';
        systemMessage = `You are a professional translator. Translate the requested content accurately while maintaining context and meaning.`;

        prompt = `User wants to translate content to ${targetLang}.

Request: ${userMessage}

Document Content:
${documentContent.substring(0, 6000)}

Please translate the requested content to ${targetLang}. If no specific part was mentioned, provide a brief translated summary.`;

        responseType = 'translation';
        metadata = { action: 'translate', target_language: targetLang };
        break;

      case 'action_items':
        systemMessage = `You are a business analyst. Extract actionable items, tasks, and next steps from documents. Be specific and practical.`;

        prompt = `Document Title: "${documentTitle}"

User's Request: ${userMessage}

Document Content:
${documentContent.substring(0, 8000)}

Please identify and list specific action items, tasks, or next steps mentioned in the document. Format them clearly.`;

        responseType = 'action_items';
        metadata = { action: 'extract_actions' };
        break;

      case 'analysis':
        systemMessage = `You are a strategic analyst. Provide insights, identify patterns, and offer analytical perspectives on document content.`;

        prompt = `Document Title: "${documentTitle}"

Chat History:
${historyContext}

User's Analysis Request: ${userMessage}

Document Content:
${documentContent.substring(0, 8000)}

Please provide the requested analysis. Consider trends, patterns, implications, and strategic insights.`;

        responseType = 'analysis';
        metadata = { action: 'analyze', analysis_type: intent.details.analysisType };
        break;

      default:
        systemMessage = `You are a helpful document assistant. You help users understand and work with their uploaded documents. Be conversational, helpful, and refer to the document context when relevant.`;

        prompt = `Document Title: "${documentTitle}"

Chat History:
${historyContext}

User's Message: ${userMessage}

Document Content (first part):
${documentContent.substring(0, 6000)}

Please respond helpfully to the user's message. You can refer to the document content when relevant, suggest actions they might want to take, or answer any questions about what you can help with.`;

        responseType = 'conversation';
        metadata = { action: 'general_chat' };
    }

    const aiResponse = await callOpenAI(prompt, systemMessage, 800);

    return {
      message: aiResponse,
      type: responseType,
      metadata: metadata
    };

  } catch (error) {
    console.error('AI Response Error:', error);
    return {
      message: "I'm sorry, I encountered an error while processing your request. Please try again or rephrase your question.",
      type: 'error',
      metadata: { error: true }
    };
  }
};

const analyzeUserIntent = (message) => {
  const lowerMessage = message.toLowerCase();

  if (lowerMessage.includes('summar') || lowerMessage.includes('overview') ||
    lowerMessage.includes('main points') || lowerMessage.includes('key points')) {
    return {
      type: 'summary',
      confidence: 0.9,
      details: {
        focus: lowerMessage.includes('brief') ? 'brief' :
          lowerMessage.includes('detailed') ? 'detailed' : 'standard'
      }
    };
  }

  if (lowerMessage.includes('what') || lowerMessage.includes('how') ||
    lowerMessage.includes('when') || lowerMessage.includes('where') ||
    lowerMessage.includes('why') || lowerMessage.includes('who') ||
    lowerMessage.includes('')) {
    return {
      type: 'question',
      confidence: 0.8,
      details: {}
    };
  }

  if (lowerMessage.includes('translat') || lowerMessage.includes('spanish') ||
    lowerMessage.includes('french') || lowerMessage.includes('german') ||
    lowerMessage.includes('chinese') || lowerMessage.includes('japanese')) {
    const languages = {
      spanish: 'Spanish', french: 'French', german: 'German',
      chinese: 'Chinese', japanese: 'Japanese', arabic: 'Arabic',
      russian: 'Russian', portuguese: 'Portuguese', italian: 'Italian'
    };

    let detectedLang = null;
    for (const [key, value] of Object.entries(languages)) {
      if (lowerMessage.includes(key)) {
        detectedLang = value;
        break;
      }
    }

    return {
      type: 'translation',
      confidence: 0.9,
      details: { language: detectedLang }
    };
  }

  if (lowerMessage.includes('action') || lowerMessage.includes('task') ||
    lowerMessage.includes('todo') || lowerMessage.includes('next step') ||
    lowerMessage.includes('follow up')) {
    return {
      type: 'action_items',
      confidence: 0.85,
      details: {}
    };
  }

  if (lowerMessage.includes('analyz') || lowerMessage.includes('insights') ||
    lowerMessage.includes('trends') || lowerMessage.includes('pattern') ||
    lowerMessage.includes('recommend')) {
    return {
      type: 'analysis',
      confidence: 0.8,
      details: {
        analysisType: lowerMessage.includes('financial') ? 'financial' :
          lowerMessage.includes('market') ? 'market' : 'general'
      }
    };
  }

  return {
    type: 'general',
    confidence: 0.5,
    details: {}
  };
};

module.exports = {
  callOpenAI,
  generateChatbotResponse,
  analyzeUserIntent
};
