const cheerio = require('cheerio');
const axios = require('axios');
const UserAgent = require('user-agents');

// Enhanced URL content extraction with multiple strategies
const extractUrlContent = async (url) => {
  console.log('🌐 Starting server-side URL extraction for:', url);

  try {
    // Validate URL
    const urlObj = new URL(url);
    if (!['http:', 'https:'].includes(urlObj.protocol)) {
      throw new Error('Only HTTP and HTTPS URLs are supported');
    }

    // Strategy 1: Direct request with proper headers
    const result = await attemptDirectExtraction(url);
    if (result.success) {
      return result;
    }

    // Strategy 2: Try with different user agents
    const userAgentResult = await attemptWithDifferentUserAgents(url);
    if (userAgentResult.success) {
      return userAgentResult;
    }

    // Strategy 3: Try with simplified headers
    const simplifiedResult = await attemptSimplifiedRequest(url);
    if (simplifiedResult.success) {
      return simplifiedResult;
    }

    throw new Error('All extraction strategies failed');

  } catch (error) {
    console.error('❌ URL extraction error:', error);

    // Return error result with fallback content
    const urlObj = new URL(url);
    return {
      success: false,
      error: error.message,
      preview: {
        url: url,
        title: `Content from ${urlObj.hostname}`,
        description: `Unable to extract content: ${error.message}`,
        favicon: '🌐',
        domain: urlObj.hostname,
        contentType: 'Web Page',
        estimatedReadTime: 'Unknown',
        wordCount: 0,
        error: true,
      },
      content: `URL: ${url}\n\nError: ${error.message}\n\nContent could not be automatically extracted.`
    };
  }
};

// Strategy 1: Direct extraction with comprehensive headers
const attemptDirectExtraction = async (url) => {
  try {
    console.log('🔄 Attempting direct extraction...');

    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Cache-Control': 'max-age=0',
      },
      timeout: 30000,
      maxRedirects: 5,
      validateStatus: (status) => status < 400,
    });

    if (response.data && response.data.length > 100) {
      return parseHtmlContent(response.data, url);
    }

    return { success: false, error: 'No valid content received' };
  } catch (error) {
    console.warn('❌ Direct extraction failed:', error.message);
    return { success: false, error: error.message };
  }
};

// Strategy 2: Try with different user agents
const attemptWithDifferentUserAgents = async (url) => {
  const userAgents = [
    // Chrome on Windows
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    // Chrome on Mac
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    // Firefox on Windows
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:120.0) Gecko/20100101 Firefox/120.0',
    // Safari on Mac
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15',
    // Edge
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0',
    // Mobile Chrome
    'Mozilla/5.0 (Linux; Android 10; SM-G975F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
    // iPhone Safari
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Mobile/15E148 Safari/604.1'
  ];

  for (const userAgent of userAgents) {
    try {
      console.log(`🔄 Trying with user agent: ${userAgent.substring(0, 50)}...`);

      const response = await axios.get(url, {
        headers: {
          'User-Agent': userAgent,
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
          'Connection': 'keep-alive',
          'Cache-Control': 'no-cache',
          'Pragma': 'no-cache'
        },
        timeout: 20000,
        maxRedirects: 3,
        validateStatus: (status) => status < 400,
      });

      if (response.data && response.data.length > 100) {
        console.log('✅ User agent strategy successful');
        return parseHtmlContent(response.data, url);
      }
    } catch (error) {
      console.warn(`❌ User agent attempt failed: ${error.message}`);
      continue;
    }
  }

  return { success: false, error: 'All user agent attempts failed' };
};

// Strategy 3: Simplified request (for sites that block complex headers)
const attemptSimplifiedRequest = async (url) => {
  try {
    console.log('🔄 Attempting simplified request...');

    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; ContentExtractor/1.0)',
        'Accept': 'text/html',
      },
      timeout: 15000,
      maxRedirects: 2,
      validateStatus: (status) => status < 400,
    });

    if (response.data && response.data.length > 100) {
      console.log('✅ Simplified request successful');
      return parseHtmlContent(response.data, url);
    }

    return { success: false, error: 'Simplified request failed' };
  } catch (error) {
    console.warn('❌ Simplified request failed:', error.message);
    return { success: false, error: error.message };
  }
};

// Enhanced HTML parsing with better content extraction
const parseHtmlContent = (html, url) => {
  try {
    console.log('📝 Parsing HTML content...');

    const $ = cheerio.load(html);
    const urlObj = new URL(url);

    // Extract title with multiple fallbacks
    let title = '';

    // Try different title sources
    const titleSources = [
      () => $('title').first().text(),
      () => $('meta[property="og:title"]').attr('content'),
      () => $('meta[name="twitter:title"]').attr('content'),
      () => $('h1').first().text(),
      () => $('h2').first().text(),
    ];

    for (const getTitleFn of titleSources) {
      try {
        const titleCandidate = getTitleFn();
        if (titleCandidate && titleCandidate.trim()) {
          title = titleCandidate.trim();
          break;
        }
      } catch (e) {
        continue;
      }
    }

    if (!title) {
      title = `Content from ${urlObj.hostname}`;
    }

    // Clean title
    title = cleanText(title);

    // Extract description with multiple fallbacks
    let description = '';
    const descriptionSources = [
      () => $('meta[name="description"]').attr('content'),
      () => $('meta[property="og:description"]').attr('content'),
      () => $('meta[name="twitter:description"]').attr('content'),
      () => $('meta[itemprop="description"]').attr('content'),
    ];

    for (const getDescFn of descriptionSources) {
      try {
        const descCandidate = getDescFn();
        if (descCandidate && descCandidate.trim()) {
          description = cleanText(descCandidate.trim());
          break;
        }
      } catch (e) {
        continue;
      }
    }

    // Remove unwanted elements more comprehensively
    const elementsToRemove = [
      'script', 'style', 'nav', 'header', 'footer', 'aside',
      '.ad', '.advertisement', '.sidebar', '.menu', '.navigation',
      '.social-share', '.related-posts', '.comments', '.popup',
      '.modal', '.overlay', '.banner', '.promo', '[role="complementary"]'
    ];

    elementsToRemove.forEach(selector => {
      $(selector).remove();
    });

    // Extract main content with better selectors
    let mainContent = '';
    const contentSelectors = [
      'main',
      'article',
      '[role="main"]',
      '.content',
      '.main-content',
      '.post-content',
      '.entry-content',
      '.article-content',
      '.post-body',
      '.story-body',
      '.article-body',
      '#content',
      '#main-content',
      '.page-content',
      '.blog-post',
      '.single-post',
      '.post',
      '.entry',
      '.article'
    ];

    for (const selector of contentSelectors) {
      const element = $(selector).first();
      if (element.length && element.text().trim().length > 200) {
        mainContent = element.text();
        console.log(`✅ Content found using selector: ${selector}`);
        break;
      }
    }

    // Fallback: try to find the largest text block
    if (!mainContent) {
      console.log('🔄 Using fallback content extraction...');
      const textBlocks = [];

      $('p, div').each((i, elem) => {
        const text = $(elem).text().trim();
        if (text.length > 100) {
          textBlocks.push(text);
        }
      });

      if (textBlocks.length > 0) {
        mainContent = textBlocks.join('\n\n');
      } else {
        // Final fallback to body
        $('body').find('script, style, nav, header, footer, aside').remove();
        mainContent = $('body').text();
      }
    }

    // Clean and format text content
    let textContent = cleanText(mainContent);

    // If description is empty, use first part of content
    if (!description && textContent.length > 0) {
      description = textContent.substring(0, 200);
      if (textContent.length > 200) {
        description += '...';
      }
    }

    // Calculate statistics
    const words = textContent.split(/\s+/).filter(word => word.length > 0);
    const wordCount = words.length;
    const readTimeMinutes = Math.max(1, Math.ceil(wordCount / 200));

    // Determine content type and favicon
    const { contentType, favicon } = determineContentType(urlObj.hostname, title, html);

    // Extract additional metadata
    const metadata = extractMetadata($, urlObj);

    console.log('✅ Content parsed successfully:', {
      title: title.substring(0, 50) + '...',
      contentLength: textContent.length,
      wordCount: wordCount,
      domain: urlObj.hostname
    });

    return {
      success: true,
      preview: {
        url: url,
        domain: urlObj.hostname,
        title: title,
        description: description,
        favicon: favicon,
        contentType: contentType,
        estimatedReadTime: `${readTimeMinutes} min read`,
        wordCount: wordCount,
        error: false,
        metadata: metadata
      },
      content: formatExtractedContent(title, url, urlObj.hostname, textContent, metadata)
    };

  } catch (error) {
    console.error('❌ HTML parsing error:', error);
    throw new Error('Failed to parse HTML content: ' + error.message);
  }
};

// Utility function to clean text
const cleanText = (text) => {
  if (!text) return '';

  return text
    .replace(/\s+/g, ' ')
    .replace(/\n\s*\n\s*\n/g, '\n\n')
    .replace(/\t/g, ' ')
    .trim();
};

// Determine content type and favicon based on URL and content
const determineContentType = (hostname, title, html) => {
  let contentType = 'Web Page';
  let favicon = '🌐';

  const host = hostname.toLowerCase();
  const titleLower = title.toLowerCase();

  // Check for specific sites and content types
  if (host.includes('wikipedia')) {
    contentType = 'Encyclopedia Article';
    favicon = '📖';
  } else if (host.includes('github')) {
    contentType = 'Repository';
    favicon = '💻';
  } else if (host.includes('medium') || host.includes('blog') || host.includes('wordpress')) {
    contentType = 'Blog Post';
    favicon = '✍️';
  } else if (host.includes('docs') || host.includes('documentation')) {
    contentType = 'Documentation';
    favicon = '📚';
  } else if (host.includes('news') || host.includes('bbc') || host.includes('cnn') || host.includes('reuters') || host.includes('nytimes')) {
    contentType = 'News Article';
    favicon = '📰';
  } else if (host.includes('youtube') || host.includes('video') || host.includes('vimeo')) {
    contentType = 'Video Content';
    favicon = '🎥';
  } else if (host.includes('stackoverflow') || host.includes('stackexchange')) {
    contentType = 'Q&A Forum';
    favicon = '❓';
  } else if (host.includes('reddit')) {
    contentType = 'Discussion Forum';
    favicon = '💬';
  } else if (host.includes('linkedin')) {
    contentType = 'Professional Network';
    favicon = '💼';
  } else if (titleLower.includes('documentation') || titleLower.includes('docs')) {
    contentType = 'Documentation';
    favicon = '📚';
  } else if (titleLower.includes('blog') || titleLower.includes('article')) {
    contentType = 'Blog Post';
    favicon = '✍️';
  } else if (titleLower.includes('news') || titleLower.includes('report')) {
    contentType = 'News Article';
    favicon = '📰';
  }

  return { contentType, favicon };
};

// Extract additional metadata from the page
const extractMetadata = ($, urlObj) => {
  const metadata = {};

  try {
    // Author
    metadata.author = $('meta[name="author"]').attr('content') ||
      $('meta[property="article:author"]').attr('content') ||
      $('.author').first().text().trim() || null;

    // Publication date
    metadata.publishDate = $('meta[property="article:published_time"]').attr('content') ||
      $('meta[name="date"]').attr('content') ||
      $('time[datetime]').attr('datetime') || null;

    // Keywords/tags
    metadata.keywords = $('meta[name="keywords"]').attr('content') || null;

    // Language
    metadata.language = $('html').attr('lang') ||
      $('meta[http-equiv="content-language"]').attr('content') || 'en';

    // Site name
    metadata.siteName = $('meta[property="og:site_name"]').attr('content') || urlObj.hostname;

    // Article section/category
    metadata.section = $('meta[property="article:section"]').attr('content') || null;

    // Canonical URL
    metadata.canonicalUrl = $('link[rel="canonical"]').attr('href') || null;

  } catch (error) {
    console.warn('Metadata extraction error:', error);
  }

  return metadata;
};

// Format the extracted content for storage
const formatExtractedContent = (title, url, hostname, textContent, metadata) => {
  let formattedContent = `Title: ${title}\n\nURL: ${url}\n\nDomain: ${hostname}\n\n`;

  // Add metadata if available
  if (metadata.author) {
    formattedContent += `Author: ${metadata.author}\n`;
  }
  if (metadata.publishDate) {
    formattedContent += `Published: ${metadata.publishDate}\n`;
  }
  if (metadata.siteName && metadata.siteName !== hostname) {
    formattedContent += `Site: ${metadata.siteName}\n`;
  }

  formattedContent += `\nContent:\n\n${textContent}`;

  return formattedContent;
};

// Export all functions
module.exports = {
  extractUrlContent,
  attemptDirectExtraction,
  attemptWithDifferentUserAgents,
  attemptSimplifiedRequest,
  parseHtmlContent,
  cleanText,
  determineContentType,
  extractMetadata,
  formatExtractedContent
};
