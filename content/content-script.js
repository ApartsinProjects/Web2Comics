// Content Script - Page Content Extraction
// Handles content extraction from web pages

(function() {
  'use strict';

  const MESSAGE_TYPES = {
    EXTRACT_CONTENT: 'EXTRACT_CONTENT',
    EXTRACT_CONTENT_RESULT: 'EXTRACT_CONTENT_RESULT',
    START_GENERATION: 'START_GENERATION'
  };

  // Simple readability parser
  function extractReadableContent(mode, selection) {
    try {
      // Mode A: User selection
      if (mode === 'selection') {
        const selectedText = window.getSelection()?.toString()?.trim();
        
        if (selectedText && selectedText.length > 50) {
          return {
            success: true,
            text: selectedText,
            mode: 'selection'
          };
        }
        
        return {
          success: false,
          error: 'No text selected. Please select some text on the page and try again.',
          mode: 'selection'
        };
      }

      // Mode B: Full page extraction
      // Try to find the main content using common selectors
      const contentSelectors = [
        'article',
        '[role="main"]',
        'main',
        '.post-content',
        '.article-content',
        '.entry-content',
        '.content',
        '#content',
        '.story-body',
        '.article-body'
      ];

      let contentElement = null;
      
      for (const selector of contentSelectors) {
        const element = document.querySelector(selector);
        if (element && element.textContent.length > 500) {
          contentElement = element;
          break;
        }
      }

      // Fallback to body
      if (!contentElement) {
        contentElement = document.body;
      }

      // Extract text content
      const text = extractTextFromElement(contentElement);
      
      if (!text || text.length < 100) {
        return {
          success: false,
          error: 'Could not extract enough readable content from this page.',
          mode: 'full'
        };
      }

      return {
        success: true,
        text: cleanText(text),
        mode: 'full'
      };
    } catch (error) {
      return {
        success: false,
        error: 'Error extracting content: ' + error.message,
        mode: mode
      };
    }
  }

  function extractTextFromElement(element) {
    const clone = element.cloneNode(true);
    
    // Remove unwanted elements
    const unwantedSelectors = [
      'script',
      'style',
      'noscript',
      'iframe',
      'nav',
      'header',
      'footer',
      'aside',
      '.sidebar',
      '.advertisement',
      '.ad',
      '.social-share',
      '.comments',
      '.related-posts',
      '[role="navigation"]',
      '[role="banner"]',
      '[role="complementary"]'
    ];

    unwantedSelectors.forEach(selector => {
      clone.querySelectorAll(selector).forEach(el => el.remove());
    });

    return clone.textContent || clone.innerText || '';
  }

  function cleanText(text) {
    return text
      .replace(/\s+/g, ' ')
      .replace(/[\n\r]+/g, '\n')
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0)
      .join('\n')
      .trim();
  }

  // Truncate text if too long
  function truncateText(text, maxLength = 15000) {
    if (text.length <= maxLength) {
      return {
        text,
        truncated: false,
        originalLength: text.length
      };
    }

    // Find a good breaking point (end of paragraph or sentence)
    const truncated = text.substring(0, maxLength);
    const lastParagraph = truncated.lastIndexOf('\n\n');
    const lastSentence = Math.max(
      truncated.lastIndexOf('. '),
      truncated.lastIndexOf('! '),
      truncated.lastIndexOf('? ')
    );

    let breakPoint = maxLength;
    if (lastParagraph > maxLength * 0.8) {
      breakPoint = lastParagraph;
    } else if (lastSentence > maxLength * 0.8) {
      breakPoint = lastSentence + 1;
    }

    return {
      text: text.substring(0, breakPoint) + '...[content truncated]',
      truncated: true,
      originalLength: text.length,
      truncatedAt: breakPoint
    };
  }

  // Listen for messages from popup/background
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    switch (message.type) {
      case MESSAGE_TYPES.EXTRACT_CONTENT:
        const mode = message.payload?.mode || 'full';
        const result = extractReadableContent(mode);
        
        // Apply truncation if needed
        if (result.success) {
          const truncated = truncateText(result.text);
          result.text = truncated.text;
          result.truncated = truncated.truncated;
          result.originalLength = truncated.originalLength;
        }
        
        sendResponse(result);
        break;

      case MESSAGE_TYPES.START_GENERATION:
        // Forward to background service worker
        chrome.runtime.sendMessage(message)
          .then(response => sendResponse(response))
          .catch(error => sendResponse({ success: false, error: error.message }));
        return true; // Keep channel open

      default:
        sendResponse({ success: false, error: 'Unknown message type' });
    }

    return true;
  });

  // Notify that content script is ready
  console.log('Web to Comic content script loaded');
})();
